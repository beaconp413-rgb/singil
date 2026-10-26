// Renders a bill as one shareable JPEG laid out like a receipt: header, itemised
// charges, a big "AMOUNT TO PAY" box, GCash details, then meter/receipt photos.

import { t } from "./i18n";
import { BillSummary, peso } from "./store";

const W = 1080;
const PAD = 60;
const GREEN = "#047857";
const DARK = "#0f172a";
const MUTED = "#64748b";
const FONT_FAMILY = "system-ui, -apple-system, Roboto, sans-serif";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderBillImage(b: BillSummary, photos: { caption: string; src: string }[]): Promise<Blob> {
  const T = t().bill;
  const imgs = await Promise.all(photos.map(async (p) => ({ ...p, img: await loadImage(p.src) })));
  const photoW = W - PAD * 2;
  const photoHeights = imgs.map(({ img }) => Math.min(1000, Math.round((img.height / img.width) * photoW)));

  // Height is computed by running the same layout twice: once to measure, once to draw.
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 10;
  const draw = (ctx: CanvasRenderingContext2D, paint: boolean) => {
    let y = 0;
    const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT_FAMILY}`);
    const text = (t: string, x: number, size: number, color: string, weight = 400, align: CanvasTextAlign = "left") => {
      font(size, weight);
      ctx.textAlign = align;
      ctx.fillStyle = color;
      if (paint) ctx.fillText(t, x, y);
    };
    const rect = (x: number, yy: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      if (paint) ctx.fillRect(x, yy, w, h);
    };
    ctx.textBaseline = "top";

    // Header band
    rect(0, 0, W, 210, GREEN);
    y = 44;
    text(b.title, PAD, 50, "#ffffff", 700);
    text(b.billNo, W - PAD, 50, "#d1fae5", 700, "right");
    y += 74;
    text(b.unitLine, PAD, 34, "#ecfdf5");
    y += 46;
    text(`${T.billingMonth}: ${b.month}`, PAD, 30, "#d1fae5");
    if (b.updated) text(T.updated(b.updated), W - PAD, 26, "#fde68a", 600, "right");
    y = 260;

    // Items
    for (const it of b.items) {
      text(it.label, PAD, 38, DARK, 600);
      text(peso(it.amount), W - PAD, 38, DARK, 600, "right");
      y += 50;
      if (it.detail) {
        text(it.detail, PAD, 28, MUTED);
        y += 40;
      }
      y += 16;
    }
    rect(PAD, y, W - PAD * 2, 3, "#e2e8f0");
    y += 24;
    text(T.thisMonth, PAD, 34, DARK, 700);
    text(peso(b.monthTotal), W - PAD, 34, DARK, 700, "right");
    y += 52;
    if (b.paid > 0) {
      text(T.paid, PAD, 32, GREEN);
      text(`−${peso(b.paid)}`, W - PAD, 32, GREEN, 400, "right");
      y += 48;
    }
    if (b.prevBalance > 0) {
      text(T.prevBalance, PAD, 32, "#b91c1c");
      text(`+${peso(b.prevBalance)}`, W - PAD, 32, "#b91c1c", 400, "right");
      y += 48;
    }

    // Amount to pay — the one number the tenant must see
    y += 20;
    const boxTop = y;
    rect(PAD, boxTop, W - PAD * 2, 300, "#fef3c7");
    rect(PAD, boxTop, 14, 300, "#f59e0b");
    y = boxTop + 34;
    text(T.amountToPay, W / 2, 34, "#92400e", 700, "center");
    y += 58;
    text(peso(b.amountDue), W / 2, 116, DARK, 800, "center");
    y += 140;
    text(`${T.due}: ${b.dueDate}`, W / 2, 34, "#92400e", 600, "center");
    y = boxTop + 300 + 24;
    if (b.deposit > 0) {
      text(T.deposit(peso(b.deposit)), W / 2, 26, MUTED, 400, "center");
      y += 44;
    }
    y += 16;

    if (b.payAccount) {
      text(T.sendVia(b.payMethod), PAD, 32, MUTED);
      y += 44;
      text(b.payAccount, PAD, 42, DARK, 700);
      y += 64;
    }
    text(T.thanks, PAD, 30, MUTED);
    y += 70;

    // Photos (proof)
    imgs.forEach(({ caption, img }, i) => {
      rect(0, y, W, 2, "#e2e8f0");
      y += 30;
      text(`📷 ${caption}`, PAD, 32, "#334155", 600);
      y += 50;
      const h = photoHeights[i];
      const w = Math.round((img.width / img.height) * h);
      if (paint) ctx.drawImage(img, PAD + (photoW - w) / 2, y, w, h);
      y += h + 40;
    });
    return y + 20;
  };

  canvas.height = draw(canvas.getContext("2d")!, false);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, canvas.height);
  draw(ctx, true);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create image"))), "image/jpeg", 0.88),
  );
}
