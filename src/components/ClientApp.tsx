"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

// Singil keeps the landlord's data on the device (plus optional cloud sync), so there is
// nothing to render on the server — load it in the browser only.
const SingilApp = dynamic(() => import("./SingilApp"), { ssr: false });
const TenantView = dynamic(() => import("./TenantView"), { ssr: false });

const readToken = () => new URLSearchParams(window.location.search).get("t");

export default function ClientApp() {
  // Tenants arrive with ?t=INVITE_TOKEN; everyone else gets the landlord app.
  // undefined during server render/hydration, then the real value in the browser.
  const token = useSyncExternalStore(
    () => () => {},
    readToken,
    () => undefined,
  );
  if (token === undefined) return null;
  return token ? <TenantView token={token} /> : <SingilApp />;
}
