"use client";
// components/nav.tsx — v3.1: thêm Network Switcher vào right side

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_LINKS = [
  { href: "/dashboard/providers", label: "Globe"     },
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
      position: "sticky", top: 0, zIndex: 200,
      height: 60,
      background: "rgba(255,255,255,0.97)",
      backdropFilter: "blur(20px)",
      borderBottom: "1px solid #EBEBEB",
      display: "flex",
      alignItems: "center",
      padding: "0 32px",
    }}>

      {/* Logo */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", flexShrink: 0 }}>
        <img src="/logo.png" alt="Shelby" width={30} height={30} style={{ borderRadius: 8, objectFit: "contain" }} />
        <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0A0A0A", letterSpacing: -0.3 }}>
          Shelby <span style={{ color: "#059669", fontWeight: 500 }}>Analytics</span>
        </span>
      </Link>

      {/* Tabs — căn giữa tuyệt đối */}
      <div style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 1,
        background: "#F4F4F4",
        borderRadius: 12,
        padding: "3px",
      }}>
        {NAV_LINKS.map(link => {
          const active = isActive(link.href);
          return (
            <Link key={link.href} href={link.href} style={{
              padding: "7px 20px", borderRadius: 10, fontSize: 13.5,
              fontFamily: "'Outfit', sans-serif", fontWeight: active ? 600 : 400,
              color: active ? "#0A0A0A" : "#999",
              background: active ? "#fff" : "transparent",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.04)" : "none",
              textDecoration: "none", transition: "all 0.15s", whiteSpace: "nowrap",
            }}>
              {link.label}
            </Link>
          );
        })}
      </div>

      {/* Right — Network Switcher + Docs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>

        {/* Network Switcher */}
        <div style={{
          display: "flex",
          gap: 2,
          background: "#F4F4F4",
          borderRadius: 10,
          padding: "3px",
        }}>
          {(["shelbynet", "testnet"] as NetworkId[]).map(id => {
            const active = network === id;
            const dotColor = id === "shelbynet" ? "#2563eb" : "#9333ea";
            return (
              <button
                key={id}
                onClick={() => setNetwork(id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontFamily: "'Outfit', sans-serif",
                  fontWeight: active ? 600 : 400,
                  color: active ? (id === "shelbynet" ? "#1d4ed8" : "#7c3aed") : "#999",
                  background: active ? "#fff" : "transparent",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: active ? dotColor : "#CCC",
                  boxShadow: active ? `0 0 6px ${dotColor}` : "none",
                  transition: "all 0.15s",
                  flexShrink: 0,
                }} />
                {id === "shelbynet" ? "Shelbynet" : "Testnet"}
              </button>
            );
          })}
        </div>

        {/* Docs */}
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" style={{
          color: "#999", textDecoration: "none", fontFamily: "'Outfit', sans-serif", fontSize: 13.5,
          padding: "7px 14px", borderRadius: 10, border: "1px solid #E8E8E8",
          transition: "all 0.15s",
        }}>Docs ↗</a>
      </div>
    </nav>
  );
}