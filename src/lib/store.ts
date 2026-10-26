import { Currency, Lang, formatMoney, locale, t } from "./i18n";

// Local-first data store. Everything lives in the browser's localStorage for the
// pilot; swap this module for Supabase when landlords need multi-device sync.

export type Settings = {
  language: Lang;
  currency: Currency;
  paymentMethod: string; // GCash, Venmo, Zelle…
  propertyName: string;
  ownerName: string;
  electricRate: number; // default ₱ per kWh for units without their own rate
  waterRate: number; // default ₱ per m³
  gcashName: string;
  gcashNumber: string;
  dueDays: number; // days after billing date (units without a move-in date)
  autoBillDays: number; // auto-create each bill this many days before its due date
};

export type MeterConfig = {
  enabled: boolean;
  // "meter": bill = (new − last reading) × rate. "exact": landlord types the amount from the utility bill.
  mode: "meter" | "exact";
  rate: number | null; // null = use the property default from Settings
  minCharge: number; // minimum ₱ charged even if usage is low (0 = none)
  last: number | null; // last recorded reading
};

// A monthly bill of the unit (Kuryente, Tubig, Internet, parking…) with an optional bill photo.
export type Charge = { id: string; label: string; amount: number; photoId?: string };

export type Unit = {
  id: string;
  name: string;
  tenantName: string;
  phone: string;
  email?: string; // for sending the bill by email
  rent: number;
  electric: MeterConfig; // .enabled = unit pays an electric bill
  water: MeterConfig;
  internet: boolean;
  recurring: Charge[]; // added to every bill: wifi, parking, garbage…
  notes: string;
  deposit: number; // security deposit held — shown on bills for reference, never added to totals
  moveInDate: string; // YYYY-MM-DD; rent is due on this day of every month ("" = not set)
  createdAt: string; // auto-billing never back-fills cycles before the profile existed
};

export type MeterLine = { prev: number; curr: number; rate: number; minCharge: number };

// Photos live in IndexedDB (see photos.ts). photoId: meter photo for metered lines,
// otherwise a receipt. billPhotoId: the uploaded utility bill (Meralco, water, internet…).
type LineBase = { id: string; label: string; amount: number; photoId?: string; billPhotoId?: string };

export type Line =
  | (LineBase & { kind: "rent" })
  | (LineBase & { kind: "electric" | "water"; meter?: MeterLine }) // no meter = exact amount
  | (LineBase & { kind: "internet" | "charge" })
  | (LineBase & { kind: "discount" }); // amount stored as negative

export const linePhotoIds = (b: Bill) => b.lines.flatMap((l) => [l.photoId, l.billPhotoId].filter((x): x is string => !!x));

export type Payment = { id: string; amount: number; date: string; note: string };

export type Bill = {
  id: string;
  number: number;
  unitId: string;
  period: string; // YYYY-MM
  createdAt: string;
  dueDate: string;
  lines: Line[];
  total: number;
  payments: Payment[];
  updatedAt?: string; // set when the landlord edits the bill after creating it
  remindedAt?: string; // last time the landlord sent a payment reminder
  auto?: boolean; // created automatically from the tenant profile
  reviewed?: boolean; // landlord confirmed (or edited) the amounts of an auto bill
};

export type Data = { version: 2; settings: Settings; units: Unit[]; bills: Bill[]; nextBillNo: number };

const KEY = "singil:v1";

export const defaultSettings: Settings = {
  language: "fil",
  currency: "PHP",
  paymentMethod: "GCash",
  propertyName: "",
  ownerName: "",
  electricRate: 13,
  waterRate: 80,
  gcashName: "",
  gcashNumber: "",
  dueDays: 5,
  autoBillDays: 7,
};

export const defaultData: Data = { version: 2, settings: defaultSettings, units: [], bills: [], nextBillNo: 1 };

export const newMeter = (enabled: boolean): MeterConfig => ({ enabled, mode: "meter", rate: null, minCharge: 0, last: null });

// Older units marked electric/water/internet with checkboxes; turn those into
// regular monthly-bill rows so every bill uses the same label + cost + photo format.
const fixUnit = (u: Unit): Unit => {
  const recurring = [...(u.recurring ?? [])];
  const has = (re: RegExp) => recurring.some((c) => re.test(c.label));
  if (u.electric?.enabled && !has(/kuryente|electric/i)) recurring.unshift({ id: uid(), label: "Kuryente", amount: 0 });
  if (u.water?.enabled && !has(/tubig|water/i)) recurring.push({ id: uid(), label: "Tubig", amount: 0 });
  if (u.internet && !has(/internet|wifi/i)) recurring.push({ id: uid(), label: "Internet", amount: 0 });
  return {
    ...u,
    deposit: u.deposit ?? 0,
    moveInDate: u.moveInDate ?? "",
    createdAt: u.createdAt ?? new Date().toISOString(),
    recurring,
    internet: false,
    electric: { ...newMeter(false), ...u.electric, enabled: false },
    water: { ...newMeter(false), ...u.water, enabled: false },
  };
};

