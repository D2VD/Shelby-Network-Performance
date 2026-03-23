"use client";
// app/dashboard/page.tsx v4 — Thêm testnet gate

import { useNetwork } from "@/components/network-context";
import { TestnetBanner } from "@/components/testnet-banner";
import type { NetworkStats, NodeInfo } from "@/lib/types";
import useSWR from "swr";

interface CalibrationInfo {
  avgBlobSizeBytes: number;
  calibratedAt:     string | null;
  sampleCount:      number;
  note?:            string;
}

interface StatsResponse {
  ok:   boolean;
  data: {
    stats:       NetworkStats;
    node:        NodeInfo | null;
    network:     string;
    statsSource: string;
    calibration: CalibrationInfo | null;
    errors?:     { stats?: string };
  };
  fetchedAt: string;
}

const fetcher = (url: string): Promise<StatsResponse> =>
  fetch(url).then(r => r.json());

const fmt      = (v: number | null) => { if (v == null) return "—"; return v.toLocaleString("en-US"); };
const fmtBytes = (b: number | null) => {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
};

const CARDS = [
  { key: "totalBlobs",            label: "Total blobs",       sub: "Files stored",          color: "#2563eb", fmt: fmt      },
  { key: "totalStorageUsedBytes", label: "Storage used",      sub: "Total capacity",         color: "#16a34a", fmt: fmtBytes },
  { key: "totalBlobEvents",       label: "Blob events",       sub: "On-chain transactions",  color: "#9333ea", fmt: fmt      },
  { key: "slices",                label: "Total slices",      sub: "Erasure-coded chunks",   color: "#d97706", fmt: fmt      },
  { key: "placementGroups",       label: "Placement groups",  sub: "Active PGs (16 SPs)",    color: "#f97316", fmt: fmt      },
  { key: "storageProviders",      label: "Storage providers", sub: "Active Cavalier nodes",  color: "#16a34a", fmt: fmt      },
] as const;

export default function DashboardPage() {
  const { network, config } = useNetwork();

  const { data, error, isLoading, mutate } = useSWR<StatsResponse>(
    `/api/network/stats?network=${network}`,
    fetcher,
    { refreshInterval: 15_000, dedupingInterval: 10_000 }
  );

  // ── Testnet gate ──────────────────────────────────────────────────────────
  if (network === "testnet") return <TestnetBanner />;

  const stats = data?.data?.stats;
  const node  = data?.data?.node;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="page-title">Network analytics</h1>
          <p className="page-subtitle">
            Real-time metrics for <strong>{config.label}</strong> · auto-refreshes every 15s
          </p>
        </div>
        <button onClick={() => mutate()} disabled={isLoading} className="btn btn-secondary">
          {isLoading ? "⟳ Syncing…" : "⟳ Sync now"}
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          Failed to load analytics data — {error?.message}
        </div>
      )}
      {data?.data?.errors?.stats && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          {data.data.errors.stats}
        </div>
      )}

      {/* Node info bar */}
      {node && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
            {[
              { label: "Block height",   value: `#${node.blockHeight.toLocaleString()}` },
              { label: "Ledger version", value: node.ledgerVersion.toLocaleString() },
              { label: "Chain ID",       value: String(node.chainId) },
              { label: "Network",        value: config.label },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gray-700)", fontWeight: 500 }}>{value}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#16a34a", display: "inline-block", boxShadow: "0 0 0 2px #dcfce7" }} />
              <span style={{ fontSize: 12, color: "var(--gray-500)" }}>Live</span>
            </div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="stat-grid">
        {CARDS.map(card => {
          const raw   = stats?.[card.key as keyof typeof stats];
          const value = isLoading && raw == null ? "…" : card.fmt(raw as any);
          return (
            <div className="stat-card" key={card.key} style={{ borderTop: `3px solid ${card.color}` }}>
              <div className="stat-card-label">{card.label}</div>
              <div className="stat-card-value" style={{ color: value === "…" ? "var(--gray-300)" : undefined }}>{value}</div>
              <div className="stat-card-sub">{card.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Calibration info */}
      {data?.data?.calibration && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body" style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Storage calibration</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gray-600)" }}>
              avg blob: {data.data.calibration.avgBlobSizeBytes?.toLocaleString()} bytes
            </span>
            {data.data.calibration.calibratedAt ? (
              <span style={{ fontSize: 11, color: "var(--gray-400)" }}>
                calibrated {new Date(data.data.calibration.calibratedAt).toLocaleDateString()}
                · {data.data.calibration.sampleCount} samples
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#d97706" }}>
                ⚠ {data.data.calibration.note}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Clay erasure coding info */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Clay erasure coding scheme</div>
            <div className="card-subtitle">How Shelby stores data across 16 Storage Providers</div>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[
              { label: "Chunkset size",    value: "10 MB" },
              { label: "Chunks / set",     value: "16 total" },
              { label: "Data chunks",      value: "10 (original)" },
              { label: "Parity chunks",    value: "6 (recovery)" },
              { label: "Min to recover",   value: "Any 10 of 16" },
              { label: "Max node failures", value: "6 simultaneous" },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: "14px 0", borderBottom: "1px solid var(--gray-100)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--gray-400)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500, color: "var(--gray-800)" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}