// Supabase: landlord sign-in and sync, tenant invite links, tenant view, payment proofs.
// The app still works fully offline without an account; signing in adds sync + tenant links.

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { getPhoto, putPhoto } from "./photos";
import type { Bill, Data, Settings, Unit } from "./store";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabaseConfig";

let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // Implicit flow: the email link signs in even if it opens in a different browser.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
    });
  }
  return client;
}

export const appUrl = () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;

/* ---------- landlord account ---------- */

export async function sendLoginLink(email: string) {
  const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl() } });
  if (error) throw error;
}

export const signOut = () => sb().auth.signOut();

export function onSession(cb: (s: Session | null) => void) {
  sb().auth.getSession().then(({ data }) => cb(data.session));
  const { data } = sb().auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

/* ---------- sync ---------- */

export async function pullData(): Promise<{ data: Data; updatedAt: string } | null> {
  const { data, error } = await sb().from("landlord_data").select("data, updated_at").maybeSingle();
  if (error) throw error;
  return data ? { data: data.data as Data, updatedAt: data.updated_at as string } : null;
}

/** Save the landlord's data online; returns the version stamp written. */
export async function pushData(data: Data): Promise<string> {
  const { data: s } = await sb().auth.getSession();
  if (!s.session) throw new Error("not signed in");
  const updatedAt = new Date().toISOString();
  const { error } = await sb().from("landlord_data").upsert({ owner: s.session.user.id, data, updated_at: updatedAt });
  if (error) throw error;
  await uploadPhotos(data);
  return updatedAt;
}

/** Every photo the landlord's bills and profiles use, so tenants and other devices can see them. */
const referencedPhotoIds = (d: Data) => [
  ...new Set([
    ...d.bills.flatMap((b) => b.lines.flatMap((l) => [l.photoId, l.billPhotoId].filter((x): x is string => !!x))),
    ...d.units.flatMap((u) => u.recurring.flatMap((c) => (c.photoId ? [c.photoId] : []))),
  ]),
];

const uploaded = new Set<string>();

async function uploadPhotos(d: Data) {
  const ids = referencedPhotoIds(d).filter((id) => !uploaded.has(id));
  if (!ids.length) return;
  const { data: existing } = await sb().from("photos").select("id").in("id", ids);
  for (const r of existing ?? []) uploaded.add(r.id as string);
  for (const id of ids.filter((id) => !uploaded.has(id))) {
    const dataUrl = await getPhoto(id);
    if (!dataUrl) continue;
    const { error } = await sb().from("photos").upsert({ id, data: dataUrl });
    if (!error) uploaded.add(id);
  }
}

/** Photos from this device, falling back to the cloud copy (e.g. on a newly signed-in tablet). */
export async function loadPhotos(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of ids) {
    const p = await getPhoto(id);
    if (p) out[id] = p;
    else missing.push(id);
  }
  if (missing.length) {
    const { data: s } = await sb().auth.getSession();
    if (s.session) {
      const { data } = await sb().from("photos").select("id, data").in("id", missing);
      for (const r of data ?? []) {
        out[r.id as string] = r.data as string;
        await putPhoto(r.id as string, r.data as string);
      }
    }
  }
  return out;
}

/* ---------- tenant invite links ---------- */

export type TenantLink = { token: string; unit_id: string; active: boolean; created_at: string };

const randomToken = () => {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L confusion
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
};

export const tenantUrl = (token: string) => `${appUrl()}?t=${token}`;

export async function activeLink(unitId: string): Promise<TenantLink | null> {
  const { data, error } = await sb()
    .from("tenant_links")
    .select("token, unit_id, active, created_at")
    .eq("unit_id", unitId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as TenantLink | null;
}

export async function createLink(unitId: string): Promise<TenantLink> {
  const { data, error } = await sb()
    .from("tenant_links")
    .insert({ token: randomToken(), unit_id: unitId })
    .select("token, unit_id, active, created_at")
    .single();
  if (error) throw error;
  return data as TenantLink;
}

export async function disableLinks(unitId: string) {
  const { error } = await sb().from("tenant_links").update({ active: false }).eq("unit_id", unitId).eq("active", true);
  if (error) throw error;
}

/* ---------- payment proofs ---------- */

export type Proof = {
  id: string;
  unit_id: string;
  bill_id: string;
  amount: number;
  note: string | null;
  photo: string | null;
  status: "pending" | "confirmed" | "rejected";
  created_at: string;
};

export async function pendingProofs(): Promise<Proof[]> {
  const { data, error } = await sb()
    .from("payment_proofs")
    .select("id, unit_id, bill_id, amount, note, photo, status, created_at")
    .eq("status", "pending")
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })) as Proof[];
}

export async function reviewProof(id: string, status: "confirmed" | "rejected") {
  const { error } = await sb()
    .from("payment_proofs")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/* ---------- tenant (anonymous, by invite token) ---------- */

export type TenantView = {
  settings: Pick<Settings, "propertyName" | "paymentMethod" | "gcashNumber" | "gcashName" | "language" | "currency">;
  unit: Pick<Unit, "name" | "tenantName" | "deposit">;
  bills: Bill[];
  proofs: { id: string; billId: string; amount: number; note: string | null; status: Proof["status"]; createdAt: string }[];
};

export async function getTenantView(token: string): Promise<TenantView | null> {
  const { data, error } = await sb().rpc("get_tenant_view", { p_token: token });
  if (error) throw error;
  if (!data) return null;
  const v = data as TenantView;
  return { ...v, proofs: v.proofs.map((p) => ({ ...p, amount: Number(p.amount) })) };
}

export async function getTenantPhotos(token: string): Promise<Record<string, string>> {
  const { data, error } = await sb().rpc("get_tenant_photos", { p_token: token });
  if (error) throw error;
  return (data ?? {}) as Record<string, string>;
}

export async function submitProof(token: string, billId: string, amount: number, note: string, photo: string | null) {
  const { error } = await sb().rpc("submit_payment_proof", {
    p_token: token,
    p_bill_id: billId,
    p_amount: amount,
    p_note: note,
    p_photo: photo,
  });
  if (error) throw error;
}
