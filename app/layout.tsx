// app/layout.tsx — v5.0
// + ThemeProvider wrap để global dark/light toggle hoạt động
import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/footer";
import { NetworkProvider } from "@/components/network-context";
import { ThemeProvider } from "@/components/theme-context";
import { Suspense } from "react";

export const metadata: Metadata = {
  title:       "Shelby Analytics",
  description: "Real-time analytics dashboard for the Shelby decentralized storage network",
  icons:       { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <NetworkProvider>
            <div className="app-shell">
              <Suspense fallback={null}>
                <Nav />
              </Suspense>
              <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
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