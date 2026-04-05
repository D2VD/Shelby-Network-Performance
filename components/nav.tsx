"use client";
// components/nav.tsx — v7.2
// Fix: active state dùng exact match cho /dashboard
// Grafana link → domain VPS trực tiếp (không qua CF Pages)

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

// GRAFANA_URL = domain VPS của bạn + /grafana
// Ví dụ: https://api.shelbyanalytics.site/grafana
// Hoặc subdomain riêng: https://grafana.shelbyanalytics.site
const GRAFANA_URL = "https://api.shelbyanalytics.site/grafana";

const NAV_TABS = [
  { href: "/",                    label: "Benchmark", exact: true  },
  { href: "/dashboard",           label: "Analytics", exact: true  },
  { href: "/dashboard/providers", label: "Map",       exact: false },
  { href: "/dashboard/charts",    label: "Charts",    exact: false },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  // FIX: exact match cho / và /dashboard để tránh 2 tab active
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
          <img
            src="/logo.svg"
            alt="Shelby"
            width={20} height={20}
            style={{ display: "block" }}
          />
        </div>
        <span className="nav-logo-text">
          Shelby<span> Analytics</span>
        </span>
      </div>

      {/* Center tabs */}
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
        {/* Grafana — external link tới VPS (không phải CF Pages route) */}
        <a
          href={GRAFANA_URL}
          target="_blank"
          rel="noreferrer"
          className="nav-tab"
          title="Grafana monitoring dashboard (VPS)"
        >
          Monitor ↗
        </a>
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