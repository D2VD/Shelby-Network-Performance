// app/layout.tsx — v6.0
// MetricsPanel chỉ còn trong Globe page (tự quản lý layout riêng).
// Tất cả trang khác: full-width content, không có panel phải.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NetworkProvider } from "@/components/network-context";
import { Nav } from "@/components/nav";

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
        <style>{`
          .page-main {
            flex: 1;
            min-width: 0;
            padding: 32px 40px 60px;
          }
          @media (max-width: 900px)  { .page-main { padding: 20px 18px 48px; } }
          @media (max-width: 480px)  { .page-main { padding: 16px 12px 40px; } }
        `}</style>
      </head>
      <body suppressHydrationWarning>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />
            {/* Globe page manages its own 2-col layout internally */}
            <main className="page-main">
              {children}
            </main>
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}