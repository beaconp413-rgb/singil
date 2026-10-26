"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTenantPhotos, getTenantView, submitProof, type TenantView as View } from "@/lib/cloud";
import { configure, currencySymbol, t } from "@/lib/i18n";
import { toSmallJpeg } from "@/lib/photos";
import { type Bill, balance, peso, periodLabel, round2, shortDate, status, statusStyle } from "@/lib/store";

/** What a tenant sees when they open their private invite link (?t=TOKEN). */
export default function TenantView({ token }: { token: string }) {
  const [view, setView] = useState<View | null | undefined>(undefined); // undefined = loading, null = invalid
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await getTenantView(token);
      setView(v);
      setLoadError(false);
      if (v) getTenantPhotos(token).then(setPhotos).catch(() => {});
    } catch {
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => {
    // Initial fetch from the server; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (view) configure({ language: view.settings.language, currency: view.settings.currency });
  const T = t();
  const TT = T.tenant;

  if (view === undefined) {
    return <Shell title="Singil">{loadError ? <Notice>{TT.failed}</Notice> : <Notice>{TT.loading}</Notice>}</Shell>;
  }
  if (view === null) {
    return (
      <Shell title="Singil">
        <Notice>{TT.invalid}</Notice>
      </Shell>
    );
  }

  const bills = view.bills;
  const unpaid = bills.filter((b) => balance(b) > 0);
  const amountDue = round2(unpaid.reduce((s, b) => s + balance(b), 0));
  const nextDue = [...unpaid].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const latest = bills[0];
  const s = view.settings;
  const payAccount = s.gcashNumber ? `${s.gcashNumber}${s.gcashName ? ` (${s.gcashName})` : ""}` : "";
  const pending = view.proofs.filter((p) => p.status === "pending");
  const recentReviewed = view.proofs.filter((p) => p.status !== "pending").slice(0, 3);

  return (
    <Shell title={s.propertyName || T.propertyFallback}>
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-xl font-bold">{TT.hello(view.unit.tenantName.split(" ")[0])}</h1>
          <p className="text-sm text-slate-500">{view.unit.name}</p>
        </div>

        {bills.length === 0 ? (
          <Notice>{TT.noBills}</Notice>
        ) : (
          <section className="rounded-xl border-l-8 border-amber-500 bg-amber-100 p-4 text-center">
            {amountDue > 0 ? (
              <>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-900">{T.amountToPay}</p>
                <p className="break-words text-4xl font-extrabold">{peso(amountDue)}</p>
                {nextDue && <p className="text-sm text-amber-900">{T.dueOn(shortDate(nextDue.dueDate))}</p>}
              </>
            ) : (
              <p className="py-3 text-lg font-bold text-emerald-700">{TT.allPaid}</p>
            )}
          </section>
        )}

        {pending.map((p) => (
          <p key={p.id} className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
            {TT.waiting(peso(p.amount))}
          </p>
        ))}
        {recentReviewed.map((p) => (
          <p
            key={p.id}
            className={`rounded-lg p-3 text-sm ${p.status === "confirmed" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
          >
            {p.status === "confirmed" ? TT.confirmed(peso(p.amount)) : TT.rejected(peso(p.amount))}
          </p>
        ))}

        {amountDue > 0 && nextDue && (
          <ProofForm token={token} bill={nextDue} amountDue={amountDue} payMethod={s.paymentMethod} payAccount={payAccount} onSent={refresh} />
        )}

        {latest && <BillCard bill={latest} title={`${TT.currentBill} · ${periodLabel(latest.period)}`} photos={photos} onPhoto={setEnlarged} />}

        {(view.unit.deposit ?? 0) > 0 && <p className="text-center text-xs text-slate-500">{T.depositInfo(peso(view.unit.deposit))}</p>}

        {bills.length > 1 && (
          <section className="space-y-2">
            <h2 className="font-semibold">{TT.history}</h2>
            {bills.slice(1).map((b) => {
              const st = statusStyle(status(b));
              return (
                <div key={b.id} className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
                  <div>
                    <p className="font-medium">{periodLabel(b.period)}</p>
                    <p className="text-xs text-slate-500">
                      {T.dueShort} {shortDate(b.dueDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{peso(b.total)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
              );
            })}
          </section>
        )}

        <p className="pt-4 text-center text-xs text-slate-400">{TT.poweredBy}</p>
      </div>

      {enlarged && (
        <button onClick={() => setEnlarged(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the landlord's upload */}
          <img src={enlarged} alt="Bill" className="max-h-full max-w-full object-contain" />
        </button>
      )}
    </Shell>
  );
}

function BillCard({ bill, title, photos, onPhoto }: { bill: Bill; title: string; photos: Record<string, string>; onPhoto: (src: string) => void }) {
  const T = t();
  const shots = bill.lines.flatMap((l) =>
    [l.billPhotoId, l.photoId].filter((id): id is string => !!id && !!photos[id]).map((id) => ({ id, label: l.label, src: photos[id] })),
  );
  const paid = round2(bill.payments.reduce((s, p) => s + p.amount, 0));
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(status(bill)).cls}`}>{statusStyle(status(bill)).label}</span>
      </div>
      <div className="text-sm">
        {bill.lines.map((l) => (
          <div key={l.id} className="flex justify-between gap-2 py-1">
            <span className="text-slate-600">{l.label}</span>
            <span className="shrink-0">{peso(l.amount)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 font-semibold">
          <span>{T.thisMonth}</span>
          <span>{peso(bill.total)}</span>
        </div>
        {paid > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>{T.bill.paid}</span>
            <span>−{peso(paid)}</span>
          </div>
        )}
        <p className="pt-1 text-xs text-slate-500">
          {T.dueOn(shortDate(bill.dueDate))}
          {bill.updatedAt && ` · ${T.updatedOn(shortDate(bill.updatedAt))}`}
        </p>
      </div>
      {shots.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shots.map((p) => (
            <button key={p.id} onClick={() => onPhoto(p.src)} className="text-left">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the landlord's upload */}
              <img src={p.src} alt={p.label} className="h-28 w-full rounded-lg bg-slate-100 object-cover" />
              <p className="mt-1 truncate text-xs text-slate-600">📷 {p.label}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ProofForm({
  token,
  bill,
  amountDue,
  payMethod,
  payAccount,
  onSent,
}: {
  token: string;
  bill: Bill;
  amountDue: number;
  payMethod: string;
  payAccount: string;
  onSent: () => void;
}) {
  const T = t();
  const TT = T.tenant;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(amountDue));
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send() {
    const n = parseFloat(amount);
    if (!n || n <= 0) return setMsg({ ok: false, text: T.enterAmountPaid });
    if (!photo) return setMsg({ ok: false, text: TT.needScreenshot });
    setBusy(true);
    try {
      await submitProof(token, bill.id, round2(n), note, photo);
      setMsg({ ok: true, text: TT.sent });
      setOpen(false);
      setPhoto(null);
      setNote("");
      onSent();
    } catch {
      setMsg({ ok: false, text: TT.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      {payAccount && (
        <div>
          <p className="text-sm text-slate-500">{T.bill.sendVia(payMethod || "GCash")}</p>
          <p className="text-xl font-bold">{payAccount}</p>
        </div>
      )}
      {msg && <p className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}
      {!open ? (
        <button onClick={() => (setOpen(true), setMsg(null))} className="w-full rounded-lg bg-emerald-700 py-3 font-semibold text-white">
          {TT.sendProof}
        </button>
      ) : (
        <div className="space-y-3">
          <h3 className="font-semibold">{TT.proofTitle}</h3>
          <label className="block text-sm">
            <span className="text-slate-500">
              {TT.amountPaid} ({currencySymbol()})
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-500">{TT.refNote}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setPhoto(await toSmallJpeg(f));
              e.target.value = "";
            }}
          />
          {photo ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={photo} alt="Screenshot" className="h-20 w-20 rounded object-cover" />
              <button onClick={() => setPhoto(null)} className="text-sm text-red-700">
                {T.removePhoto}
              </button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="w-full rounded-lg border border-dashed border-slate-400 py-3 text-sm">
              {TT.screenshot}
            </button>
          )}
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-slate-300 py-3">
              {T.cancel}
            </button>
            <button onClick={send} disabled={busy} className="flex-1 rounded-lg bg-emerald-700 py-3 font-medium text-white disabled:opacity-60">
              {busy ? T.saving : TT.submit}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 pb-8">
      <header className="sticky top-0 z-10 bg-emerald-700 pt-[env(safe-area-inset-top)] text-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold">⚡</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mx-auto max-w-2xl rounded-xl bg-white p-6 text-center text-slate-600 shadow-sm">{children}</p>;
}
