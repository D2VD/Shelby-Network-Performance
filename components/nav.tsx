"use client";
// components/nav.tsx — v7.0
// Bỏ "Monitor" tab. Giữ: Benchmark | Analytics | Globe View | Charts

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_TABS = [
  { href: "/",                    label: "Benchmark"  },
  { href: "/dashboard",           label: "Analytics"  },
  { href: "/dashboard/providers", label: "Map"        },
  { href: "/dashboard/charts",    label: "Charts"     },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <nav className="nav">
      {/* Logo */}
      <div className="nav-logo">
        <div className="nav-logo-icon">⬡</div>
        <span className="nav-logo-text">
          Shelby<span> Analytics</span>
        </span>
      </div>

      {/* Center tabs */}
      <div className="nav-tabs">
        {NAV_TABS.map(({ href, label }) => (
          <Link
            key={href}
            href={`${href}${network === "testnet" ? "?network=testnet" : ""}`}
            className={`nav-tab${isActive(href) ? " active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Right: network switcher + docs */}
      <div className="nav-right">
        <div className="net-switch">
          {(["shelbynet", "testnet"] as NetworkId[]).map(id => (
            <button
              key={id}
              className={`net-switch-btn${network === id ? " active" : ""}`}
              onClick={() => setNetwork(id)}
            >
              <span style={{
                display: "inline-block",
                width: 6, height: 6,
                borderRadius: "50%",
                background: network === id
                  ? (id === "shelbynet" ? "#22c55e" : "#9333ea")
                  : "#d1d5db",
                marginRight: 5,
                verticalAlign: "middle",
              }} />
              {id === "shelbynet" ? "Shelbynet" : "Testnet"}
            </button>
          ))}
        </div>
        <a
          href="https://docs.shelby.xyz"
          target="_blank"
          rel="noreferrer"
          className="nav-docs"
        >
          Docs ↗
        </a>
      </div>
    </nav>
  );
}