"use client";

// components/footer.tsx — Shelby Analytics v2.0
// Design: refined dark-band footer với geometric accent đối xứng
// Tích hợp hiệu ứng Grid & Glow cả 2 phía và Avatar X

import { useEffect, useState } from "react";

// ── Static data ────────────────────────────────────────────────────────────────
const PROTOCOL_LINKS = [
  { label: "Overview",       href: "https://shelby.xyz" },
  { label: "Documentation",  href: "https://docs.shelby.xyz" },
  { label: "Explorer",       href: "https://explorer.shelby.xyz" },
  { label: "Developer Portal",href: "https://developers.shelby.xyz" },
] as const;

const DASHBOARD_LINKS = [
  { label: "Analytics",  href: "/analytics" },
  { label: "Map",        href: "/map" },
  { label: "Charts",     href: "/charts" },
  { label: "Benchmark",  href: "/" },
] as const;

const COMMUNITY_LINKS = [
  { label: "Discord",  href: "https://discord.com/invite/shelbyserves", external: true },
  { label: "Twitter",  href: "https://x.com/shelbyserves",                external: true },
  { label: "GitHub",   href: "https://github.com/shelby",                 external: true },
] as const;

// ── Sub-components ─────────────────────────────────────────────────────────────

function NetworkPulse() {
  const [dots, setDots] = useState([0, 0, 0]);

  useEffect(() => {
    const timers = [0, 280, 560].map((delay, i) =>
      setInterval(() => {
        setDots(prev => {
          const next = [...prev];
          next[i] = next[i] === 1 ? 0 : 1;
          return next;
        });
      }, 1400)
    );
    const starts = [0, 280, 560].map((delay, i) =>
      setTimeout(() => {
        setDots(prev => {
          const next = [...prev];
          next[i] = 1;
          return next;
        });
      }, delay)
    );
    return () => {
      timers.forEach(clearInterval);
      starts.forEach(clearTimeout);
    };
  }, []);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      {dots.map((active, i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: active ? "#22c55e" : "rgba(34,197,94,0.25)",
            transition: "background 0.4s ease",
            boxShadow: active ? "0 0 6px rgba(34,197,94,0.6)" : "none",
          }}
        />
      ))}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5, flexShrink: 0 }}>
      <path d="M2 1h7m0 0v7m0-7L2 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FooterLink({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean; }) {
  const linkStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 13,
    color: "rgba(156,163,175,1)",
    textDecoration: "none",
    transition: "color 0.15s ease",
    lineHeight: 1,
  };

  const props = external ? { target: "_blank", rel: "noreferrer" } : {};

  return (
    <a
      href={href}
      style={linkStyle}
      {...props}
      onMouseEnter={e => (e.currentTarget.style.color = "#f9fafb")}
      onMouseLeave={e => (e.currentTarget.style.color = "rgba(156,163,175,1)")}
    >
      {children}
      {external && <ExternalIcon />}
    </a>
  );
}

