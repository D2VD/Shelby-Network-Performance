"use client";
// components/nav.tsx — v7.3
// Thứ tự: Map | Analytics | Charts | Benchmark
// Bỏ Monitor (truy cập trực tiếp qua api.shelbyanalytics.site/grafana)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

// exact=true: chỉ active khi pathname === href (tránh 2 tab active)
const NAV_TABS = [
  { href: "/dashboard/providers", label: "Map",       exact: false },
  { href: "/dashboard",           label: "Analytics", exact: true  },
  { href: "/dashboard/charts",    label: "Charts",    exact: false },
  { href: "/",                    label: "Benchmark", exact: true  },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + "/");
  };

  return (
    <nav className="nav">
      {/* Logo */}
      <div className="nav-logo">
        <div className="nav-logo-icon">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Shelby" width={20} height={20} style={{ display: "block" }} />
        </div>
        <span className="nav-logo-text">
          Shelby<span> Analytics</span>
        </span>
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
                background: network === id ? (id === "shelbynet" ? "#22c55e" : "#9333ea") : "#d1d5db",
                marginRight: 5, verticalAlign: "middle",
              }} />
              {id === "shelbynet" ? "Shelbynet" : "Testnet"}
            </button>
          ))}
        </div>
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" className="nav-docs">
          Docs ↗
        </a>
      </div>
    </nav>
  );
}