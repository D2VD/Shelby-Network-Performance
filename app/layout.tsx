// app/layout.tsx — Server Component
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NetworkProvider } from "@/components/network-context";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/footer";

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
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <style>{`
          .page-main {
            flex: 1; min-width: 0;
            padding: 32px 40px 60px;
          }
          @media (max-width: 900px) { .page-main { padding: 20px 18px 48px; } }
          @media (max-width: 480px) { .page-main { padding: 16px 12px 40px; } }
        `}</style>
      </head>
      <body suppressHydrationWarning>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />
            <main className="page-main">
              {children}
            </main>
            <SiteFooter />
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}