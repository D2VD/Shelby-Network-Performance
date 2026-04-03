"use client";
// components/nav.tsx — v5.0
// Changes: "Globe" → "Map", add Monitoring link to Grafana

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_LINKS = [
  { href: "/dashboard/providers", label: "Map"       },
  { href: "/dashboard",           label: "Dashboard" },
  { href: "/dashboard/charts",    label: "Charts"    },
  { href: "/",                    label: "Benchmark" },
];

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname?.startsWith(href) ?? false;
  };

  return (
    <nav style={{
      position:       "sticky",
      top:            0,
      zIndex:         200,
      height:         60,
      background:     "rgba(255,255,255,0.97)",
      backdropFilter: "blur(20px)",
      borderBottom:   "1px solid #EBEBEB",
      boxShadow:      "0 1px 3px rgba(0,0,0,0.05)",
      display:               "grid",
      gridTemplateColumns:   "auto 1fr auto",
      alignItems:            "center",
      gap:                   12,
      padding:               "0 28px",
      boxSizing:             "border-box",
      width:                 "100%",
    }}>

      {/* ── Logo ── */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flexShrink: 0 }}>
        <img src="/logo.png" alt="Shelby" width={28} height={28}
          style={{ borderRadius: 7, objectFit: "contain" }} />
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0A0A0A", letterSpacing: -0.3, whiteSpace: "nowrap" }}>
          Shelby{" "}<span style={{ color: "#059669", fontWeight: 500 }}>Analytics</span>
        </span>
      </Link>

      {/* ── Tabs ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: 1, background: "#F4F4F4", borderRadius: 12, padding: 3,
        width: "fit-content", margin: "0 auto",
      }}>
        {NAV_LINKS.map(link => {
          const active = isActive(link.href);
          return (
            <Link key={link.href} href={link.href} style={{
              padding:        "6px 16px",
              borderRadius:   9,
              fontSize:       13.5,
              fontWeight:     active ? 600 : 400,
              color:          active ? "#0A0A0A" : "#999",
              background:     active ? "#fff" : "transparent",
              boxShadow:      active ? "0 1px 4px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.04)" : "none",
              textDecoration: "none",
              transition:     "all 0.15s",
              whiteSpace:     "nowrap",
              flexShrink:     0,
            }}>
              {link.label}
            </Link>
          );
        })}
      </div>

      {/* ── Right controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

        {/* Network switcher */}
        <div style={{ display: "flex", gap: 2, background: "#F4F4F4", borderRadius: 10, padding: 3 }}>
          {(["shelbynet", "testnet"] as NetworkId[]).map(id => {
            const active    = network === id;
            const isShelby  = id === "shelbynet";
            const dotColor  = isShelby ? "#2563eb" : "#9333ea";
            const textColor = active ? (isShelby ? "#1d4ed8" : "#7c3aed") : "#999";
            return (
              <button
                key={id}
                onClick={() => setNetwork(id)}
                title={isShelby ? "Shelbynet (devnet)" : "Testnet (coming soon)"}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 11px", borderRadius: 8,
                  fontSize: 12.5, fontWeight: active ? 600 : 400,
                  color: textColor,
                  background: active ? "#fff" : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  border: "none", cursor: "pointer",
                  transition: "all 0.15s", whiteSpace: "nowrap",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: active ? dotColor : "#CCC",
                  boxShadow: active ? `0 0 5px ${dotColor}` : "none",
                }} />
                {isShelby ? "Shelbynet" : "Testnet"}
              </button>
            );
          })}
        </div>

        {/* Monitoring link */}
        <a
          href="/grafana/"
          target="_blank"
          rel="noreferrer"
          title="Grafana monitoring dashboard"
          style={{
            display: "flex", alignItems: "center", gap: 5,
            color: "#9ca3af", textDecoration: "none", fontSize: 12,
            padding: "5px 10px", borderRadius: 8,
            border: "1px solid #E8E8E8", whiteSpace: "nowrap",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#e97316"; e.currentTarget.style.color = "#e97316"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#E8E8E8"; e.currentTarget.style.color = "#9ca3af"; }}
        >
          <span style={{ fontSize: 10 }}>◉</span> Monitor
        </a>

        {/* Docs */}
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" style={{
          color: "#999", textDecoration: "none", fontSize: 13,
          padding: "6px 12px", borderRadius: 9,
          border: "1px solid #E8E8E8", whiteSpace: "nowrap",
          transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#2563eb"; e.currentTarget.style.color = "#2563eb"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#E8E8E8"; e.currentTarget.style.color = "#999"; }}
        >
          Docs ↗
        </a>
      </div>
    </nav>
  );
}