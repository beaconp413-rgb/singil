-- Singil cloud storage: each landlord's app data, photos, tenant invite links and
-- payment proofs. Landlords (signed in) only ever touch their own rows (RLS).
-- Tenants are anonymous: they hold an invite token and can only call the
-- SECURITY DEFINER functions below, which return/accept data for that one unit.

-- ---------- landlord app state (the same JSON the app keeps locally) ----------
create table public.landlord_data (
  owner uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.landlord_data enable row level security;
create policy "landlord owns data" on public.landlord_data
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------- bill photos (base64 JPEG data URLs, ~150 KB each) ----------
create table public.photos (
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data text not null check (length(data) < 3000000),
  created_at timestamptz not null default now(),
  primary key (owner, id)
);
alter table public.photos enable row level security;
create policy "landlord owns photos" on public.photos
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------- tenant invite links ----------
create table public.tenant_links (
  token text primary key check (length(token) >= 16),
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  unit_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tenant_links enable row level security;
create policy "landlord owns links" on public.tenant_links
  for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create index tenant_links_owner_unit on public.tenant_links (owner, unit_id);

-- ---------- payment proofs uploaded by tenants ----------
create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  unit_id text not null,
  bill_id text not null,
  amount numeric(12, 2) not null check (amount > 0),
  note text check (length(note) <= 500),
  photo text check (length(photo) < 3000000),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.payment_proofs enable row level security;
-- Landlords read and review their proofs; inserts only happen through submit_payment_proof().
create policy "landlord reads proofs" on public.payment_proofs
  for select to authenticated using (owner = auth.uid());
create policy "landlord reviews proofs" on public.payment_proofs
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "landlord deletes proofs" on public.payment_proofs
  for delete to authenticated using (owner = auth.uid());
create index payment_proofs_owner_status on public.payment_proofs (owner, status);

-- ---------- tenant-facing functions ----------

-- Everything a tenant may see for their unit: property/payment details, their unit,
-- their bills (newest first) and their recent payment proofs (without photos).
create or replace function public.get_tenant_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.tenant_links;
  v_data jsonb;
  v_unit jsonb;
begin
  select * into v_link from public.tenant_links where token = p_token and active;
  if not found then
    return null;
  end if;

  select data into v_data from public.landlord_data where owner = v_link.owner;
  select u into v_unit from jsonb_array_elements(v_data -> 'units') u where u ->> 'id' = v_link.unit_id;
  if v_unit is null then
    return null;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'propertyName', v_data -> 'settings' -> 'propertyName',
      'paymentMethod', v_data -> 'settings' -> 'paymentMethod',
      'gcashNumber', v_data -> 'settings' -> 'gcashNumber',
      'gcashName', v_data -> 'settings' -> 'gcashName',
      'language', v_data -> 'settings' -> 'language',
      'currency', v_data -> 'settings' -> 'currency'
    ),
    'unit', jsonb_build_object(
      'name', v_unit -> 'name',
      'tenantName', v_unit -> 'tenantName',
      'deposit', v_unit -> 'deposit'
    ),
    'bills', coalesce((
      select jsonb_agg(b order by b ->> 'period' desc, (b ->> 'number')::int desc)
      from jsonb_array_elements(v_data -> 'bills') b
      where b ->> 'unitId' = v_link.unit_id
    ), '[]'::jsonb),
    'proofs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'billId', p.bill_id, 'amount', p.amount, 'note', p.note,
        'status', p.status, 'createdAt', p.created_at
      ) order by p.created_at desc)
      from (
        select * from public.payment_proofs
        where owner = v_link.owner and unit_id = v_link.unit_id
        order by created_at desc limit 20
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

-- Photos attached to this unit's bills only, as { photoId: dataUrl }.
create or replace function public.get_tenant_photos(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.tenant_links;
  v_ids text[];
begin
  select * into v_link from public.tenant_links where token = p_token and active;
  if not found then
    return '{}'::jsonb;
  end if;

  select array_agg(distinct pid) into v_ids
  from public.landlord_data d,
       jsonb_array_elements(d.data -> 'bills') b,
       jsonb_array_elements(b -> 'lines') l,
       lateral (values (l ->> 'photoId'), (l ->> 'billPhotoId')) as v(pid)
  where d.owner = v_link.owner and b ->> 'unitId' = v_link.unit_id and pid is not null;

  return coalesce((
    select jsonb_object_agg(id, data) from public.photos
    where owner = v_link.owner and id = any(v_ids)
  ), '{}'::jsonb);
end;
$$;

-- A tenant reports a payment (with optional screenshot) for one of their bills.
create or replace function public.submit_payment_proof(
  p_token text, p_bill_id text, p_amount numeric, p_note text, p_photo text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.tenant_links;
  v_id uuid;
begin
  select * into v_link from public.tenant_links where token = p_token and active;
  if not found then
    raise exception 'invalid link';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'invalid amount';
  end if;
  if not exists (
    select 1 from public.landlord_data d, jsonb_array_elements(d.data -> 'bills') b
    where d.owner = v_link.owner and b ->> 'id' = p_bill_id and b ->> 'unitId' = v_link.unit_id
  ) then
    raise exception 'invalid bill';
  end if;
  -- Basic spam guard: at most 10 proofs waiting for review per unit.
  if (select count(*) from public.payment_proofs
      where owner = v_link.owner and unit_id = v_link.unit_id and status = 'pending') >= 10 then
    raise exception 'too many pending proofs';
  end if;

  insert into public.payment_proofs (owner, unit_id, bill_id, amount, note, photo)
  values (v_link.owner, v_link.unit_id, p_bill_id, round(p_amount, 2), left(p_note, 500), p_photo)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.get_tenant_view(text) from public;
revoke all on function public.get_tenant_photos(text) from public;
revoke all on function public.submit_payment_proof(text, text, numeric, text, text) from public;
grant execute on function public.get_tenant_view(text) to anon, authenticated;
grant execute on function public.get_tenant_photos(text) to anon, authenticated;
grant execute on function public.submit_payment_proof(text, text, numeric, text, text) to anon, authenticated;
