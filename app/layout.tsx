// app/layout.tsx — v7.0
// CHANGES:
// 1. Added favicon.ico + apple-touch-icon to metadata.icons
// 2. Added og:image metadata
// 3. ThemeProvider + NetworkProvider chain unchanged

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/footer";
import { NetworkProvider } from "@/components/network-context";
import { ThemeProvider } from "@/components/theme-context";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Shelby Analytics — Community Dashboard",
  description: "Real-time analytics dashboard for the Shelby decentralized storage network",
  icons: {
    // Browser tab favicon
    icon: [
      { url: "/favicon.ico",    sizes: "any"   },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    // iOS home screen
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
    // PWA shortcut icon
    shortcut: "/favicon.ico",
  },
  // Open Graph for social sharing
  openGraph: {
    title: "Shelby Analytics",
    description: "Real-time analytics for Shelby decentralized storage",
    siteName: "Shelby Analytics",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Explicit favicon link for maximum browser compatibility */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
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