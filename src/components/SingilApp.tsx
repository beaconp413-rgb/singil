"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { renderBillImage } from "@/lib/billImage";
import { configure, currencySymbol, t } from "@/lib/i18n";
import { deletePhotos, getPhotos, putPhoto, toSmallJpeg } from "@/lib/photos";
import {
  linePhotoIds,
  Bill,
  Charge,
  Data,
  Line,
  Settings,
  Unit,
  balance,
  billMessage,
  billSummary,
  currentPeriod,
  defaultData,
  autoBillsToReview,
  billsToRemind,
  nextAutoBill,
  unusedPhotoIds,
  withAutoBills,
  daysUntilDue,
  load,
  localDate,
  nextDueFromMoveIn,
  reminderMessage,
  newMeter,
  paidAmount,
  parseBackup,
  peso,
  periodLabel,
  previousBalance,
  round2,
  save,
  shortDate,
  status,
  statusStyle,
  sumLines,
  uid,
  unitBalance,
} from "@/lib/store";

type View =
  | { name: "home" }
  | { name: "unit"; unitId: string }
  | { name: "editUnit"; unitId: string | null }
  | { name: "newBill"; unitId: string; round: boolean; period?: string; due?: string }
  | { name: "bill"; billId: string; round: boolean }
  | { name: "editBill"; billId: string }
  | { name: "history" }
  | { name: "settings" };

type Update = (fn: (d: Data) => Data) => void;