/* ---------- migration from the first version's data shape ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrate(raw: any): Data {
  if (raw?.version === 2) {
    return { ...defaultData, ...raw, settings: { ...defaultSettings, ...raw.settings }, units: raw.units.map(fixUnit) };
  }
  const settings = { ...defaultSettings, ...(raw?.settings ?? {}) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const units: Unit[] = (raw?.units ?? []).map((u: any) => ({
    id: u.id,
    name: u.name ?? "",
    tenantName: u.tenantName ?? "",
    phone: u.phone ?? "",
    rent: u.rent ?? 0,
    electric: { ...newMeter(u.trackElectric ?? true), last: u.lastElectric ?? null },
    water: { ...newMeter(u.trackWater ?? false), last: u.lastWater ?? null },
    internet: false,
    recurring: [],
    notes: "",
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bills: Bill[] = (raw?.bills ?? []).map((b: any, i: number) => {
    const lines: Line[] = [];
    if (b.rent) lines.push({ id: uid(), kind: "rent", label: "Upa (Rent)", amount: b.rent });
    for (const kind of ["electric", "water"] as const) {
      const m = b[kind];
      if (m) {
        const meter = { prev: m.prev, curr: m.curr, rate: m.rate, minCharge: 0 };
        lines.push({ id: uid(), kind, label: kind === "electric" ? "Kuryente" : "Tubig", amount: meterAmount(meter), meter });
      }
    }
    if (b.otherAmount) lines.push({ id: uid(), kind: "charge", label: b.otherLabel || "Iba pa", amount: b.otherAmount });
    return {
      id: b.id,
      number: i + 1,
      unitId: b.unitId,
      period: b.period,
      createdAt: b.createdAt,
      dueDate: b.dueDate,
      lines,
      total: sumLines(lines),
      payments: b.paidAt ? [{ id: uid(), amount: b.total, date: b.paidAt, note: "" }] : [],
    };
  });
  return { version: 2, settings, units: units.map(fixUnit), bills, nextBillNo: bills.length + 1 };
}

export function load(): Data {
  if (typeof window === "undefined") return defaultData;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultData;
  } catch {
    return defaultData;
  }
}

export function save(data: Data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

/** Bring data from the cloud (possibly saved by an older app version) up to the current shape. */
export const normalizeData = (raw: unknown): Data => migrate(raw);

export function parseBackup(text: string): Data {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.units) || !Array.isArray(parsed.bills)) throw new Error("invalid");
  return migrate(parsed);
}

/* ---------- money & meter math ---------- */

export const uid = () => Math.random().toString(36).slice(2, 10);
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** YYYY-MM-DD in the phone's own timezone (toISOString would give the UTC date, a day off in PH mornings). */
export const localDate = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const currentPeriod = () => localDate().slice(0, 7);

/** Money in the landlord's chosen currency (name kept from when the app was peso-only). */
export const peso = (n: number) => formatMoney(n);

export const periodLabel = (p: string) =>
  new Date(p + "-01T00:00:00").toLocaleDateString(locale(), { month: "long", year: "numeric" });

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { month: "short", day: "numeric", year: "numeric" });

export const usage = (m: { prev: number; curr: number }) => round2(Math.max(0, m.curr - m.prev));

export const meterAmount = (m: MeterLine) => round2(Math.max(usage(m) * m.rate, m.minCharge));

