"use client";
// components/metrics-panel.tsx v3.1
// FIX: Không hardcode width — lấy 100% từ container sticky div trong layout.tsx
// Layout.tsx đã set container width=260px, panel chỉ cần width:100% height:100%

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

function fmt(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}

const METRICS = [
  { key: "totalBlobs",            label: "Total Blobs",  accent: "accent-blue",   fmt: fmt       },
  { key: "slices",                label: "Slices",       accent: "accent-amber",  fmt: fmt       },
  { key: "storageProviders",      label: "Providers",    accent: "accent-green",  fmt: fmt       },
  { key: "placementGroups",       label: "Pl. Groups",   accent: "accent-purple", fmt: fmt       },
  { key: "totalStorageUsedBytes", label: "Storage Used", accent: "accent-blue",   fmt: fmtBytes  },
  { key: "totalBlobEvents",       label: "Blob Events",  accent: "accent-green",  fmt: fmt       },
] as const;

export function MetricsPanel() {
  const { network } = useNetwork();
  const [collapsed, setCollapsed] = useState(false);
  const [stats,  setStats]  = useState<Stats>({
    totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null,
    slices: null, placementGroups: null, storageProviders: null,
  });
  const [node,    setNode]    = useState<NodeInfo | null>(null);
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

  // ── Collapsed state ────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingTop: 16, gap: 8,
      }}>
        <button
          onClick={() => setCollapsed(false)}
          title="Show metrics"
          style={{
            background: "none", border: "1px solid #E8E8E8", borderRadius: 7,
            cursor: "pointer", color: "#999", fontSize: 11, padding: "6px 8px",
            width: 36, lineHeight: 1,
          }}
        >◀</button>
      </div>
    );
  }

  // ── Expanded state ─────────────────────────────────────────────────────────
  return (
    <div style={{
      width: "100%",
      height: "100%",
      padding: "20px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, textTransform: "uppercase",
          letterSpacing: "0.08em", color: "var(--gray-500)",
        }}>
          Network
        </span>
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse"
          style={{
            background: "none", border: "1px solid #E8E8E8", borderRadius: 6,
            cursor: "pointer", color: "#AAA", fontSize: 11, padding: "3px 6px",
            lineHeight: 1, transition: "all 0.14s",
          }}
        >▶</button>
      </div>

      {/* Live indicator */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0,
            animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
            boxShadow: "0 0 0 2px #dcfce7",
          }} />
          <span style={{ fontSize: 12, color: "var(--gray-500)" }}>
            {loading ? "Syncing…" : "Live"}
          </span>
        </div>
        {lastAt && (
          <span style={{ fontSize: 10, color: "var(--gray-400)", fontFamily: "var(--font-mono)" }}>
            {lastAt}
          </span>
        )}
      </div>

      {/* Block ticker */}
      {node && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", background: "var(--net-bg)", border: "1px solid var(--net-border)",
          borderRadius: 8, marginBottom: 2,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.07em", color: "var(--net-text)",
          }}>Block</span>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 13,
            fontWeight: 700, color: "var(--net-color)",
          }}>
            #{node.blockHeight.toLocaleString()}
          </span>
        </div>
      )}
      {!node && loading && (
        <div className="skeleton" style={{ height: 40, marginBottom: 4 }} />
      )}

      {/* 6 metric items */}
      {METRICS.map(m => {
        const rawVal = stats[m.key as keyof Stats];
        const display = loading && rawVal == null ? "…" : m.fmt(rawVal as any);
        const isPulsing = pulses[m.key];
        return (
          <div key={m.key} style={{
            padding: "10px 12px",
            background: "var(--gray-50)",
            border: "1px solid var(--gray-100)",
            borderRadius: 10,
          }}>
            <div style={{
              fontSize: 10, color: "var(--gray-500)", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3,
            }}>
              {m.label}
            </div>
            <div style={{
              fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700,
              color: isPulsing ? "var(--net-color)" : "var(--gray-900)",
              transition: "color 0.3s",
              lineHeight: 1.2,
            }}>
              {display}
            </div>
          </div>
        );
      })}

      {/* Chain info footer */}
      {node && (
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--gray-100)", marginTop: 2 }}>
          {[
            { label: "Chain ID", value: String(node.chainId)                      },
            { label: "Ledger",   value: node.ledgerVersion.toLocaleString()        },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {label}
              </span>
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--gray-600)" }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}