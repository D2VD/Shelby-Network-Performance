// app/layout.tsx
// FIX: Xóa Suspense bọc NetworkProvider — useSearchParams đã được wrap bên trong
// network-context.tsx rồi. Để Suspense ở đây gây lỗi với Next.js 15 strict mode.

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
        {/* NetworkProvider tự wrap Suspense bên trong cho useSearchParams */}
        <NetworkProvider>
          <div className="app-shell">
            <Nav />
            <div className="body-layout">
              <main className="main-content">
                {children}
              </main>
              <MetricsPanel />
            </div>
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}