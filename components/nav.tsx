// components/nav.tsx — Global navigation bar
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavProps {
  apt?: number;
  shelbyusd?: number;
  address?: string;
}

const NAV_LINKS = [
  { href: "/",                    label: "Benchmark" },
  { href: "/dashboard",           label: "Dashboard" },
  { href: "/dashboard/charts",    label: "Charts"    },
  { href: "/dashboard/providers", label: "Providers" },
];

export function Nav({ apt, shelbyusd, address }: NavProps) {
  const pathname = usePathname();

  // Find active link — most specific match wins
  const active = [...NAV_LINKS]
    .reverse()
    .find(l => pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href)))
    ?.label ?? "Benchmark";

  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 200,
      height: 60, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(20px)",
      borderBottom: "1px solid #EBEBEB",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 32px",
    }}>
      {/* Logo */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <img src="/logo.png" alt="Shelby" width={30} height={30} style={{ borderRadius: 8, objectFit: "contain" }} />
        <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15.5, color: "#0A0A0A", letterSpacing: -0.3 }}>
          Shelby <span style={{ color: "#059669", fontWeight: 500 }}>Benchmark</span>
        </span>
      </Link>

      {/* Center pill tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 1, background: "#F4F4F4", borderRadius: 12, padding: "3px" }}>
        {NAV_LINKS.map(link => {
          const isActive = active === link.label;
          return (
            <Link key={link.href} href={link.href} style={{
              padding: "7px 20px", borderRadius: 10, fontSize: 13.5,
              fontFamily: "'Outfit', sans-serif", fontWeight: isActive ? 600 : 400,
              color: isActive ? "#0A0A0A" : "#999",
              background: isActive ? "#fff" : "transparent",
              boxShadow: isActive ? "0 1px 4px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.04)" : "none",
              textDecoration: "none", transition: "all 0.15s", whiteSpace: "nowrap",
            }}>
              {link.label}
            </Link>
          );
        })}
      </div>

      {/* Right: wallet + docs */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {address && apt !== undefined && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 14px", background: "#F4F4F4", borderRadius: 10,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669" }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#444" }}>
              {apt.toFixed(3)} APT
            </span>
            <span style={{ color: "#D0D0D0" }}>·</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: (shelbyusd ?? 0) > 0.001 ? "#444" : "#DC2626" }}>
              {(shelbyusd ?? 0).toFixed(3)} SUSD
            </span>
          </div>
        )}
        <a href="https://docs.shelby.xyz" target="_blank" style={{
          color: "#999", textDecoration: "none", fontFamily: "'Outfit', sans-serif", fontSize: 13.5,
          padding: "7px 14px", borderRadius: 10, border: "1px solid #E8E8E8",
        }}>
          Docs ↗
        </a>
      </div>
    </nav>
  );
}