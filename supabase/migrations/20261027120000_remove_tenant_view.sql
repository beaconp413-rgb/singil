-- The tenant view was removed: landlords now send bills by Messenger, WhatsApp, Viber, SMS or email.
-- Drop the anonymous tenant functions first so old invite links can no longer read anything.
drop function if exists public.get_tenant_view(text);
drop function if exists public.get_tenant_photos(text);
drop function if exists public.submit_payment_proof(text, text, numeric, text, text);
drop table if exists public.payment_proofs;
drop table if exists public.tenant_links;
