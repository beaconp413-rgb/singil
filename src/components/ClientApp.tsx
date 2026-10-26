"use client";

import dynamic from "next/dynamic";

// Singil keeps all data on the phone (localStorage + IndexedDB), so there is nothing
// to render on the server — load it in the browser only.
const SingilApp = dynamic(() => import("./SingilApp"), { ssr: false });

export default function ClientApp() {
  return <SingilApp />;
}
