"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

// Singil keeps the landlord's data on the device (plus optional cloud sync), so there is
// nothing to render on the server — load it in the browser only.
const SingilApp = dynamic(() => import("./SingilApp"), { ssr: false });

// Old tenant invite links (?t=…) are no longer used; bills are sent by message instead.
const readOldInvite = () => new URLSearchParams(window.location.search).has("t");

export default function ClientApp() {
  // undefined during server render/hydration, then the real value in the browser.
  const oldInvite = useSyncExternalStore(
    () => () => {},
    readOldInvite,
    () => undefined,
  );
  if (oldInvite === undefined) return null;
  if (oldInvite) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <div className="max-w-sm space-y-2 rounded-xl bg-white p-6 shadow-sm">
          <p className="text-3xl">📩</p>
          <p className="font-semibold">Hindi na ginagamit ang link na ito.</p>
          <p className="text-sm text-slate-600">Ipapadala ng landlord ang singil mo sa Messenger, Viber, WhatsApp, SMS o email.</p>
          <p className="pt-2 text-xs text-slate-500">This link is no longer used. Your landlord will send your bill by message or email.</p>
        </div>
      </main>
    );
  }
  return <SingilApp />;
}
