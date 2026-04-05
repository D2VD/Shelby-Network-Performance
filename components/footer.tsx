"use client";
// components/footer.tsx

const LINKS = [
  { label: "Shelby Protocol", href: "https://shelby.xyz" },
  { label: "Docs",            href: "https://docs.shelby.xyz" },
  { label: "Explorer",        href: "https://explorer.shelby.xyz" },
  { label: "Discord",         href: "https://discord.com/invite/shelbyserves" },
  { label: "GitHub",          href: "https://github.com/D2VD/Shelby-Network-Performance" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer style={{
      borderTop: "1px solid var(--gray-200)",
      background: "var(--white, #fff)",
      padding: "18px 40px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 14, maxWidth: 1280, margin: "0 auto",
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt=""
            width={22} height={22}
            style={{ borderRadius: 5 }}
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-700, #374151)" }}>Shelby Analytics</span>
          <span style={{ fontSize: 11, color: "var(--gray-400, #9ca3af)" }}>Community Dashboard</span>
        </div>

        {/* Links */}
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {LINKS.map(({ label, href }) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" style={{
              fontSize: 12, color: "var(--gray-500, #6b7280)", textDecoration: "none",
            }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--gray-900, #111827)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--gray-500, #6b7280)")}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Copyright */}
        <span style={{ fontSize: 11, color: "var(--gray-400, #9ca3af)", fontFamily: "monospace" }}>
          © {year} · Shelby Protocol
        </span>
      </div>
    </footer>
  );
}