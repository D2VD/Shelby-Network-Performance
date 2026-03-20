// app/layout.tsx
// FIX: MetricsPanel sticky + wider (220px → 260px)

import type { Metadata, Viewport } from "next";
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
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⬡</text></svg>"
        />
      </head>
      <body suppressHydrationWarning>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />

            {/* Body row: main + sticky right panel */}
            <div style={{ display: "flex", flex: 1, minHeight: "calc(100vh - 60px)", alignItems: "flex-start" }}>

              {/* Scrollable main content */}
              <main style={{
                flex: 1,
                minWidth: 0,
                padding: "32px 36px 60px",
              }}>
                {children}
              </main>

              {/* ✅ Sticky right panel — rộng 260px, không cuộn cùng page */}
              <div style={{
                width: 260,
                flexShrink: 0,
                position: "sticky",
                top: 60,                          // dính dưới nav 60px
                height: "calc(100vh - 60px)",
                overflowY: "auto",
                borderLeft: "1px solid #EBEBEB",
                background: "#fff",
              }}>
                <MetricsPanel />
              </div>

            </div>
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}