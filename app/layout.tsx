// app/layout.tsx — v5.2 — Mobile responsive fix

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
  width:        "device-width",
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
        <style>{`
          /* ── Layout responsive ── */
          .body-row {
            display: flex;
            flex: 1;
            min-height: calc(100vh - 60px);
            align-items: flex-start;
          }
          .main-area {
            flex: 1;
            min-width: 0;
            padding: 32px 36px 60px;
          }
          .right-panel {
            width: 260px;
            flex-shrink: 0;
            position: sticky;
            top: 60px;
            height: calc(100vh - 60px);
            overflow-y: auto;
            border-left: 1px solid #EBEBEB;
            background: #fff;
          }
          /* Mobile: ẩn panel phải, thu padding */
          @media (max-width: 900px) {
            .right-panel { display: none; }
            .main-area   { padding: 20px 16px 48px; }
          }
          @media (max-width: 480px) {
            .main-area   { padding: 16px 12px 40px; }
          }
        `}</style>
      </head>
      <body suppressHydrationWarning>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />

            <div className="body-row">
              <main className="main-area">
                {children}
              </main>

              {/* Sticky metrics panel — ẩn trên mobile qua CSS */}
              <div className="right-panel">
                <MetricsPanel />
              </div>
            </div>
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}