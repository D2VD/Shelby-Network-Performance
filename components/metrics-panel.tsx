"use client";
// components/metrics-panel.tsx — v5.1
// FIX: Khi collapsed chỉ hiện mũi tên toggle, không bị blank trắng.
// FIX: Position sticky ở layout, không cần tự set ở đây.

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
interface NodeInfo { blockHeight: number; ledgerVersion: number; chainId: number }

function fmt(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US");
}
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(2)} MB`;
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
  const [stats,     setStats]     = useState<Stats>({ totalBlobs: null, totalStorageUsedBytes: null, totalBlobEvents: null, slices: null, placementGroups: null, storageProviders: null });
  const [node,      setNode]      = useState<NodeInfo | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [lastAt,    setLastAt]    = useState<string>("");
  const prevVals = useRef<Record<string, string>>({});
  const [pulses,  setPulses]  = useState<Record<string, boolean>>({});

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/stats?network=${network}`);
      if (!res.ok) return;
      const d = await res.json() as any;
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

  // ── Collapsed state ──────────────────────────────────────────────────────────
  // FIX: Dùng width transition thay vì thay đổi display, tránh blank trắng.
  // Panel luôn render, chỉ thu/mở bằng width + overflow hidden.
  return (
    <div style={{
      width:      collapsed ? 36 : 220,
      minWidth:   collapsed ? 36 : 220,
      transition: "width 0.25s ease, min-width 0.25s ease",
      overflow:   "hidden",
      background: "#fff",
      borderLeft: "1px solid #EBEBEB",
      height:     "100%",
      display:    "flex",
      flexDirection: "column",
    }}>
      {/* Toggle button — luôn hiển thị */}
      <div style={{
        display:        "flex",
        justifyContent: collapsed ? "center" : "flex-end",
        padding:        collapsed ? "16px 0" : "12px 14px 4px",
        flexShrink:     0,
      }}>
        <button
          onClick={() => setCollapsed(v => !v)}
          title={collapsed ? "Expand panel" : "Collapse panel"}
          style={{
            background:   "none",
            border:       "1px solid #EBEBEB",
            borderRadius: 6,
            cursor:       "pointer",
            color:        "#9ca3af",
            fontSize:     11,
            padding:      "3px 6px",
            lineHeight:   1,
            transition:   "all 0.14s",
            flexShrink:   0,
          }}
        >
          {collapsed ? "▶" : "◀"}
        </button>
      </div>

      {/* Content — ẩn khi collapsed bằng opacity + pointer-events */}
      <div style={{
        opacity:        collapsed ? 0 : 1,
        transition:     "opacity 0.2s",
        pointerEvents:  collapsed ? "none" : "auto",
        flex:           1,
        overflowY:      "auto",
        padding:        "0 16px 20px",
        display:        "flex",
        flexDirection:  "column",
        gap:            10,
        minWidth:       184, // giữ layout ổn định khi đang transition
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>Network</span>
        </div>

        {/* Live indicator */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 12, color: "#6b7280" }}>{loading ? "Syncing…" : "Live"}</span>
          </div>
          {lastAt && <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "var(--font-mono)" }}>{lastAt}</span>}
        </div>

        {/* Block ticker */}
        {node && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--net-bg, #eff6ff)", border: "1px solid var(--net-border, #bfdbfe)", borderRadius: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--net-text, #1d4ed8)" }}>Block</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--net-color, #2563eb)" }}>
              #{node.blockHeight.toLocaleString("en-US")}
            </span>
          </div>
        )}
        {!node && loading && <div className="skeleton" style={{ height: 36, borderRadius: 8 }} />}

        {/* Metric items */}
        {METRICS.map(m => {
          const rawVal  = stats[m.key as keyof Stats];
          const display = loading && rawVal == null ? "…" : m.fmt(rawVal as any);
          const pulsing = pulses[m.key];
          const isLarge = typeof rawVal === "number" && rawVal >= 100_000;
          return (
            <div key={m.key} style={{ padding: "8px 10px", background: "#f9fafb", border: "1px solid #f0f0f0", borderRadius: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9ca3af", marginBottom: 3 }}>
                {m.label}
              </div>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize:   isLarge ? 15 : 17,
                fontWeight: 700,
                color:      pulsing ? "var(--net-color, #2563eb)" : "#111827",
                transition: "color 0.3s",
                letterSpacing: isLarge ? "-0.02em" : 0,
                lineHeight: 1.2,
              }}>
                {display}
              </div>
            </div>
          );
        })}

        {/* Chain info */}
        {node && (
          <div style={{ paddingTop: 8, borderTop: "1px solid #f0f0f0" }}>
            {[
              { label: "Chain ID", value: String(node.chainId) },
              { label: "Ledger",   value: node.ledgerVersion.toLocaleString("en-US") },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#6b7280" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}