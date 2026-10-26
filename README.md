# Singil — rent & bills for small landlords

Singil helps landlords with a few units (paupahan, boarding houses, apartments) bill tenants every month.
The landlord sets up each tenant profile once; the app creates the monthly bill, reminds before the due date,
and produces a bill image to send by SMS or Messenger.

**Live app:** https://beaconp413-rgb.github.io/singil/ · **Android app (APK):** https://beaconp413-rgb.github.io/Singil.apk

## Features

- **Tenant profile:** rent, monthly bills (label + cost + photo of the bill, e.g. Kuryente ₱1,000), deposit, move-in date.
- **Automatic monthly bills:** due on the move-in day of each month (moved in Oct 27 → due Nov 27); each bill is created
  7 days before its due date (configurable). Never bills before the move-in date. Missed days catch up when the app opens.
- **Edit any bill** after it was created (amounts, photos, due date); payments already recorded are kept.
- **Payments:** partial payments, balances carried to the next month, statuses (paid / partial / unpaid / overdue).
- **Reminders:** unpaid bills due within 5 days or overdue, with a one-tap prefilled SMS.
- **Send the bill** as an image (with the bill photos) or as text: copy for Messenger, or open WhatsApp, Viber,
  email or SMS with the bill already typed.
- **English / Filipino**, **₱ / $**, any payment method (GCash, Maya, Venmo, Zelle…).
- Works on phones and tablets; can be added to the home screen.
- **Landlord account & sync** (optional): sign in by email link to back up online and use several devices.
  Tenants never use the app; they get the bill by message.

## How data is stored

Local-first: the app works offline with data in `localStorage` and photos in IndexedDB.
When the landlord signs in, data and photos sync to Supabase (project `singil`, Singapore), in the
`landlord_data` and `photos` tables. Row-level security lets only the signed-in landlord who owns a row read or
write it. Schema: `supabase/migrations/`. The publishable key in `src/lib/supabaseConfig.ts` is public by design.

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
| `src/lib/cloud.ts`, `src/components/useCloud.ts` | Optional sign-in and sync (Supabase) |

## Deploy

Every push to `main` builds the static site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). The workflow sets `PAGES_BASE_PATH=/<repo-name>`.

## Android app

`../singil-android` is a Trusted Web Activity (Bubblewrap), package `ph.singil.app`. It opens the live site full
screen in Chrome, so website updates reach the app without a reinstall. The repo `beaconp413-rgb.github.io` serves
`/.well-known/assetlinks.json` (needed for full screen) and the APK download. Rebuild steps are in that folder's README.
The site works offline through `public/sw.js`.

## Roadmap

- Google Play: $25 account, closed test with 12 testers for 14 days, then upload `app-release-bundle.aab`
- Custom email sender (e.g. Resend) so any landlord can receive login emails (Supabase's built-in sender only
  reaches the project's own team, ~2 emails/hour)
- Server-side monthly bill creation + automatic email reminders to tenants
- Payment receipts, move-out & deposit settlement, rent-increase checker (RA 9653), late fees, demand letter,
  expenses & profit report, repair log, multiple properties
