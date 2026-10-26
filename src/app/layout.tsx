import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Singil — Paupahan Billing",
  description: "Singil ng upa at bills para sa paupahan — awtomatiko buwan-buwan, i-send sa tenant.",
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/manifest.webmanifest`,
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon-192.png`, apple: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/apple-touch-icon.png` },
  appleWebApp: { capable: true, title: "Singil", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
  viewportFit: "cover", // lets the header/nav pad around iPhone notches and home bars
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
