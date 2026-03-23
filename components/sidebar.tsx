"use client";
// components/sidebar.tsx
// Glassmorphism Sidebar (30% width) với:
//   - Logo + version badge
//   - Network Switcher (Shelbynet Cyan ↔ Testnet Purple)
//   - 6 real-time metric tiles (Blobs, Slices, SPs, PGs, Storage, Events)
//   - Block height ticker
//   - Navigation links

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNetwork, type NetworkId } from "./network-context";

// ── Types ──────────────────────────────────────────────────────────────────────
interface NetworkStats {
  totalBlobs: number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents: number | null;
  slices: number | null;
  placementGroups: number | null;
  storageProviders: number | null;
}

interface NodeInfo {
  blockHeight: number;
  ledgerVersion: number;
  chainId: number;
}

// ── Formatters ─────────────────────────────────────────────────────────────────
function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}

// ── Animated metric value ──────────────────────────────────────────────────────
function MetricTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  const prevRef = useRef(value);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (prevRef.current !== value && value !== "—") {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 800);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div className="metric-tile">
      <div className="metric-label">{icon} {label}</div>
      <div className={`metric-value${pulse ? " updated" : ""}`}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

// ── Nav Item ──────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/",                    icon: "⚡", label: "Benchmark" },
  { href: "/dashboard",           icon: "◈",  label: "Analytics" },
  { href: "/dashboard/providers", icon: "◎",  label: "Globe View" },
  { href: "/dashboard/charts",    icon: "▲",  label: "Charts" },
] as const;

// ── Main Sidebar ──────────────────────────────────────────────────────────────
export function Sidebar() {
  const { network, config, setNetwork } = useNetwork();
  const pathname = usePathname();

  const [stats, setStats] = useState<NetworkStats>({
    totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null,
    slices: null, placementGroups: null, storageProviders: null,
  });
  const [node, setNode]       = useState<NodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAt, setLastAt]   = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const url = `/api/network/stats?network=${network}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const d = await res.json() as any;
      if (d.ok || d.data) {
        setStats(d.data?.stats ?? {});
        setNode(d.data?.node ?? null);
        setLastAt(new Date());
      }
    } catch {
      // Silently ignore — sidebar metrics are best-effort
    } finally {
      setLoading(false);
    }
  }, [network]);

  // Fetch on mount + network change, then poll every 15s
  useEffect(() => {
    setLoading(true);
    setStats({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
    setNode(null);
    fetchStats();
    const id = setInterval(fetchStats, 15_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <aside className="sidebar">
      {/* ── Logo ── */}
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon">⬡</div>
          <span className="logo-name">Shelby</span>
          <span className="logo-version">v2.0</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--text-mono)", marginTop: 2 }}>
          Analytics Community Dashboard
        </div>
      </div>

      {/* ── Network Switcher ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Network</div>
        <div className="network-switcher">
          {(["shelbynet", "testnet"] as NetworkId[]).map((id) => {
            const isActive = network === id;
            const isCyan   = id === "shelbynet";
            return (
              <button
                key={id}
                className={`net-btn${isActive ? (isCyan ? " active-shelbynet" : " active-testnet") : ""}`}
                onClick={() => setNetwork(id)}
                title={isCyan ? "Shelbynet (devnet prototype)" : "Testnet (early access)"}
              >
                <span
                  className="net-dot"
                  style={{
                    background: isActive
                      ? (isCyan ? "var(--cyan-bright)" : "var(--purple-bright)")
                      : "var(--text-dim)",
                    boxShadow: isActive
                      ? `0 0 6px ${isCyan ? "var(--cyan-bright)" : "var(--purple-bright)"}`
                      : "none",
                  }}
                />
                {isCyan ? "Shelbynet" : "Testnet"}
              </button>
            );
          })}
        </div>

        {/* Live status indicator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <div className="status-dot">
            <span className="dot live" style={{ background: "var(--net-bright)", boxShadow: `0 0 6px var(--net-bright)` }} />
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--text-mono)" }}>
              {loading ? "Syncing..." : "Live"}
            </span>
          </div>
          {lastAt && (
            <span style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--text-mono)" }}>
              {lastAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── 6 Metric Tiles ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Network Metrics</div>
        <div className="metrics-grid">
          <MetricTile
            label="Blobs"
            value={loading ? "..." : fmtNum(stats.totalBlobs)}
            sub="Total files"
            icon="◈"
          />
          <MetricTile
            label="Slices"
            value={loading ? "..." : fmtNum(stats.slices)}
            sub="Erasure chunks"
            icon="⬡"
          />
          <MetricTile
            label="Providers"
            value={loading ? "..." : fmtNum(stats.storageProviders)}
            sub="Active SPs"
            icon="◎"
          />
          <MetricTile
            label="Pl. Groups"
            value={loading ? "..." : fmtNum(stats.placementGroups)}
            sub="Active PGs"
            icon="▦"
          />
          <MetricTile
            label="Storage"
            value={loading ? "..." : fmtBytes(stats.totalStorageUsedBytes)}
            sub="Used capacity"
            icon="▣"
          />
          <MetricTile
            label="Events"
            value={loading ? "..." : fmtNum(stats.totalBlobEvents)}
            sub="On-chain txs"
            icon="↯"
          />
        </div>

        {/* Block height ticker */}
        {node && (
          <div className="block-ticker">
            <span className="block-label">Block</span>
            <span className="block-val mono">#{node.blockHeight.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* ── Network Info ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">Connection</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Network", value: config.label },
            { label: "Chain ID", value: node ? String(node.chainId) : "—" },
            { label: "Ledger", value: node ? fmtNum(node.ledgerVersion) : "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
              <span style={{ fontSize: 11, fontFamily: "var(--text-mono)", color: "var(--text-secondary)" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="sidebar-nav">
        <div className="sidebar-section-label" style={{ padding: "0 4px", marginBottom: 8 }}>Navigate</div>
        {NAV_ITEMS.map(({ href, icon, label }) => (
          <Link
            key={href}
            href={`${href}${network === "testnet" ? "?network=testnet" : ""}`}
            className={`nav-link${isActive(href) ? " active" : ""}`}
          >
            <span className="nav-icon">{icon}</span>
            {label}
            {isActive(href) && (
              <span style={{
                marginLeft: "auto",
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--net-bright)",
                boxShadow: "0 0 6px var(--net-bright)",
              }} />
            )}
          </Link>
        ))}

        {/* Footer info */}
        <div style={{ marginTop: 16, padding: "0 12px", fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--text-mono)", lineHeight: 1.6 }}>
          <div>Shelby Protocol · Powered by Aptos</div>
          <div style={{ marginTop: 2 }}>Built by Jump Crypto</div>
        </div>
      </div>
    </aside>
  );
}