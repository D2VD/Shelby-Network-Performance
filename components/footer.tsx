"use client";
// components/footer.tsx — Client Component
// Logo từ /public/logo.svg — admin thay file là xong, không cần đụng code

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div
        className="footer-inner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        {/* Left: logo + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="Shelby Analytics"
            width={24}
            height={24}
            style={{ borderRadius: 6 }}
            onError={e => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--gray-700)" }}>
            Shelby Analytics
          </span>
          <span style={{ fontSize: 12, color: "var(--gray-400)" }}>
            Community Dashboard
          </span>
        </div>

        {/* Center: links */}
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
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
              style={{ fontSize: 12, color: "var(--gray-500)", textDecoration: "none", transition: "color 0.15s" }}
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