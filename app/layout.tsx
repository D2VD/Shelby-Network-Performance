// app/layout.tsx — v6.0
// + viewport meta (bắt buộc cho mobile responsive)
// + ThemeProvider
// + page-main class responsive

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/footer";
import { NetworkProvider } from "@/components/network-context";
import { ThemeProvider } from "@/components/theme-context";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Shelby Analytics",
  description: "Real-time analytics dashboard for the Shelby decentralized storage network",
  icons: { icon: "/favicon.ico" },
};

// viewport phải là named export riêng trong Next.js 14+
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // cho phép zoom tay trên mobile
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <NetworkProvider>
            <div className="app-shell">
              <Suspense fallback={null}>
                <Nav />
              </Suspense>
              <main className="page-main">
                {children}
              </main>
              <SiteFooter />
            </div>
          </NetworkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}