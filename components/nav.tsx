"use client";
// components/nav.tsx — v10.0
// Route update:
//   Map       → /map           (was /dashboard/providers)
//   Analytics → /analytics     (was /dashboard)
//   Charts    → /charts        (was /dashboard/charts)
//   Benchmark → /              (unchanged)
// Logo: no green square, gradient animation, Community Dashboard subtitle

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";
import { ThemeToggle } from "./theme-context";

const NAV_TABS = [
  { href: "/map",       label: "Map",       exact: false },
  { href: "/analytics", label: "Analytics", exact: true  },
  { href: "/charts",    label: "Charts",    exact: false },
  { href: "/",          label: "Benchmark", exact: true  },
] as const;

export function Nav() {
  const pathname    = usePathname();
  const router      = useRouter();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + "/");
  };

  return (
    <nav className="nav">
      <style>{`
        @keyframes gradient-shift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .nav-logo-gradient {
          background: linear-gradient(90deg, #2563eb, #7c3aed, #06b6d4, #2563eb);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gradient-shift 4s ease infinite;
          font-weight: 700;
        }
      `}</style>

      {/* Logo */}
      <div
        className="nav-logo"
        style={{ cursor: "pointer" }}
        onClick={() => router.push("/")}
        role="link"
        aria-label="Go to home"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.svg"
          alt="Shelby"
          width={26}
          height={26}
          style={{ display: "block", flexShrink: 0 }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", letterSpacing: -0.3 }}>
              Shelby
            </span>
            <span className="nav-logo-gradient" style={{ fontSize: 17 }}>
              Analytics
            </span>
          </div>
          <span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 400, letterSpacing: "0.02em", marginTop: 1 }}>
            Community Dashboard
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="nav-tabs">
        {NAV_TABS.map(({ href, label, exact }) => (
          <Link
            key={href}
            href={`${href}${network === "testnet" ? "?network=testnet" : ""}`}
            className={`nav-tab${isActive(href, exact) ? " active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Right */}
      <div className="nav-right">
        <div className="net-switch">
          {(["shelbynet", "testnet"] as NetworkId[]).map(id => (
            <button
              key={id}
              className={`net-switch-btn${network === id ? " active" : ""}`}
              onClick={() => setNetwork(id)}
            >
              <span style={{
                display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                background: network === id ? (id === "shelbynet" ? "#22c55e" : "#9333ea") : "var(--text-dim)",
                marginRight: 5, verticalAlign: "middle",
              }} />
              {id === "shelbynet" ? "Shelbynet" : "Testnet"}
            </button>
          ))}
        </div>
        <ThemeToggle />
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" className="nav-docs">
          Docs ↗
        </a>
      </div>
    </nav>
  );
}