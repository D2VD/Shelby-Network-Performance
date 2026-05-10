// app/layout.tsx — v8.0
// Font: Britti Sans (display) · Inter (body) · Roboto Mono (labels)
// Brand: #ff77c9 pink · #322313 brown

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav }            from "@/components/nav";
import { SiteFooter }     from "@/components/footer";
import { NetworkProvider } from "@/components/network-context";
import { ThemeProvider }   from "@/components/theme-context";
import { Suspense }        from "react";

export const metadata: Metadata = {
  title: "Shelby Analytics — Community Dashboard",
  description:
    "Real-time analytics for Shelby Protocol decentralized storage. " +
    "Monitor storage providers, track blobs, and benchmark performance live from the chain.",
  icons: {
    icon:    [
      { url: "/favicon.ico",    sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple:   [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title:       "Shelby Analytics",
    description: "Real-time analytics for Shelby decentralized storage",
    siteName:    "Shelby Analytics",
    type:        "website",
    images:      [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card:  "summary_large_image",
    title: "Shelby Analytics — Community Dashboard",
  },
};

export const viewport: Viewport = {
  width:        "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor:   [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)",  color: "#0d0a08" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Explicit favicon links */}
        <link rel="icon"             href="/favicon.ico" sizes="any" />
        <link rel="icon"             href="/logo.svg"    type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Google Fonts preconnect */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* Font stacks */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500&display=swap"
        />
        {/* Britti Sans — self-host or use a CDN if available
            Fallback: Georgia is used if Britti Sans is not installed.
            To add Britti Sans: download from its foundry and place in /public/fonts/,
            then add @font-face declarations to globals.css. */}
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <NetworkProvider>
            <div className="app-shell">
              <Suspense fallback={null}>
                <Nav />
              </Suspense>
              <main className="page-main" style={{ padding: 0 }}>
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