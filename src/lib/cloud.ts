// Supabase: landlord sign-in and sync across devices.
// The app works fully offline without an account; signing in adds online backup + sync.

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { getPhoto, putPhoto } from "./photos";
import type { Data } from "./store";
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

/** Every photo the landlord's bills and profiles use, so the landlord's other devices can see them. */
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
