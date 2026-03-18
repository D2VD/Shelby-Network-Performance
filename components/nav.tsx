"use client";
// components/nav.tsx v3 — Nav bar ngang, light theme
// Logo | Tabs trung tâm | Network switcher + Wallet + Docs

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

const NAV_LINKS = [
  { href: "/",                    label: "Benchmark" },
  { href: "/dashboard",           label: "Dashboard"  },
  { href: "/dashboard/charts",    label: "Charts"     },
  { href: "/dashboard/providers", label: "Globe"      },
] as const;

interface NavProps {
  apt?:       number;
  shelbyusd?: number;
  address?:   string;
}

export function Nav({ apt, shelbyusd, address }: NavProps) {
  const pathname            = usePathname();
  const { network, setNetwork } = useNetwork();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <nav className="nav">
      {/* Logo */}
      <Link href="/" className="nav-logo">
        <div className="nav-logo-icon">⬡</div>
        <span className="nav-logo-text">
          Shelby <span>Analytics</span>
        </span>
      </Link>

      {/* Tab group */}
      <div className="nav-tabs">
        {NAV_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={network === "testnet" ? `${href}?network=testnet` : href}
            className={`nav-tab${isActive(href) ? " active" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Right section */}
      <div className="nav-right">
        {/* Network switcher */}
        <div className="net-switch">
          {(["shelbynet", "testnet"] as NetworkId[]).map(id => (
            <button
              key={id}
              onClick={() => setNetwork(id)}
              className={`net-switch-btn${network === id ? " active" : ""}`}
            >
              {id === "shelbynet" ? "Shelbynet" : "Testnet"}
            </button>
          ))}
        </div>

        {/* Wallet */}
        {address && apt !== undefined && (
          <div className="wallet-badge">
            <span className="wallet-dot" />
            <span className="wallet-apt">{apt.toFixed(3)} APT</span>
            <span className="wallet-sep">·</span>
            <span className={`wallet-usd${(shelbyusd ?? 0) < 0.001 ? " low" : ""}`}>
              {(shelbyusd ?? 0).toFixed(3)} SUSD
            </span>
          </div>
        )}

        {/* Docs */}
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