// app/layout.tsx v3
// Nav bar ngang + Body [Main content | Metrics panel phải]

import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { NetworkProvider } from "@/components/network-context";
import { Nav } from "@/components/nav";
import { MetricsPanel } from "@/components/metrics-panel";

export const metadata: Metadata = {
  title: "Shelby Analytics",
  description: "Real-time network analytics for Shelby Protocol — decentralized blob storage on Aptos.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-network="shelbynet" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⬡</text></svg>" />
      </head>
      <body suppressHydrationWarning>
        <Suspense fallback={<LayoutFallback />}>
          <NetworkProvider>
            <div className="app-shell">
              {/* Nav bar — full width top */}
              <Nav />

              {/* Body = main content + metrics panel */}
              <div className="body-layout">
                <main className="main-content">
                  {children}
                </main>
                <MetricsPanel />
              </div>
            </div>
          </NetworkProvider>
        </Suspense>
      </body>
    </html>
  );
}

function LayoutFallback() {
  return (
    <div className="app-shell">
      <div style={{ height: 60, background: "#fff", borderBottom: "1px solid #e5e7eb" }} />
      <div className="body-layout">
        <main className="main-content">
          <div className="skeleton" style={{ height: 32, width: 200, marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 80 }} />
        </main>
      </div>
    </div>
  );
}