export const sumLines = (lines: Line[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

export const effectiveRate = (unit: Unit, kind: "electric" | "water", s: Settings) =>
  unit[kind].rate ?? (kind === "electric" ? s.electricRate : s.waterRate);

/* ---------- payments & balances ---------- */

export const paidAmount = (b: Bill) => round2(b.payments.reduce((s, p) => s + p.amount, 0));
export const balance = (b: Bill) => round2(b.total - paidAmount(b));

export type Status = "paid" | "partial" | "unpaid" | "overdue";
export function status(b: Bill): Status {
  const bal = balance(b);
  if (bal <= 0) return "paid";
  if (new Date(b.dueDate) < new Date(new Date().toDateString())) return "overdue";
  return paidAmount(b) > 0 ? "partial" : "unpaid";
}

const STATUS_CLS: Record<Status, string> = {
  paid: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  unpaid: "bg-red-100 text-red-800",
  overdue: "bg-red-600 text-white",
};

export const statusStyle = (st: Status) => ({ label: t().status[st], cls: STATUS_CLS[st] });

/** Unpaid balance from this unit's bills for months before `period`. */
export function previousBalance(data: Data, unitId: string, period: string) {
  return round2(
    data.bills.filter((b) => b.unitId === unitId && b.period < period).reduce((s, b) => s + Math.max(0, balance(b)), 0),
  );
}

export function unitBalance(data: Data, unitId: string) {
  return round2(data.bills.filter((b) => b.unitId === unitId).reduce((s, b) => s + Math.max(0, balance(b)), 0));
}

/* ---------- what the tenant sees (text message + bill image) ---------- */

export type BillSummary = {
  title: string; // property name
  billNo: string;
  unitLine: string;
  month: string;
  items: { label: string; detail: string; amount: number }[];
  monthTotal: number;
  paid: number;
  prevBalance: number;
  amountDue: number; // the exact amount the tenant should send
  dueDate: string;
  payMethod: string;
  payAccount: string;
  hasPhotos: boolean;
  updated: string; // "" unless the bill was edited after it was created
  deposit: number; // informational only
};

export function billSummary(bill: Bill, unit: Unit, data: Data): BillSummary {
  const s = data.settings;
  const prevBalance = previousBalance(data, unit.id, bill.period);
  return {
    title: s.propertyName || t().propertyFallback,
    billNo: `#${String(bill.number).padStart(4, "0")}`,
    unitLine: `${unit.name}${unit.tenantName ? ` — ${unit.tenantName}` : ""}`,
    month: periodLabel(bill.period),
    items: bill.lines.map((l) => {
      if ((l.kind === "electric" || l.kind === "water") && l.meter) {
        const m = l.meter;
        return { label: l.label, detail: `${usage(m)} ${l.kind === "electric" ? "kWh" : "m³"} × ${peso(m.rate)}`, amount: l.amount };
      }
      return { label: l.label, detail: "", amount: l.amount };
    }),
    monthTotal: bill.total,
    paid: paidAmount(bill),
    prevBalance,
    amountDue: round2(Math.max(0, balance(bill)) + prevBalance),
    dueDate: shortDate(bill.dueDate),
    payMethod: s.paymentMethod || "GCash",
    payAccount: s.gcashNumber ? `${s.gcashNumber}${s.gcashName ? ` (${s.gcashName})` : ""}` : "",
    hasPhotos: bill.lines.some((l) => l.photoId || l.billPhotoId),
    updated: bill.updatedAt ? shortDate(bill.updatedAt) : "",
    deposit: unit.deposit ?? 0,
  };
}

export function billMessage(bill: Bill, unit: Unit, data: Data) {
  const b = billSummary(bill, unit, data);
  const T = t().bill;
  const lines = [`${T.heading} ${b.billNo} — ${b.title}`, b.unitLine, `${T.billingMonth}: ${b.month}`];
  if (bill.updatedAt) lines.push(T.updated(shortDate(bill.updatedAt)));
  lines.push("");
  for (const it of b.items) lines.push(`${it.label}${it.detail ? ` (${it.detail})` : ""}: ${peso(it.amount)}`);
  lines.push("", `${T.thisMonth}: ${peso(b.monthTotal)}`);
  if (b.paid > 0) lines.push(`${T.paid}: −${peso(b.paid)}`);
  if (b.prevBalance > 0) lines.push(`${T.prevBalance}: ${peso(b.prevBalance)}`);
  lines.push("", `👉 ${T.amountToPay}: ${peso(b.amountDue)}`, `${T.due}: ${b.dueDate}`);
  if (b.deposit > 0) lines.push(T.deposit(peso(b.deposit)));
  if (b.payAccount) lines.push("", `${T.sendVia(b.payMethod)} ${b.payAccount}`);
  if (b.hasPhotos) lines.push(T.photosAttached);
  lines.push(T.thanks);
  return lines.join("\n");
}

/* ---------- due dates & reminders ---------- */

/** Next due date after `from`: the move-in day of the month (clamped to short months), e.g. moved in Oct 27 → Nov 27. */
export function nextDueFromMoveIn(moveInDate: string, from: Date = new Date()): Date {
  const day = Number(moveInDate.slice(8, 10));
  const at = (y: number, m: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()), 12);
  // Nothing is due before the tenant moves in: count from the move-in date if it is later.
  const moveIn = new Date(moveInDate + "T12:00:00");
  if (localDate(moveIn) > localDate(from)) from = moveIn;
  let due = at(from.getFullYear(), from.getMonth());
  if (localDate(due) <= localDate(from)) due = at(from.getFullYear(), from.getMonth() + 1);
  return due;
}

/** Whole days from today until the bill is due (negative = overdue). */
export function daysUntilDue(bill: Bill, today: Date = new Date()) {
  const a = new Date(localDate(new Date(bill.dueDate)) + "T00:00:00");
  const b = new Date(localDate(today) + "T00:00:00");
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export const REMIND_DAYS_BEFORE = 5;

/** Unpaid bills due within the reminder window or already overdue, most urgent first. */
export function billsToRemind(data: Data, today: Date = new Date()) {
  return data.bills
    .filter((b) => balance(b) > 0 && daysUntilDue(b, today) <= REMIND_DAYS_BEFORE)
    .sort((a, b) => daysUntilDue(a, today) - daysUntilDue(b, today));
}

export function reminderMessage(bill: Bill, unit: Unit, data: Data) {
  const b = billSummary(bill, unit, data);
  return t().bill.reminder({
    name: unit.tenantName.split(" ")[0],
    amount: peso(b.amountDue),
    unit: unit.name,
    due: b.dueDate,
    overdue: daysUntilDue(bill) < 0,
    pay: b.payAccount ? `${t().bill.sendVia(b.payMethod)} ${b.payAccount}` : "",
  });
}

/* ---------- automatic monthly bills ---------- */

/**
 * Create every bill whose creation day (due date − autoBillDays) has arrived, from the
 * tenant profile: rent + monthly bills. Runs whenever the app opens, so missed days
 * catch up. A unit gets at most one bill per due cycle.
 */
export function withAutoBills(data: Data, today: Date = new Date()): Data {
  const lead = data.settings.autoBillDays ?? 7;
  const todayStr = localDate(today);
  let next = data.nextBillNo;
  const created: Bill[] = [];

  for (const unit of data.units) {
    if (!unit.moveInDate) continue;
    const startStr = [unit.moveInDate, localDate(new Date(unit.createdAt))].sort()[1];
    let due = nextDueFromMoveIn(unit.moveInDate, new Date(startStr + "T12:00:00"));
    for (let guard = 0; guard < 24; guard++) {
      const createOn = new Date(due);
      createOn.setDate(createOn.getDate() - lead);
      if (localDate(createOn) > todayStr) break;
      const dueStr = localDate(due);
      const period = dueStr.slice(0, 7);
      const exists = [...data.bills, ...created].some(
        (b) => b.unitId === unit.id && (b.period === period || localDate(new Date(b.dueDate)) === dueStr),
      );
      if (!exists) {
        const lines: Line[] = [];
        if (unit.rent) lines.push({ id: uid(), kind: "rent", label: t().rentLine, amount: unit.rent });
        for (const c of unit.recurring) {
          if (!c.amount) continue;
          lines.push({ id: uid(), kind: "charge", label: c.label, amount: c.amount, billPhotoId: c.photoId });
        }
        created.push({
          id: uid(),
          number: next++,
          unitId: unit.id,
          period,
          createdAt: createOn.toISOString(),
          dueDate: due.toISOString(),
          lines,
          total: sumLines(lines),
          payments: [],
          auto: true,
        });
      }
      due = nextDueFromMoveIn(unit.moveInDate, due);
    }
  }
  return created.length ? { ...data, bills: [...data.bills, ...created], nextBillNo: next } : data;
}

/** When the next automatic bill will be created and when it is due. */
export function nextAutoBill(unit: Unit, data: Data, today: Date = new Date()) {
  if (!unit.moveInDate) return null;
  const lead = data.settings.autoBillDays ?? 7;
  let due = nextDueFromMoveIn(unit.moveInDate, today);
  // Skip cycles that already have a bill.
  for (let i = 0; i < 3 && data.bills.some((b) => b.unitId === unit.id && localDate(new Date(b.dueDate)) === localDate(due)); i++) {
    due = nextDueFromMoveIn(unit.moveInDate, due);
  }
  const createOn = new Date(due);
  createOn.setDate(createOn.getDate() - lead);
  return { createOn, due };
}

/** Auto bills still waiting for the landlord to check the amounts. */
export const autoBillsToReview = (data: Data) => data.bills.filter((b) => b.auto && !b.reviewed && !b.updatedAt && balance(b) > 0);

/** Photos can be shared between a tenant profile and its auto bills; only delete ones nothing uses. */
export function unusedPhotoIds(ids: string[], data: Data) {
  const used = new Set([
    ...data.bills.flatMap(linePhotoIds),
    ...data.units.flatMap((u) => u.recurring.flatMap((c) => (c.photoId ? [c.photoId] : []))),
  ]);
  return ids.filter((id) => !used.has(id));
}
