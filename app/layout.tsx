// app/layout.tsx
// FIX: MetricsPanel sticky khi scroll (position: sticky, top: 60px, height: calc)

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
            {/* Nav sticky ở top */}
            <Nav />

            {/* Body: main content + sticky right panel */}
            <div style={{ display: "flex", flex: 1, minHeight: "calc(100vh - 60px)" }}>

              {/* Main scrollable content */}
              <main style={{
                flex: 1,
                minWidth: 0,
                padding: "32px 36px 60px",
                maxWidth: 1200,
                width: "100%",
                margin: "0 auto",
              }}>
                {children}
              </main>

              {/* ✅ MetricsPanel — sticky, không cuộn cùng page */}
              <div style={{
                position: "sticky",
                top: 60,           /* chiều cao nav */
                height: "calc(100vh - 60px)",
                overflowY: "auto",
                flexShrink: 0,
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