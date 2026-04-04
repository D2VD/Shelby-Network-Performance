// app/layout.tsx — v7.1
// Footer + logo từ /public (admin có thể thay không cần code)

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
        {/* Favicon từ /public/favicon.ico — admin thay bằng cách đặt file vào /public */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <style>{`
          .page-main {
            flex: 1;
            min-width: 0;
            padding: 32px 40px 60px;
          }
          @media (max-width: 900px)  { .page-main { padding: 20px 18px 48px; } }
          @media (max-width: 480px)  { .page-main { padding: 16px 12px 40px; } }

          .site-footer {
            border-top: 1px solid var(--gray-200);
            background: var(--white);
            padding: 20px 40px;
          }
          @media (max-width: 768px) {
            .site-footer { padding: 16px 18px; }
            .footer-inner { flex-direction: column !important; gap: 12px !important; }
          }
        `}</style>
      </head>
      <body suppressHydrationWarning>
        <NetworkProvider>
          <div className="app-shell">
            <Nav />
            <main className="page-main">
              {children}
            </main>
            <Footer />
          </div>
        </NetworkProvider>
      </body>
    </html>
  );
}

// Footer component — logo + links
// Admin thay logo: đặt /public/logo.svg hoặc /public/logo.png
// Admin thay footer text: sửa file này (hoặc dùng env var nếu muốn)
function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="footer-inner" style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 16,
        maxWidth: 1280,
        margin: "0 auto",
      }}>
        {/* Left: logo + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Logo từ /public — thay file để đổi logo */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="Shelby Analytics"
            width={24}
            height={24}
            style={{ borderRadius: 6 }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-700)" }}>
            Shelby Analytics
          </span>
          <span style={{ fontSize: 12, color: "var(--gray-400)" }}>
            Community Dashboard
          </span>
        </div>

        {/* Center: links */}
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {[
            { label: "Shelby Protocol", href: "https://shelby.xyz" },
            { label: "Docs",            href: "https://docs.shelby.xyz" },
            { label: "Explorer",        href: "https://explorer.shelby.xyz" },
            { label: "Discord",         href: "https://discord.com/invite/shelbyserves" },
            { label: "GitHub",          href: "https://github.com/D2VD/Shelby-Network-Performance" },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: 12, color: "var(--gray-500)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--gray-800)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--gray-500)")}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Right: copyright */}
        <div style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
          © {year} · Shelby Protocol · Powered by Aptos
        </div>
      </div>
    </footer>
  );
}