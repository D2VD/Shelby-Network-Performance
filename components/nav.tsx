"use client";
// components/nav.tsx — v7.1
// FIX: active state logic chính xác — tránh 2 tab active cùng lúc

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_TABS = [
  { href: "/",                    label: "Benchmark", exact: true  },
  { href: "/dashboard",           label: "Analytics", exact: true  },
  { href: "/dashboard/providers", label: "Map",       exact: false },
  { href: "/dashboard/charts",    label: "Charts",    exact: false },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { network, setNetwork } = useNetwork();

  // FIX: exact match cho "/" và "/dashboard"
  // prefix match chỉ cho các sub-pages
  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname?.startsWith(href + "/") || pathname === href;
  };

  return (
    <nav className="nav">
      {/* Logo */}
      <div className="nav-logo">
        {/* Logo có thể thay qua /public/logo.svg */}
        <div className="nav-logo-icon">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="Shelby"
            width={20}
            height={20}
            onError={e => {
              // Fallback nếu không có logo.svg
              (e.target as HTMLImageElement).style.display = "none";
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent) parent.textContent = "⬡";
            }}
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