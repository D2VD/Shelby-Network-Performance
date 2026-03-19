// components/nav.tsx — Fix: tabs căn giữa tuyệt đối + thứ tự Globe→Dashboard→Charts→Benchmark
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavProps {
  apt?: number;
  shelbyusd?: number;
  address?: string;
}

const NAV_LINKS = [
  { href: "/dashboard/providers", label: "Globe"     },
  { href: "/dashboard",           label: "Dashboard" },
  { href: "/dashboard/charts",    label: "Charts"    },
  { href: "/",                    label: "Benchmark" },
];

export function Nav({ apt, shelbyusd, address }: NavProps) {
  const pathname = usePathname();

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

      {/* Right */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
        {address && apt !== undefined && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "#F4F4F4", borderRadius: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#059669" }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#444" }}>{apt.toFixed(3)} APT</span>
            <span style={{ color: "#D0D0D0" }}>·</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: (shelbyusd ?? 0) > 0.001 ? "#444" : "#DC2626" }}>
              {(shelbyusd ?? 0).toFixed(3)} SUSD
            </span>
          </div>
        )}
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" style={{
          color: "#999", textDecoration: "none", fontFamily: "'Outfit', sans-serif", fontSize: 13.5,
          padding: "7px 14px", borderRadius: 10, border: "1px solid #E8E8E8",
        }}>Docs ↗</a>
      </div>
    </nav>
  );
}