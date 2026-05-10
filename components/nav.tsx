"use client";
// components/nav.tsx — v15.0
// CHANGES: tab font-size 13px → 14px, font-weight 500 → 700 (active) / 600 (inactive)

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useNetwork, type NetworkId } from "./network-context";
import { useTheme } from "./theme-context";

const NAV_TABS = [
  { href: "/map",       label: "Map",       exact: false },
  { href: "/network",   label: "Network",   exact: false },
  { href: "/explorer",  label: "Explorer",  exact: false },
  { href: "/benchmark", label: "Benchmark", exact: false },
] as const;

const NETWORK_OPTIONS: { id: NetworkId; label: string; sub: string; color: string }[] = [
  { id: "shelbynet", label: "Shelbynet", sub: "Devnet prototype", color: "#22c55e" },
  { id: "testnet",   label: "Testnet",   sub: "Early access",     color: "#a855f7" },
];

function NetworkDropdown() {
  const { network, setNetwork } = useNetwork();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const cur = NETWORK_OPTIONS.find(o => o.id === network) ?? NETWORK_OPTIONS[0];

  return (
    <div className="net-dropdown" ref={ref}>
      <button
        className={`net-dropdown-btn${open ? " open" : ""}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="net-dot" style={{ background: cur.color }} />
        <span>{cur.label}</span>
        <svg
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          style={{ width: 12, height: 12, opacity: 0.5, flexShrink: 0, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className="net-dropdown-menu" role="listbox">
          {NETWORK_OPTIONS.map(opt => (
            <button
              key={opt.id}
              role="option"
              aria-selected={network === opt.id}
              className={`net-option${network === opt.id ? " active" : ""}`}
              onClick={() => { setNetwork(opt.id); setOpen(false); }}
            >
              <span className="net-dot" style={{ background: opt.color }} />
              <span className="net-label">{opt.label}</span>
              <span className="net-sublabel">{opt.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggleSwitch() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? "Switch to Light" : "Switch to Dark"}
      aria-label="Toggle theme"
      style={{ background: "none", border: "none", padding: "0 2px", cursor: "pointer", display: "flex", alignItems: "center" }}
    >
      <div className="theme-toggle-track">
        <div className="theme-toggle-thumb">
          {isDark
            ? <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" style={{ opacity: 0.85 }}><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/></svg>
            : <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.7 }}><circle cx="10" cy="10" r="4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41"/></svg>
          }
        </div>
      </div>
    </button>
  );
}

function NhiBadge() {
  const [nhi, setNhi] = useState<number | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/network/health")
        .then(r => r.ok ? r.json() : null)
        .then((d: any) => { if (d?.data?.nhi != null) setNhi(Math.round(d.data.nhi)); })
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (nhi === null) return null;
  const color = nhi >= 80 ? "#22c55e" : nhi >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="nhi-badge" title={`Network Health Index: ${nhi}/100`} style={{ color, background: `${color}18`, borderColor: `${color}44` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
      <span>NHI {nhi}</span>
    </div>
  );
}

export function Nav() {
  const pathname    = usePathname();
  const router      = useRouter();
  const { network } = useNetwork();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname?.startsWith(href + "/");

  const withNet = (href: string) =>
    network === "testnet" ? `${href}?network=testnet` : href;

  return (
    <nav className="nav">
      {/* Logo */}
      <div
        className="nav-logo"
        onClick={() => router.push("/")}
        role="link"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && router.push("/")}
        style={{ cursor: "pointer" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Shelby" width={26} height={26} style={{ display: "block", flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <div className="nav-logo-wordmark">
          <div className="nav-logo-name">Shelby <span>Analytics</span></div>
          <div className="nav-logo-sub">Community Dashboard</div>
        </div>
      </div>

      {/* Tabs — bolder, slightly larger */}
      <div className="nav-tabs">
        {NAV_TABS.map(({ href, label, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={withNet(href)}
              className={`nav-tab${active ? " active" : ""}`}
              style={{
                fontSize:   14,
                fontWeight: active ? 700 : 600,
                letterSpacing: "0.005em",
              }}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Right */}
      <div className="nav-right">
        <NhiBadge />
        <NetworkDropdown />
        <ThemeToggleSwitch />
        <a href="https://docs.shelby.xyz" target="_blank" rel="noreferrer" className="nav-docs">
          Docs ↗
        </a>
      </div>
    </nav>
  );
}