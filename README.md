# Singil — rent & bills for small landlords

Singil helps landlords with a few units (paupahan, boarding houses, apartments) bill tenants every month.
The landlord sets up each tenant profile once; the app creates the monthly bill, reminds before the due date,
and produces a bill image to send by SMS or Messenger.

**Live app:** https://beaconp413-rgb.github.io/singil/

## Features

- **Tenant profile:** rent, monthly bills (label + cost + photo of the bill, e.g. Kuryente ₱1,000), deposit, move-in date.
- **Automatic monthly bills:** due on the move-in day of each month (moved in Oct 27 → due Nov 27); each bill is created
  7 days before its due date (configurable). Never bills before the move-in date. Missed days catch up when the app opens.
- **Edit any bill** after it was created (amounts, photos, due date); payments already recorded are kept.
- **Payments:** partial payments, balances carried to the next month, statuses (paid / partial / unpaid / overdue).
- **Reminders:** unpaid bills due within 5 days or overdue, with a one-tap prefilled SMS.
- **Bill image** with the exact amount to pay, payment details, deposit (information only) and the bill photos.
- **English / Filipino**, **₱ / $**, any payment method (GCash, Maya, Venmo, Zelle…).
- Works on phones and tablets; can be added to the home screen.

## How data is stored

Everything lives in the browser on the landlord's device: bills and settings in `localStorage`, photos in IndexedDB.
Nothing is sent to a server. Settings → Backup downloads a JSON backup (photos included). Each device has its own data.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static export to ./out
```

| File | What it does |
|---|---|
| `src/components/SingilApp.tsx` | All screens (home, tenant profile, bill, payments, settings) |
| `src/lib/store.ts` | Data model, money math, due dates, automatic bills, reminders, migrations |
| `src/lib/i18n.ts` | English / Filipino text and currency formatting |
| `src/lib/billImage.ts` | Renders the shareable bill image |
| `src/lib/photos.ts` | Photo storage (IndexedDB) and resizing |

## Deploy

Every push to `main` builds the static site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). The workflow sets `PAGES_BASE_PATH=/<repo-name>`.

## Roadmap

- Online sync (Supabase) with landlord login and a private link per tenant to see their bill and upload proof of payment
- Automatic SMS/email reminders to tenants
- Payment receipts, move-out & deposit settlement, rent-increase checker (RA 9653), late fees, demand letter,
  expenses & profit report, repair log, multiple properties
