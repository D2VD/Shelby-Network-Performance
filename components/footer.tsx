"use client";

import { useEffect, useState } from "react";

const NAV_LINKS = [
  { label: "Overview", href: "https://shelby.xyz" },
  { label: "Documentation", href: "https://docs.shelby.xyz" },
  { label: "Explorer", href: "https://explorer.shelby.xyz" },
  { label: "Community", href: "https://discord.com/invite/shelbyserves" },
];

export function SiteFooter() {
  const year = new Date().getFullYear();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const match = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(match.matches);
    match.addEventListener("change", (e) => setDark(e.matches));
  }, []);

  // ✅ FIX: colors nằm trong component
  const colors = {
    bg: dark ? "#0b0f19" : "#ffffff",
    text: dark ? "#e5e7eb" : "#111827",
    subText: dark ? "#9ca3af" : "#6b7280",
    border: "linear-gradient(90deg, #6366f1, #8b5cf6, #06b6d4)",
    divider: dark ? "#1f2937" : "#f3f4f6",
    pillBg: dark ? "#111827" : "#f3f4f6",
    pillBorder: dark ? "#1f2937" : "#e5e7eb",
  };

  return (
    <footer
      style={{
        background: colors.bg,
        padding: "40px 0 24px",
        position: "relative",
      }}
    >
      {/* Gradient border */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 2,
          background: colors.border,
        }}
      />

      {/* Container */}
      <div
        style={{
          width: "100%",
          padding: "0 24px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1600,
            display: "flex",
            flexDirection: "column",
            gap: 32,
          }}
        >
          {/* 3 Columns */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              gap: 40,
            }}
          >
            {/* Column 1 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/logo.svg" width={30} height={30} />
                <span style={{ fontSize: 16, fontWeight: 600, color: colors.text }}>
                  Shelby Analytics
                </span>
              </div>

              <p style={{ fontSize: 13, color: colors.subText, lineHeight: 1.6 }}>
                A community-driven analytics dashboard for Shelby Protocol,
                providing real-time insights and performance tracking.
              </p>
            </div>

            {/* Column 2 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                About Shelby
              </span>

              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    position: "relative",
                    fontSize: 13,
                    color: colors.subText,
                    textDecoration: "none",
                    width: "fit-content",
                    paddingBottom: 2,
                  }}
                >
                  {label}
                  <span className="underline" />
                </a>
              ))}
            </div>

            {/* Column 3 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                Built by
              </span>

              {/* Pill */}
              <a
                href="https://x.com/0xPenguinsMon"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: colors.pillBg,
                  border: `1px solid ${colors.pillBorder}`,
                  textDecoration: "none",
                  width: "fit-content",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.05)";
                  e.currentTarget.style.opacity = "0.9";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.opacity = "1";
                }}
              >
                <img
                  src="/avatar.jpg"
                  alt="avatar"
                  width={20}
                  height={20}
                  style={{ borderRadius: "50%", objectFit: "cover" }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />

                <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
                  Poly Orion
                </span>
              </a>

              {/* Social */}
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                {/* X */}
                <a href="https://x.com/0xPenguinsMon" target="_blank" rel="noreferrer">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={colors.subText}>
                    <path d="M18.244 2H21l-6.56 7.5L22 22h-6.828l-5.35-6.99L3.5 22H1l7.03-8.04L2 2h6.828l4.87 6.36L18.244 2Zm-2.4 18h1.89L8.29 4H6.27l9.574 16Z"/>
                  </svg>
                </a>

                {/* GitHub */}
                <a href="https://github.com/D2VD" target="_blank" rel="noreferrer">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill={colors.subText}>
                    <path d="M12 0C5.37 0 0 5.37 0 12a12 12 0 008.2 11.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.8 1.8 2.7 2.2.7.1 1.4.3 2.1.1.1-.7.3-1.4.6-1.7-2.7-.3-5.6-1.4-5.6-6a4.7 4.7 0 011.2-3.3c-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.4 1.3a11.5 11.5 0 016.2 0c2.4-1.6 3.4-1.3 3.4-1.3.6 1.6.2 2.8.1 3.1a4.7 4.7 0 011.2 3.3c0 4.6-2.9 5.6-5.6 6 .3.3.6 1 .6 2v3c0 .3.2.7.8.6A12 12 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: colors.divider }} />

          {/* Bottom */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              fontSize: 12,
              color: colors.subText,
            }}
          >
            <span>© {year} Shelby Protocol</span>
            <span>All rights reserved</span>
          </div>
        </div>
      </div>

      {/* Hover underline */}
      <style jsx>{`
        .underline {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 0%;
          height: 2px;
          background: #6366f1;
          transition: width 0.25s ease;
        }

        a:hover .underline {
          width: 100%;
        }
      `}</style>
    </footer>
  );
}