export default function SingilApp() {
  const [data, setData] = useState<Data>(() => {
    if (typeof window === "undefined") return defaultData;
    const loaded = load();
    // Create any monthly bills that came due since the app was last opened.
    const withBills = withAutoBills(loaded);
    if (withBills !== loaded) save(withBills);
    return withBills;
  });
  // Data lives in localStorage, so render nothing on the server and during hydration.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [view, setViewRaw] = useState<View>({ name: "home" });
  const [period, setPeriod] = useState(currentPeriod());

  const setView = (v: View) => {
    setViewRaw(v);
    window.scrollTo(0, 0);
  };

  const update: Update = (fn) =>
    setData((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });

  if (!ready) return null;
  configure(data.settings);
  const T = t();

  const home = () => setView({ name: "home" });
  const navItems = [
    ["home", "🏠", T.nav.units],
    ["history", "📒", T.nav.bills],
    ["settings", "⚙️", T.nav.settings],
  ] as const;
  // Units with a move-in date are billed automatically, so only the others need a manual billing round.
  const unbilled = data.units.filter((u) => !u.moveInDate && !data.bills.some((b) => b.unitId === u.id && b.period === period));
  // Billing round moves forward through the unit list so skipped units aren't revisited in a loop.
  const nextUnbilledAfter = (unitId: string) => {
    const idx = data.units.findIndex((u) => u.id === unitId);
    return unbilled.find((u) => data.units.indexOf(u) > idx);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8">
      <header className="sticky top-0 z-10 bg-emerald-700 pt-[env(safe-area-inset-top)] text-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
          <button onClick={home} className="shrink-0 whitespace-nowrap text-lg font-bold">
            ⚡ Singil
          </button>
          <span className="min-w-0 flex-1 truncate text-right text-sm opacity-90 md:text-left">
            {data.settings.propertyName || T.propertyFallback}
          </span>
          {/* Tablet/desktop: navigation lives in the header instead of the bottom bar. */}
          <nav className="hidden gap-1 md:flex">
            {navItems.map(([name, icon, label]) => (
              <button
                key={name}
                onClick={() => setView({ name } as View)}
                className={`rounded-lg px-3 py-2 text-sm ${view.name === name ? "bg-white/20 font-semibold" : "opacity-90 hover:bg-white/10"}`}
              >
                {icon} {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        {view.name === "home" && (
          <Home data={data} period={period} setPeriod={setPeriod} unbilled={unbilled} setView={setView} update={update} />
        )}

        {view.name === "unit" && <UnitDetail data={data} unitId={view.unitId} period={period} setView={setView} />}

        {view.name === "editUnit" && (
          <UnitForm
            unit={data.units.find((u) => u.id === view.unitId) ?? null}
            onCancel={() => (view.unitId ? setView({ name: "unit", unitId: view.unitId }) : home())}
            onSave={(u) => {
              const before = data.units.find((x) => x.id === u.id);
              const after = withAutoBills({
                ...data,
                units: before ? data.units.map((x) => (x.id === u.id ? u : x)) : [...data.units, u],
              });
              deletePhotos(unusedPhotoIds((before?.recurring ?? []).flatMap((c) => (c.photoId ? [c.photoId] : [])), after));
              update(() => after);
              setView({ name: "unit", unitId: u.id });
            }}
            onDelete={(id) => {
              if (!confirm(T.confirmDeleteUnit)) return;
              const after = { ...data, units: data.units.filter((x) => x.id !== id), bills: data.bills.filter((b) => b.unitId !== id) };
              deletePhotos(
                unusedPhotoIds(
                  [
                    ...data.bills.filter((b) => b.unitId === id).flatMap(linePhotoIds),
                    ...(data.units.find((x) => x.id === id)?.recurring.flatMap((c) => (c.photoId ? [c.photoId] : [])) ?? []),
                  ],
                  after,
                ),
              );
              update(() => after);
              home();
            }}
          />
        )}

        {view.name === "newBill" && (
          <NewBill
            key={view.unitId}
            data={data}
            unit={data.units.find((u) => u.id === view.unitId)!}
            period={view.period ?? period}
            defaultDue={view.due}
            round={view.round}
            remaining={unbilled.length}
            onCancel={home}
            onSkip={() => {
              const next = nextUnbilledAfter(view.unitId);
              if (next) setView({ name: "newBill", unitId: next.id, round: true });
              else home();
            }}
            onSave={(bill) => {
              update((d) => ({ ...d, nextBillNo: d.nextBillNo + 1, bills: [...d.bills, bill] }));
              setView({ name: "bill", billId: bill.id, round: view.round });
            }}
          />
        )}

        {view.name === "editBill" &&
          (() => {
            const existing = data.bills.find((b) => b.id === view.billId);
            const unit = existing && data.units.find((u) => u.id === existing.unitId);
            if (!existing || !unit) return <p>{T.billNotFound}</p>;
            return (
              <NewBill
                key={existing.id}
                data={data}
                unit={unit}
                period={existing.period}
                existing={existing}
                round={false}
                remaining={0}
                onCancel={() => setView({ name: "bill", billId: existing.id, round: false })}
                onSkip={() => {}}
                onSave={(bill) => {
                  const after = { ...data, bills: data.bills.map((b) => (b.id === bill.id ? bill : b)) };
                  deletePhotos(unusedPhotoIds(linePhotoIds(existing), after));
                  update(() => after);
                  setView({ name: "bill", billId: bill.id, round: false });
                }}
              />
            );
          })()}

        {view.name === "bill" && (
          <BillView
            key={view.billId}
            data={data}
            billId={view.billId}
            update={update}
            nextUnit={view.round ? nextUnbilledAfter(data.bills.find((b) => b.id === view.billId)?.unitId ?? "") : undefined}
            setView={setView}
          />
        )}

        {view.name === "history" && <History data={data} setView={setView} />}

        {view.name === "settings" && (
          <SettingsForm
            data={data}
            onSave={(s) => {
              update((d) => withAutoBills({ ...d, settings: s }));
              home();
            }}
            onImport={(d) => {
              update(() => d);
              home();
            }}
          />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] text-center text-sm md:hidden">
        {navItems.map(([name, icon, label]) => (
          <button
            key={name}
            onClick={() => setView({ name } as View)}
            className={`py-3 ${view.name === name ? "font-semibold text-emerald-700" : "text-slate-600"}`}
          >
            <div className="text-lg">{icon}</div>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ================= Home: month overview + all units ================= */

function Home({
  data,
  period,
  setPeriod,
  unbilled,
  setView,
  update,
}: {
  data: Data;
  period: string;
  setPeriod: (p: string) => void;
  unbilled: Unit[];
  setView: (v: View) => void;
  update: Update;
}) {
  const T = t();
  const monthBills = data.bills.filter((b) => b.period === period);
  const billed = round2(monthBills.reduce((s, b) => s + b.total, 0));
  const collected = round2(monthBills.reduce((s, b) => s + paidAmount(b), 0));
  const allUnpaid = round2(data.bills.reduce((s, b) => s + Math.max(0, balance(b)), 0));

  return (
    <>
      {!data.settings.propertyName && (
        <button
          onClick={() => setView({ name: "settings" })}
          className="w-full rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-900"
        >
          {T.startHere} <b>{T.settings}</b>.
        </button>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <label className="flex items-center justify-between text-sm text-slate-500">
          {T.billingMonth}
          <input
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-slate-900"
          />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label={T.billed} value={peso(billed)} />
          <Stat label={T.collected} value={peso(collected)} cls="text-emerald-700" />
          <Stat label={T.unpaidMonth} value={peso(round2(billed - collected))} cls="text-red-700" />
        </div>
        <p className="mt-2 text-center text-xs text-slate-500">
          {T.unitsBilled(monthBills.length, data.units.length)} · {T.allTimeUnpaid}: <b className="text-red-700">{peso(allUnpaid)}</b>
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 empty:hidden lg:grid-cols-2 lg:items-start">
      {autoBillsToReview(data).length > 0 && (
        <section className="space-y-2 rounded-xl border border-blue-300 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">{T.newAutoBills}</p>
          {autoBillsToReview(data).map((b) => {
            const unit = data.units.find((u) => u.id === b.unitId);
            return (
              <button
                key={b.id}
                onClick={() => setView({ name: "bill", billId: b.id, round: false })}
                className="flex w-full justify-between gap-2 rounded-lg bg-white p-3 text-left text-sm"
              >
                <span className="min-w-0 font-medium">
                  {unit?.name ?? T.deletedUnit} · {periodLabel(b.period)}
                </span>
                <span className="shrink-0 whitespace-nowrap">{peso(b.total)} →</span>
              </button>
            );
          })}
        </section>
      )}

      <Reminders data={data} setView={setView} update={update} />
      </div>

      {unbilled.length > 0 && data.units.length > 0 && (
        <button
          onClick={() => setView({ name: "newBill", unitId: unbilled[0].id, round: true })}
          className="w-full rounded-xl bg-emerald-700 py-4 font-semibold text-white shadow-sm"
        >
          {T.startRound(unbilled.length)}
        </button>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{T.unitsHeader(data.units.length)}</h2>
        <button onClick={() => setView({ name: "editUnit", unitId: null })} className="text-sm font-medium text-emerald-700">
          {T.addUnit}
        </button>
      </div>

      {data.units.length === 0 && (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">
          {T.noUnits}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {data.units.map((u) => {
        const bill = monthBills.find((b) => b.unitId === u.id);
        const owed = unitBalance(data, u.id);
        const st = bill ? statusStyle(status(bill)) : null;
        return (
          <button
            key={u.id}
            onClick={() => (bill ? setView({ name: "bill", billId: bill.id, round: false }) : setView({ name: "unit", unitId: u.id }))}
            className="flex w-full items-center justify-between gap-3 rounded-xl bg-white p-4 text-left shadow-sm transition hover:shadow-md"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{u.name}</p>
              <p className="truncate text-sm text-slate-500">{u.tenantName || T.noTenantName}</p>
              {owed > 0 && <p className="text-xs text-red-700">{T.balance}: {peso(owed)}</p>}
            </div>
            <div className="shrink-0 text-right">
              {bill ? (
                <>
                  <p className="font-semibold">{peso(bill.total)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st!.cls}`}>{st!.label}</span>
                </>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {(() => {
                    const next = nextAutoBill(u, data);
                    return next ? T.autoOn(shortDate(next.createOn.toISOString())) : T.notBilled;
                  })()}
                </span>
              )}
            </div>
          </button>
        );
      })}
      </div>
    </>
  );
}

/** Unpaid bills due within 5 days or overdue, each with a one-tap SMS reminder. */
function Reminders({ data, setView, update }: { data: Data; setView: (v: View) => void; update: Update }) {
  const T = t();
  const due = billsToRemind(data);
  if (due.length === 0) return null;

  const markReminded = (billId: string) =>
    update((d) => ({ ...d, bills: d.bills.map((b) => (b.id === billId ? { ...b, remindedAt: new Date().toISOString() } : b)) }));

  return (
    <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-900">{T.reminders}</h2>
      {due.map((b) => {
        const unit = data.units.find((u) => u.id === b.unitId);
        if (!unit) return null;
        const days = daysUntilDue(b);
        const msg = reminderMessage(b, unit, data);
        return (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3">
            <button onClick={() => setView({ name: "bill", billId: b.id, round: false })} className="min-w-[10rem] flex-1 text-left">
              <p className="truncate font-medium">
                {unit.name} · {peso(billSummary(b, unit, data).amountDue)}
              </p>
              <p className={`text-xs ${days < 0 ? "font-semibold text-red-700" : "text-amber-800"}`}>
                {days < 0 ? T.overdueBy(-days) : days === 0 ? T.dueToday : T.dueIn(days)}
                {b.remindedAt && ` · ${T.remindedOn(shortDate(b.remindedAt))}`}
              </p>
            </button>
            {unit.phone ? (
              <a
                href={`sms:${unit.phone.replace(/\s/g, "")}?body=${encodeURIComponent(msg)}`}
                onClick={() => markReminded(b.id)}
                className="shrink-0 rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-medium text-white"
              >
                {T.remind}
              </a>
            ) : (
              <button
                onClick={async () => {
                  if (navigator.share) await navigator.share({ text: msg }).catch(() => {});
                  markReminded(b.id);
                }}
                className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white"
              >
                {T.remind}
              </button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-amber-800">{T.remindHelp}</p>
    </section>
  );
}

/* ================= Unit detail: ledger for one unit ================= */

function UnitDetail({ data, unitId, period, setView }: { data: Data; unitId: string; period: string; setView: (v: View) => void }) {
  const T = t();
  const unit = data.units.find((u) => u.id === unitId);
  if (!unit) return <p>{T.unitNotFound}</p>;
  const bills = data.bills.filter((b) => b.unitId === unitId).sort((a, b) => b.period.localeCompare(a.period));
  const hasThisMonth = bills.some((b) => b.period === period);

  return (
    <div className="space-y-4">
      <button onClick={() => setView({ name: "home" })} className="text-sm text-slate-600">
        {T.backToUnits}
      </button>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
      <section className="space-y-1 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{unit.name}</h2>
            <p className="text-sm text-slate-500">
              {unit.tenantName || T.noTenant} {unit.phone && `· ${unit.phone}`}
            </p>
          </div>
          <button onClick={() => setView({ name: "editUnit", unitId })} className="text-sm font-medium text-emerald-700">
            {T.edit}
          </button>
        </div>
        <p className="pt-2 text-sm">{T.rent}: {peso(unit.rent)}</p>
        {unit.moveInDate && (
          <p className="text-sm">
            {T.moveIn}: {shortDate(unit.moveInDate + "T12:00:00")}
          </p>
        )}
        {unit.deposit > 0 && (
          <p className="text-sm">
            🔒 {T.deposit}: {peso(unit.deposit)}
          </p>
        )}
        {(() => {
          const next = nextAutoBill(unit, data);
          return next ? (
            <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
              {T.nextAutoBill(shortDate(next.createOn.toISOString()), shortDate(next.due.toISOString()))}
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{T.noMoveIn}</p>
          );
        })()}
        {unit.recurring.map((c) => (
          <p key={c.id} className="text-sm">
            {c.photoId ? "📷" : "➕"} {c.label}: {peso(c.amount)}
          </p>
        ))}
        {unit.notes && <p className="pt-1 text-xs text-slate-500">📝 {unit.notes}</p>}
        <p className="pt-2 text-sm">
          {T.outstanding}: <b className="text-red-700">{peso(unitBalance(data, unitId))}</b>
        </p>
      </section>

      {(() => {
        // Automatic tenants: offer to create the NEXT cycle's bill early. Others: bill the selected month.
        const next = nextAutoBill(unit, data);
        if (next) {
          const due = localDate(next.due);
          return (
            <button
              onClick={() => setView({ name: "newBill", unitId, round: false, period: due.slice(0, 7), due })}
              className="w-full rounded-xl border border-emerald-700 bg-white py-3 font-medium text-emerald-700"
            >
              {T.createNowFor(periodLabel(due.slice(0, 7)))}
            </button>
          );
        }
        return (
          !hasThisMonth && (
            <button
              onClick={() => setView({ name: "newBill", unitId, round: false })}
              className="w-full rounded-xl bg-emerald-700 py-3 font-medium text-white"
            >
              {T.createBillFor(periodLabel(period))}
            </button>
          )
        );
      })()}
      </div>

      <div className="space-y-3">
      <h3 className="font-semibold">{T.billsHeader}</h3>
      {bills.length === 0 && <p className="text-sm text-slate-500">{T.noBills}</p>}
      {bills.map((b) => (
        <BillRow key={b.id} bill={b} title={periodLabel(b.period)} onClick={() => setView({ name: "bill", billId: b.id, round: false })} />
      ))}
      </div>
      </div>
    </div>
  );
}

/* ================= Unit add / edit ================= */

function UnitForm({
  unit,
  onSave,
  onDelete,
  onCancel,
}: {
  unit: Unit | null;
  onSave: (u: Unit) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}) {
  const T = t();
  const [u, setU] = useState<Unit>(
    unit ?? {
      id: uid(),
      name: "",
      tenantName: "",
      phone: "",
      rent: 0,
      electric: newMeter(false),
      water: newMeter(false),
      internet: false,
      recurring: [],
      notes: "",
      deposit: 0,
      moveInDate: "",
      createdAt: new Date().toISOString(),
    },
  );
  const [rows, setRows] = useState<BillRow[]>(() =>
    unit
      ? unit.recurring.map((c) => ({ id: c.id, label: c.label, amount: c.amount || null, photo: null, photoId: c.photoId, discount: false }))
      : [newRow(T.electric), newRow(T.water), newRow(T.internet)],
  );
  const [saving, setSaving] = useState(false);
  useLoadRowPhotos(rows, setRows);
  const set = <K extends keyof Unit>(k: K, v: Unit[K]) => setU((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!u.name.trim()) return alert(T.enterUnitName);
    setSaving(true);
    try {
      const recurring: Charge[] = [];
      for (const r of rows.filter((r) => r.label.trim())) {
        recurring.push({ id: r.id, label: r.label.trim(), amount: r.amount ?? 0, photoId: await storeRowPhoto(r) });
      }
      onSave({ ...u, recurring }); // the parent deletes photos nothing uses anymore
    } catch {
      setSaving(false);
      alert(T.photoSaveFail);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-auto max-w-2xl space-y-4"
    >
      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">{unit ? T.editUnit : T.addUnitTitle}</h2>
        <Field label={T.unitName} value={u.name} onChange={(v) => set("name", v)} placeholder={T.unitNamePh} />
        <Field label={T.tenantName} value={u.tenantName} onChange={(v) => set("tenantName", v)} />
        <Field label={T.tenantPhone} value={u.phone} onChange={(v) => set("phone", v)} placeholder={T.phonePh} type="tel" />
        <NumField label={`${T.monthlyRent} (${currencySymbol()})`} value={u.rent} onChange={(v) => set("rent", v ?? 0)} />
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">{T.depositSection}</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label={`${T.deposit} (${currencySymbol()})`} value={u.deposit || null} onChange={(v) => set("deposit", v ?? 0)} />
          <label className="block text-sm">
            <span className="text-slate-500">{T.moveIn}</span>
            <input
              type="date"
              value={u.moveInDate}
              onChange={(e) => set("moveInDate", e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">{T.moveInHelp}</p>
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">{T.monthlyBills}</h3>
        <p className="text-xs text-slate-500">{T.monthlyBillsHelp}</p>
        <BillRowsEditor rows={rows} setRows={setRows} />
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <Field label={T.notes} value={u.notes} onChange={(v) => set("notes", v)} placeholder={T.notesPh} />
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-slate-300 bg-white py-3">
          {T.cancel}
        </button>
        <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-emerald-700 py-3 font-medium text-white disabled:opacity-60">
          {saving ? T.saving : T.saveUnit}
        </button>
      </div>
      {unit && (
        <button type="button" onClick={() => onDelete(unit.id)} className="w-full text-sm text-red-700">
          {T.deleteUnit}
        </button>
      )}
    </form>
  );
}

/* ================= Bill rows: label + cost + photo (shared by unit form and new bill) ================= */

type BillRow = {
  id: string;
  label: string;
  amount: number | null;
  photo: string | null; // data URL currently shown
  photoId?: string; // stored photo this row started with
  discount: boolean;
};

const newRow = (label: string, discount = false): BillRow => ({ id: uid(), label, amount: null, photo: null, discount });

/** Load stored photos for rows that reference one. */
function useLoadRowPhotos(rows: BillRow[], setRows: (fn: (r: BillRow[]) => BillRow[]) => void) {
  const key = rows.flatMap((r) => (r.photoId && !r.photo ? [r.photoId] : [])).join(",");
  useEffect(() => {
    if (!key) return;
    getPhotos(key.split(",")).then((found) =>
      setRows((rs) => rs.map((r) => (r.photoId && !r.photo && found[r.photoId] ? { ...r, photo: found[r.photoId] } : r))),
    );
  }, [key, setRows]);
}

/** Save a row's photo to IndexedDB. Unchanged photos keep their id (photos can be shared; see unusedPhotoIds). */
async function storeRowPhoto(r: BillRow): Promise<string | undefined> {
  if (!r.photo) return undefined;
  if (r.photoId) return r.photoId;
  const id = uid();
  await putPhoto(id, r.photo);
  return id;
}

function BillRowsEditor({ rows, setRows, allowDiscount = false }: { rows: BillRow[]; setRows: (fn: (r: BillRow[]) => BillRow[]) => void; allowDiscount?: boolean }) {
  const T = t();
  const update = (id: string, patch: Partial<BillRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className={`space-y-2 rounded-lg border p-3 ${r.discount ? "border-blue-200 bg-blue-50" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[9rem] flex-[2]">
              <Field label={r.discount ? T.discount : T.label} value={r.label} onChange={(v) => update(r.id, { label: v })} placeholder={r.discount ? T.discountPh : T.electric} />
            </div>
            <div className="min-w-[7rem] flex-1">
              <NumField label={`${T.cost} (${currencySymbol()})`} value={r.amount} onChange={(v) => update(r.id, { amount: v })} placeholder="1000" />
            </div>
            <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="rounded-lg px-3 py-2.5 text-red-700 hover:bg-red-50" aria-label="Remove">
              ✕
            </button>
          </div>
          {!r.discount && <PhotoAttach photo={r.photo} onChange={(p) => update(r.id, { photo: p, photoId: undefined })} />}
        </div>
      ))}
      <div className="flex flex-wrap gap-2 text-sm">
        {[T.electric, T.water, T.internet, ""].map((label) => (
          <button
            key={label || "other"}
            type="button"
            onClick={() => setRows((rs) => [...rs, newRow(label)])}
            className="rounded-full border border-emerald-300 bg-white px-3 py-1 font-medium text-emerald-700"
          >
            + {label || T.other}
          </button>
        ))}
        {allowDiscount && (
          <button type="button" onClick={() => setRows((rs) => [...rs, newRow("", true)])} className="rounded-full border border-blue-300 bg-white px-3 py-1 font-medium text-blue-700">
            − {T.discount}
          </button>
        )}
      </div>
    </div>
  );
}

/* ================= New bill ================= */

const kindOf = (label: string): "electric" | "water" | "internet" | "charge" =>
  /kuryente|electric|meralco/i.test(label) ? "electric" : /tubig|water/i.test(label) ? "water" : /internet|wifi|pldt|converge/i.test(label) ? "internet" : "charge";

function NewBill({
  data,
  unit,
  period,
  existing,
  defaultDue,
  round,
  remaining,
  onSave,
  onSkip,
  onCancel,
}: {
  data: Data;
  unit: Unit;
  period: string;
  existing?: Bill; // set when editing a bill that was already created
  defaultDue?: string; // YYYY-MM-DD, e.g. the next automatic cycle when billing early
  round: boolean;
  remaining: number;
  onSave: (b: Bill) => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const s = data.settings;
  const T = t();
  const [rent, setRent] = useState(() =>
    existing ? sumLines(existing.lines.filter((l) => l.kind === "rent")) : unit.rent,
  );
  const [rows, setRows] = useState<BillRow[]>(() =>
    existing
      ? existing.lines
          .filter((l) => l.kind !== "rent")
          .map((l) => ({
            id: uid(),
            label: l.label,
            amount: Math.abs(l.amount),
            photo: null,
            photoId: l.billPhotoId ?? l.photoId,
            discount: l.kind === "discount",
          }))
      : unit.recurring.map((c) => ({ id: uid(), label: c.label, amount: c.amount || null, photo: null, photoId: c.photoId, discount: false })),
  );
  const [dueDate, setDueDate] = useState(() => {
    if (existing) return localDate(new Date(existing.dueDate));
    if (defaultDue) return defaultDue;
    if (unit.moveInDate) return localDate(nextDueFromMoveIn(unit.moveInDate));
    const due = new Date();
    due.setDate(due.getDate() + s.dueDays);
    return localDate(due);
  });
  useLoadRowPhotos(rows, setRows);
  const [saving, setSaving] = useState(false);
  const prevBal = previousBalance(data, unit.id, period);

  const filled = rows.filter((r) => r.amount && r.label.trim());
  const lines: Line[] = [];
  if (rent) lines.push({ id: "rent", kind: "rent", label: T.rentLine, amount: rent });
  for (const r of filled) {
    lines.push(
      r.discount
        ? { id: r.id, kind: "discount", label: r.label.trim(), amount: -Math.abs(r.amount!) }
        : { id: r.id, kind: kindOf(r.label), label: r.label.trim(), amount: r.amount! },
    );
  }
  const total = sumLines(lines);

  async function submit() {
    const empty = rows.filter((r) => !r.discount && r.label.trim() && !r.amount).map((r) => r.label);
    if (empty.length && !confirm(T.confirmNoCost(empty.join(", "), empty.length > 1))) return;
    const noPhoto = filled.filter((r) => !r.discount && !r.photo).map((r) => r.label);
    if (noPhoto.length && !confirm(T.confirmNoPhoto(noPhoto.join(", ")))) return;
    if (total <= 0 && !confirm(T.confirmZero)) return;

    setSaving(true);
    try {
      const saved: Line[] = [];
      for (const l of lines) {
        const row = filled.find((r) => r.id === l.id);
        saved.push({ ...l, id: uid(), billPhotoId: row ? await storeRowPhoto(row) : undefined });
      }
      const now = new Date().toISOString();
      const due = new Date(dueDate + "T12:00:00").toISOString();
      onSave(
        existing
          ? { ...existing, lines: saved, total, dueDate: due, updatedAt: now, reviewed: true } // payments are kept
          : {
              id: uid(),
              number: data.nextBillNo,
              unitId: unit.id,
              period,
              createdAt: now,
              dueDate: due,
              lines: saved,
              total,
              payments: [],
            },
      );
    } catch {
      setSaving(false);
      alert(T.photoSaveFail);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        {round && <p className="text-xs font-medium uppercase text-emerald-700">{T.roundLeft(remaining)}</p>}
        <h2 className="text-lg font-semibold">
          {existing ? T.editingBill(unit.name, periodLabel(period)) : `${unit.name} — ${periodLabel(period)}`}
        </h2>
        <p className="text-sm text-slate-500">{unit.tenantName}</p>
        {prevBal > 0 && <p className="mt-1 text-sm text-red-700">{T.prevBalNote(peso(prevBal))}</p>}
      </div>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <NumField label={`${T.rentThisMonth} (${currencySymbol()})`} value={rent} onChange={(v) => setRent(v ?? 0)} />
        <label className="block text-sm">
          <span className="text-slate-500">{T.dueDate}</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => e.target.value && setDueDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">{T.billsThisMonth}</h3>
        <BillRowsEditor rows={rows} setRows={setRows} allowDiscount />
      </section>

      <section className="rounded-xl bg-emerald-50 p-4 text-sm">
        {lines.map((l) => (
          <Row key={l.id} label={(filled.find((r) => r.id === l.id)?.photo ? "📷 " : "") + l.label} value={peso(l.amount)} />
        ))}
        <div className="mt-2 flex justify-between border-t border-emerald-200 pt-2 text-lg font-bold">
          <span>{T.thisMonth}</span>
          <span>{peso(total)}</span>
        </div>
        {prevBal > 0 && (
          <>
            <Row label={T.plusPrevBal} value={peso(prevBal)} />
            <div className="flex justify-between font-semibold text-red-700">
              <span>{T.totalDue}</span>
              <span>{peso(round2(total + prevBal))}</span>
            </div>
          </>
        )}
      </section>

      <div className="flex gap-2">
        <button onClick={round ? onSkip : onCancel} disabled={saving} className="flex-1 rounded-lg border border-slate-300 bg-white py-3">
          {round ? T.skipUnit : T.cancel}
        </button>
        <button onClick={submit} disabled={saving} className="flex-1 rounded-lg bg-emerald-700 py-3 font-medium text-white disabled:opacity-60">
          {saving ? T.saving : existing ? T.saveChanges : T.saveBill}
        </button>
      </div>
      {round && (
        <button onClick={onCancel} className="w-full text-sm text-slate-500">
          {T.stopRound}
        </button>
      )}
    </div>
  );
}

/** Small "upload bill photo" control. */
function PhotoAttach({ photo, onChange }: { photo: string | null; onChange: (p: string | null) => void }) {
  const T = t();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onChange(await toSmallJpeg(f));
          e.target.value = "";
        }}
      />
      {photo ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          <img src={photo} alt="Bill" className="h-16 w-16 rounded object-cover" />
          <button type="button" onClick={() => onChange(null)} className="text-xs text-red-700">
            {T.removePhoto}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} className="text-xs font-medium text-slate-600">
          {T.uploadPhoto}
        </button>
      )}
    </div>
  );
}

/* ================= Bill view: send + record payments ================= */

function BillView({
  data,
  billId,
  update,
  nextUnit,
  setView,
}: {
  data: Data;
  billId: string;
  update: Update;
  nextUnit?: Unit;
  setView: (v: View) => void;
}) {
  const T = t();
  const bill = data.bills.find((b) => b.id === billId);
  const unit = bill && data.units.find((u) => u.id === bill.unitId);
  const [copied, setCopied] = useState(false);
  const [payAmount, setPayAmount] = useState<number | null>(bill ? Math.max(0, balance(bill)) : null);
  const [payDate, setPayDate] = useState(localDate());
  const [payNote, setPayNote] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const photoKey = bill ? linePhotoIds(bill).join(",") : "";
  useEffect(() => {
    if (photoKey) getPhotos(photoKey.split(",")).then(setPhotos);
  }, [photoKey]);
  if (!bill || !unit) return <p>{T.billNotFound}</p>;

  // Every photo on the bill with a caption: meter photos first, then uploaded bills.
  const photoList = bill.lines.flatMap((l) => {
    const out: { key: string; src: string; caption: string }[] = [];
    const isMeter = (l.kind === "electric" || l.kind === "water") && !!l.meter;
    if (l.photoId && photos[l.photoId])
      out.push({ key: l.photoId, src: photos[l.photoId], caption: isMeter ? `${l.label} — meter` : T.photoCaption(l.label, peso(l.amount)) });
    if (l.billPhotoId && photos[l.billPhotoId])
      out.push({ key: l.billPhotoId, src: photos[l.billPhotoId], caption: T.photoCaption(l.label, peso(l.amount)) });
    return out;
  });

  const msg = billMessage(bill, unit, data);
  const summary = billSummary(bill, unit, data);
  const smsHref = `sms:${unit.phone.replace(/\s/g, "")}?body=${encodeURIComponent(msg)}`;
  const st = statusStyle(status(bill));
  const bal = balance(bill);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ text: msg });
      } catch {
        /* user cancelled */
      }
    } else {
      await copy();
    }
  }
  async function copy() {
    // navigator.clipboard only exists on HTTPS; fall back for local-network testing.
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(msg);
    } else {
      const ta = document.createElement("textarea");
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendImage() {
    setImgBusy(true);
    try {
      const blob = await renderBillImage(
        summary,
        photoList.map(({ caption, src }) => ({ caption, src })),
      );
      const file = new File([blob], `singil-${unit!.name.replace(/\W+/g, "-")}-${bill!.period}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: msg });
        } catch {
          /* user cancelled */
        }
      } else {
        // Sharing files needs HTTPS; on plain http save the image so it can be attached in Messenger.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        alert(T.imageSaved);
      }
    } catch {
      alert(T.imageFail);
    } finally {
      setImgBusy(false);
    }
  }

  function addPayment() {
    if (!payAmount || payAmount <= 0) return alert(T.enterAmountPaid);
    if (payAmount > bal && !confirm(T.overpay(peso(payAmount), peso(bal)))) return;
    update((d) => ({
      ...d,
      bills: d.bills.map((b) =>
        b.id === billId
          ? { ...b, payments: [...b.payments, { id: uid(), amount: round2(payAmount), date: new Date(payDate + "T12:00:00").toISOString(), note: payNote }] }
          : b,
      ),
    }));
    setPayAmount(Math.max(0, round2(bal - payAmount)));
    setPayNote("");
  }

  function removePayment(pid: string) {
    if (!confirm(T.removePaymentQ)) return;
    update((d) => ({
      ...d,
      bills: d.bills.map((b) => (b.id === billId ? { ...b, payments: b.payments.filter((p) => p.id !== pid) } : b)),
    }));
  }

  function deleteBill() {
    if (!confirm(T.deleteBillQ)) return;
    deletePhotos(unusedPhotoIds(linePhotoIds(bill!), { ...data, bills: data.bills.filter((x) => x.id !== billId) }));
    update((d) => {
      const b = d.bills.find((x) => x.id === billId)!;
      const meterPrev = (kind: "electric" | "water") => {
        const l = b.lines.find((x) => x.kind === kind);
        return l && (l.kind === "electric" || l.kind === "water") && l.meter ? l.meter.prev : null;
      };
      return {
        ...d,
        bills: d.bills.filter((x) => x.id !== billId),
        units: d.units.map((u) => {
          if (u.id !== b.unitId) return u;
          const e = meterPrev("electric");
          const w = meterPrev("water");
          return {
            ...u,
            electric: e !== null ? { ...u.electric, last: e } : u.electric,
            water: w !== null ? { ...u.water, last: w } : u.water,
          };
        }),
      };
    });
    setView({ name: "unit", unitId: bill!.unitId });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setView({ name: "unit", unitId: unit.id })} className="text-sm text-slate-600">
          ← {unit.name}
        </button>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${st.cls}`}>{st.label}</span>
      </div>

      {nextUnit && (
        <button
          onClick={() => setView({ name: "newBill", unitId: nextUnit.id, round: true })}
          className="w-full rounded-xl bg-emerald-700 py-3 font-semibold text-white"
        >
          {T.nextUnit(nextUnit.name)}
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4">
      <section className="rounded-xl border-l-8 border-amber-500 bg-amber-100 p-4 text-center">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-900">{T.amountToPay}</p>
        <p className="break-words text-3xl font-extrabold sm:text-4xl">{peso(summary.amountDue)}</p>
        <p className="text-sm text-amber-900">{T.dueOn(summary.dueDate)}</p>
        {bill.updatedAt && <p className="mt-1 text-xs text-amber-800">{T.updatedOn(shortDate(bill.updatedAt))}</p>}
      </section>
      {unit.deposit > 0 && <p className="text-center text-xs text-slate-500">{T.depositInfo(peso(unit.deposit))}</p>}

      {bill.auto && !bill.reviewed && !bill.updatedAt && (
        <section className="space-y-2 rounded-xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-900">
          <p>{T.autoCreated(shortDate(bill.createdAt))}</p>
          <p>{T.autoCheck}</p>
          <button
            onClick={() => update((d) => ({ ...d, bills: d.bills.map((b) => (b.id === bill.id ? { ...b, reviewed: true } : b)) }))}
            className="w-full rounded-lg bg-blue-600 py-2 font-medium text-white"
          >
            {T.amountsCorrect}
          </button>
        </section>
      )}

      <pre className="whitespace-pre-wrap rounded-xl bg-white p-4 font-sans text-sm shadow-sm">{msg}</pre>

      {photoList.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 font-semibold">{T.photos}</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-2">
            {photoList.map((p) => (
              <button key={p.key} onClick={() => setEnlarged(p.src)} className="text-left">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
                <img src={p.src} alt={p.caption} className="h-32 w-full rounded-lg bg-slate-100 object-cover md:h-40" />
                <p className="mt-1 text-xs text-slate-600">{p.caption}</p>
              </button>
            ))}
          </div>
        </section>
      )}
      </div>

      <div className="space-y-4">
      <button onClick={sendImage} disabled={imgBusy} className="w-full rounded-lg bg-emerald-700 py-3 font-semibold text-white disabled:opacity-60">
        {imgBusy ? T.creatingImage : T.sendImage(photoList.length > 0)}
      </button>

      <div className="grid grid-cols-3 gap-2 text-sm">
        {unit.phone ? (
          <a href={smsHref} className="rounded-lg bg-slate-900 py-3 text-center font-medium text-white">
            💬 SMS
          </a>
        ) : (
          <span className="rounded-lg bg-slate-200 py-3 text-center text-slate-500">{T.noNumber}</span>
        )}
        <button onClick={share} className="rounded-lg bg-blue-600 py-3 font-medium text-white">
          {T.text}
        </button>
        <button onClick={copy} className="rounded-lg border border-slate-300 bg-white py-3 font-medium">
          {copied ? T.copied : T.copy}
        </button>
      </div>

      <button
        onClick={() => setView({ name: "editBill", billId: bill.id })}
        className="w-full rounded-lg border border-slate-300 bg-white py-3 font-medium"
      >
        {T.editBill}
      </button>

      {enlarged && (
        <button onClick={() => setEnlarged(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
          <img src={enlarged} alt="Photo" className="max-h-full max-w-full object-contain" />
        </button>
      )}

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex justify-between">
          <h3 className="font-semibold">{T.payments}</h3>
          <p className="text-sm">{T.paidOf(peso(paidAmount(bill)), peso(bill.total))}</p>
        </div>
        {bill.payments.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
            <div>
              <p className="font-medium text-emerald-700">{peso(p.amount)}</p>
              <p className="text-xs text-slate-500">
                {shortDate(p.date)} {p.note && `· ${p.note}`}
              </p>
            </div>
            <button onClick={() => removePayment(p.id)} className="text-xs text-red-700">
              {T.remove}
            </button>
          </div>
        ))}
        {bal > 0 ? (
          <>
            <p className="text-sm">
              {T.remaining}: <b className="text-red-700">{peso(bal)}</b>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumField label={`${T.amount} (${currencySymbol()})`} value={payAmount} onChange={setPayAmount} />
              <label className="block text-sm">
                <span className="text-slate-500">{T.date}</span>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <Field label={T.payNote(data.settings.paymentMethod || "GCash")} value={payNote} onChange={setPayNote} />
            <button onClick={addPayment} className="w-full rounded-lg bg-emerald-700 py-3 font-medium text-white">
              {T.recordPayment}
            </button>
          </>
        ) : (
          <p className="text-sm font-medium text-emerald-700">{T.fullyPaid}</p>
        )}
      </section>

      <button onClick={deleteBill} className="w-full py-2 text-sm text-red-700">
        {T.deleteBill}
      </button>
      </div>
      </div>
    </div>
  );
}

/* ================= All bills ================= */

function History({ data, setView }: { data: Data; setView: (v: View) => void }) {
  const T = t();
  const [filter, setFilter] = useState<"all" | "unpaid">("unpaid");
  const all = [...data.bills].sort((a, b) => b.period.localeCompare(a.period) || a.number - b.number);
  const bills = filter === "unpaid" ? all.filter((b) => balance(b) > 0) : all;
  const unitName = (id: string) => data.units.find((u) => u.id === id)?.name ?? T.deletedUnit;
  const owed = round2(all.reduce((s, b) => s + Math.max(0, balance(b)), 0));

  return (
    <>
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">{T.totalUnpaidAll}</p>
        <p className="text-2xl font-bold text-red-700">{peso(owed)}</p>
      </section>
      <div className="grid grid-cols-2 rounded-lg bg-slate-200 p-1 text-sm">
        {(["unpaid", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-md py-2 ${filter === f ? "bg-white font-semibold shadow-sm" : ""}`}>
            {f === "unpaid" ? T.unpaid : T.allBills}
          </button>
        ))}
      </div>
      {bills.length === 0 && <p className="text-center text-sm text-slate-500">{T.nothingHere}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {bills.map((b) => (
        <BillRow
          key={b.id}
          bill={b}
          title={`${unitName(b.unitId)} · ${periodLabel(b.period)}`}
          onClick={() => setView({ name: "bill", billId: b.id, round: false })}
        />
      ))}
      </div>
    </>
  );
}

/* ================= Settings ================= */

function SettingsForm({ data, onSave, onImport }: { data: Data; onSave: (s: Settings) => void; onImport: (d: Data) => void }) {
  const [s, setS] = useState<Settings>(data.settings);
  // Preview the chosen language while editing, before it is saved.
  configure(s);
  const T = t();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function exportBackup() {
    const photos = await getPhotos(data.bills.flatMap(linePhotoIds));
    const blob = new Blob([JSON.stringify({ ...data, photos })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `singil-backup-${localDate()}.json`;
    a.click();
  }

  async function importBackup(file: File) {
    try {
      const text = await file.text();
      const d = parseBackup(text);
      const photos: Record<string, string> = JSON.parse(text).photos ?? {};
      if (!confirm(T.restoreQ(d.units.length, d.bills.length))) return;
      for (const [id, p] of Object.entries(photos)) await putPhoto(id, p);
      onImport(d);
    } catch {
      alert(T.invalidBackup);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(s);
        }}
        className="space-y-3 rounded-xl bg-white p-4 shadow-sm"
      >
        <h2 className="text-lg font-semibold">{T.settings}</h2>
        <Choice
          label={T.language}
          value={s.language}
          options={[
            ["en", "🇺🇸 English"],
            ["fil", "🇵🇭 Filipino"],
          ]}
          onChange={(v) => set("language", v)}
        />
        <Choice
          label={T.currency}
          value={s.currency}
          options={[
            ["PHP", "₱ Peso"],
            ["USD", "$ Dollar"],
          ]}
          onChange={(v) => set("currency", v)}
        />
        <Field label={T.propertyName} value={s.propertyName} onChange={(v) => set("propertyName", v)} placeholder={T.propertyNamePh} />
        <Field label={T.ownerName} value={s.ownerName} onChange={(v) => set("ownerName", v)} />
        <Field label={T.paymentMethod} value={s.paymentMethod} onChange={(v) => set("paymentMethod", v)} placeholder={T.paymentMethodPh} />
        <Field label={T.accountNumber} value={s.gcashNumber} onChange={(v) => set("gcashNumber", v)} />
        <Field label={T.accountName} value={s.gcashName} onChange={(v) => set("gcashName", v)} />
        <NumField label={T.autoBillDays} value={s.autoBillDays} onChange={(v) => set("autoBillDays", v ?? 0)} />
        <NumField label={T.dueDays} value={s.dueDays} onChange={(v) => set("dueDays", v ?? 0)} />
        <button type="submit" className="w-full rounded-lg bg-emerald-700 py-3 font-medium text-white">
          {T.saveSettings}
        </button>
      </form>

      <section className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
        <h3 className="font-semibold">{T.backup}</h3>
        <p className="text-xs text-slate-500">{T.backupHelp}</p>
        <button onClick={exportBackup} className="w-full rounded-lg border border-slate-300 py-2">
          {T.downloadBackup}
        </button>
        <label className="block w-full cursor-pointer rounded-lg border border-slate-300 py-2 text-center">
          {T.restoreBackup}
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
        </label>
      </section>
    </div>
  );
}

/* ================= Small UI helpers ================= */

function BillRow({ bill, title, onClick }: { bill: Bill; title: string; onClick: () => void }) {
  const T = t();
  const st = statusStyle(status(bill));
  const bal = balance(bill);
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{title}</p>
        <p className="text-xs text-slate-500">
          #{String(bill.number).padStart(4, "0")} · {T.dueShort} {shortDate(bill.dueDate)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold">{peso(bill.total)}</p>
        {bal > 0 && bal < bill.total && <p className="text-xs text-red-700">{T.balShort} {peso(bal)}</p>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
      </div>
    </button>
  );
}

function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
}) {
  return (
    <div className="text-sm">
      <span className="text-slate-500">{label}</span>
      <div className="mt-1 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-md py-2 ${value === v ? "bg-white font-semibold shadow-sm" : "text-slate-600"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-sm font-bold ${cls}`}>{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

/** Number input that keeps what the user is typing (e.g. "12." or "") instead of snapping to 0. */
function NumField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  return (
    <label className="block text-sm">
      <span className="text-slate-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.]/g, "");
          setText(t);
          const n = parseFloat(t);
          onChange(t === "" || isNaN(n) ? null : n);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  );
}
