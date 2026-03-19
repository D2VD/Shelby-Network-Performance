// app/layout.tsx — Updated với MetricsBar thay vì MetricsPanel
import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { NetworkProvider } from "@/components/network-context";

export const metadata: Metadata = {
  title: "Shelby Analytics | Network Performance Dashboard",
  description: "Real-time analytics and benchmarks for Shelby Protocol decentralized storage network",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />
            <div className="body-layout">
              <main className="main-content">
                {children}
              </main>
            </div>
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}