// ── Main Footer ───────────────────────────────────────────────────────────────
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        position: "relative",
        background: "#080f1a",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      {/* ── Geometric background accent ── */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {/* Top gradient shimmer */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent 0%, #2563eb 30%, #06b6d4 60%, transparent 100%)", opacity: 0.6 }} />

        {/* Radial glows */}
        <div style={{ position: "absolute", bottom: -80, right: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.07) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: -80, left: -80, width: 360, height: 360, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.07) 0%, transparent 70%)" }} />

        {/* Left Grid with Mask Effect */}
        <svg
          style={{
            position: "absolute", top: 0, left: 0, width: 320, height: "100%", opacity: 0.035,
            WebkitMaskImage: "linear-gradient(to right, black 20%, transparent 100%)",
            maskImage: "linear-gradient(to right, black 20%, transparent 100%)",
          }}
          viewBox="0 0 320 200"
          preserveAspectRatio="xMinYMin slice"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`vl-${i}`} x1={i * 40} y1={0} x2={i * 40} y2={200} stroke="white" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`hl-${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke="white" strokeWidth={0.5} />
          ))}
        </svg>

        {/* Right Grid with Mask Effect */}
        <svg
          style={{
            position: "absolute", top: 0, right: 0, width: 320, height: "100%", opacity: 0.035,
            WebkitMaskImage: "linear-gradient(to left, black 20%, transparent 100%)",
            maskImage: "linear-gradient(to left, black 20%, transparent 100%)",
          }}
          viewBox="0 0 320 200"
          preserveAspectRatio="xMaxYMin slice"
        >
          {Array.from({ length: 9 }, (_, i) => (
            <line key={`vr-${i}`} x1={i * 40} y1={0} x2={i * 40} y2={200} stroke="white" strokeWidth={0.5} />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <line key={`hr-${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke="white" strokeWidth={0.5} />
          ))}
        </svg>
      </div>

      {/* ── Content ── */}
      <div style={{ position: "relative", maxWidth: 1280, margin: "0 auto", padding: "52px 28px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1fr 1fr 1fr", gap: 40, marginBottom: 48 }}>
          
          {/* ── Brand column ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f9fafb", letterSpacing: "-0.2px", lineHeight: 1.2 }}>
                Shelby Analytics
              </div>
              <div style={{ fontSize: 11, color: "rgba(107,114,128,1)", fontWeight: 500, letterSpacing: "0.04em", marginTop: 1 }}>
                Community Dashboard
              </div>
            </div>

            <p style={{ fontSize: 13, color: "rgba(107,114,128,1)", lineHeight: 1.7, maxWidth: 280, margin: 0 }}>
              Real-time analytics for Shelby Protocol — a decentralized storage network built on Aptos. Track blobs, providers, and network health as it happens.
            </p>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 8, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)", width: "fit-content" }}>
              <NetworkPulse />
              <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(74,222,128,0.9)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Network Live
              </span>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              {[
                { href: "https://x.com/0xPenguinsMon", icon: "M18.244 2H21l-6.56 7.5L22 22h-6.828l-5.35-6.99L3.5 22H1l7.03-8.04L2 2h6.828l4.87 6.36L18.244 2Zm-2.4 18h1.89L8.29 4H6.27l9.574 16Z" },
                { href: "https://github.com/D2VD", icon: "M12 0C5.37 0 0 5.37 0 12a12 12 0 008.2 11.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 .1.8 1.8 2.7 2.2.7.1 1.4.3 2.1.1.1-.7.3-1.4.6-1.7-2.7-.3-5.6-1.4-5.6-6a4.7 4.7 0 011.2-3.3c-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.4 1.3a11.5 11.5 0 016.2 0c2.4-1.6 3.4-1.3 3.4-1.3.6 1.6.2 2.8.1 3.1a4.7 4.7 0 011.2 3.3c0 4.6-2.9 5.6-5.6 6 .3.3.6 1 .6 2v3c0 .3.2.7.8.6A12 12 0 0024 12c0-6.63-5.37-12-12-12z" },
              ].map((social, idx) => (
                <a key={idx} href={social.href} target="_blank" rel="noreferrer" style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", color: "rgba(156,163,175,1)" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#f9fafb"; }} onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(156,163,175,1)"; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d={social.icon} /></svg>
                </a>
              ))}
            </div>
          </div>

          {/* ── Protocol links ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(75,85,99,1)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Protocol</div>
            {PROTOCOL_LINKS.map(link => ( <FooterLink key={link.label} href={link.href} external>{link.label}</FooterLink> ))}
          </div>

          {/* ── Dashboard links ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(75,85,99,1)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Dashboard</div>
            {DASHBOARD_LINKS.map(link => ( <FooterLink key={link.label} href={link.href}>{link.label}</FooterLink> ))}
          </div>

          {/* ── Community + Built by ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(75,85,99,1)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Community</div>
            {COMMUNITY_LINKS.map(link => ( <FooterLink key={link.label} href={link.href} external>{link.label}</FooterLink> ))}

            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(75,85,99,1)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Built by</div>
              <a href="https://x.com/0xPenguinsMon" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textDecoration: "none", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }} onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}>
                <img src="https://unavatar.io/x/0xPenguinsMon" style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.2)", objectFit: "cover" }} alt="Avatar" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#f9fafb", lineHeight: 1.2 }}>Poly Orion</div>
                  <div style={{ fontSize: 10, color: "rgba(107,114,128,1)", lineHeight: 1.2 }}>@0xPenguinsMon</div>
                </div>
              </a>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.07) 20%, rgba(255,255,255,0.07) 80%, transparent)", marginBottom: 24 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "rgba(75,85,99,1)" }}>© {year} Shelby Protocol. All rights reserved.</span>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: "rgba(75,85,99,1)" }} />
            <span style={{ fontSize: 12, color: "rgba(75,85,99,1)" }}>Community — not official</span>
          </div>

          {/* <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[ { label: "Aptos", color: "#2563eb" }, { label: "Next.js", color: "rgba(156,163,175,0.7)" }, { label: "Open Source", color: "#22c55e" } ].map(({ label, color }) => (
              <span key={label} style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 5, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", color, letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
            ))}
          </div> */}
        </div>
      </div>
    </footer>
  );
}