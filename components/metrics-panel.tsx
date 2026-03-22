"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useNetwork } from "./network-context";

interface Stats {
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
  slices:                number | null;
  placementGroups:       number | null;
  storageProviders:      number | null;
}

interface NodeInfo { blockHeight: number; ledgerVersion: number; chainId: number; }

// Hiện đầy đủ số với dấu phẩy ngăn cách hàng nghìn
function fmt(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US");
}

// Hiện bytes với 2 chữ số thập phân
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3)  return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

const METRICS = [
  { key: "totalBlobs",            label: "Total Blobs",  fmt: fmt      },
  { key: "slices",                label: "Slices",       fmt: fmt      },
  { key: "storageProviders",      label: "Providers",    fmt: fmt      },
  { key: "placementGroups",       label: "Pl. Groups",   fmt: fmt      },
  { key: "totalStorageUsedBytes", label: "Storage Used", fmt: fmtBytes },
  { key: "totalBlobEvents",       label: "Blob Events",  fmt: fmt      },
] as const;

export function MetricsPanel() {
  const { network } = useNetwork();
  const [collapsed, setCollapsed] = useState(false);
  const [stats,  setStats]  = useState<Stats>({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
  const [node,   setNode]   = useState<NodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastAt,  setLastAt]  = useState<string>("");
  const prevVals = useRef<Record<string, string>>({});
  const [pulses,  setPulses]  = useState<Record<string, boolean>>({});

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats?network=${network}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.data?.stats) {
        const newStats = d.data.stats as Stats;
        const changed: Record<string, boolean> = {};
        METRICS.forEach(m => {
          const newVal = String(newStats[m.key as keyof Stats] ?? "");
          if (prevVals.current[m.key] !== undefined && prevVals.current[m.key] !== newVal && newVal !== "null") {
            changed[m.key] = true;
          }
          prevVals.current[m.key] = newVal;
        });
        if (Object.keys(changed).length > 0) {
          setPulses(changed);
          setTimeout(() => setPulses({}), 1000);
        }
        setStats(newStats);
        setNode(d.data.node ?? null);
        setLastAt(new Date().toLocaleTimeString());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    setStats({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
    setNode(null);
    fetchStats();
    const id = setInterval(fetchStats, 15_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  if (collapsed) {
    return (
      <div className="metrics-panel" style={{ width: 44 }}>
        <button onClick={() => setCollapsed(false)} className="panel-toggle" title="Show metrics" style={{ width: "100%", height: 36 }}>◀</button>
      </div>
    );
  }

  return (
    <div className="metrics-panel">
      <div className="metrics-panel-header">
        <span className="metrics-panel-title">Network</span>
        <button className="panel-toggle" onClick={() => setCollapsed(true)} title="Collapse">▶</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="live-dot">
          <span className="live-dot-circle" />
          <span style={{ fontSize: 12, color: "var(--gray-500)" }}>{loading ? "Syncing…" : "Live"}</span>
        </div>
        {lastAt && <span style={{ fontSize: 11, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>{lastAt}</span>}
      </div>

      {node && (
        <div className="block-ticker">
          <span className="block-ticker-label">Block</span>
          <span className="block-ticker-value">#{node.blockHeight.toLocaleString("en-US")}</span>
        </div>
      )}
      {!node && loading && <div className="skeleton" style={{ height: 40, marginBottom: 8 }} />}

      {METRICS.map(m => {
        const rawVal = stats[m.key as keyof Stats];
        const display = loading && rawVal == null ? "…" : m.fmt(rawVal as any);
        const isPulsing = pulses[m.key];
        // Smaller font for large numbers
        const isLarge = typeof rawVal === "number" && rawVal >= 100_000;
        return (
          <div key={m.key} className="metric-item">
            <div className="metric-item-label">{m.label}</div>
            <div
              className="metric-item-value"
              style={{
                transition: "color 0.3s",
                color: isPulsing ? "var(--net-color)" : undefined,
                fontSize: isLarge ? "1.05rem" : undefined,
                letterSpacing: isLarge ? "-0.02em" : undefined,
              }}
            >
              {display}
            </div>
          </div>
        );
      })}

      {node && (
        <div style={{ padding: "10px 2px 0", borderTop: "1px solid var(--gray-100)", marginTop: 4 }}>
          {[
            { label: "Chain ID", value: String(node.chainId) },
            { label: "Ledger",   value: node.ledgerVersion.toLocaleString("en-US") },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-600)" }}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}