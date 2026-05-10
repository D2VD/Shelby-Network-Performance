"use client";
/**
 * components/nhi-badge.tsx — v1.0
 * Network Health Index badge — shown in Nav bar
 *
 * Displays: NHI score 0–100 with color coding
 *   🟢 ≥80 = healthy   → green
 *   🟡 60–79 = degraded → amber
 *   🔴 <60  = critical  → red
 *
 * Fetches from /api/network/health every 60s
 * Shows tooltip on hover with component breakdown
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNetwork } from "./network-context";

interface NHIData {
  nhi:    number;
  status: "healthy" | "degraded" | "critical";
  detail: string;
  components?: {
    spQuorum:          number;
    nodeAvailability:  number;
    epochHealth:       number;
    storageUtilization:number;
  };
}

const STATUS_COLOR: Record<string, string> = {
  healthy:  "#22c55e",
  degraded: "#f59e0b",
  critical: "#ef4444",
};

const STATUS_BG: Record<string, string> = {
  healthy:  "rgba(34,197,94,0.12)",
  degraded: "rgba(245,158,11,0.12)",
  critical: "rgba(239,68,68,0.12)",
};

const REFRESH_MS = 60_000;

export function NHIBadge() {
  const { network }  = useNetwork();
  const [data,  setData]  = useState<NHIData | null>(null);
  const [hover, setHover] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch(`/api/network/health?network=${network}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) return;
      const j = await r.json() as NHIData & { ok?: boolean };
      if (alive.current && typeof j.nhi === "number") setData(j);
    } catch {
      /* silent — badge is best-effort */
    }
  }, [network]);

  useEffect(() => {
    if (alive.current) setData(null);
    fetch_();
    const id = setInterval(fetch_, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetch_]);

  if (!data) {
    // Loading skeleton
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px", borderRadius: 7, background: "var(--bg-card2)",
        border: "1px solid var(--border)", fontSize: 11,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-dim)", flexShrink: 0 }} />
        <span style={{ color: "var(--text-dim)", fontFamily: "monospace" }}>NHI —</span>
      </div>
    );
  }

  const color  = STATUS_COLOR[data.status] ?? "#9ca3af";
  const bg     = STATUS_BG[data.status]    ?? "rgba(100,116,139,0.1)";
  const nhi    = Math.round(Math.max(0, Math.min(100, data.nhi)));

  return (
    <div style={{ position: "relative" }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 7,
          background: bg, border: `1px solid ${color}44`,
          cursor: "help", userSelect: "none",
          transition: "all 0.15s",
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: color, flexShrink: 0,
          boxShadow: data.status === "healthy" ? `0 0 6px ${color}88` : "none",
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700, fontFamily: "monospace",
          color, letterSpacing: "0.01em",
        }}>
          NHI {nhi}
        </span>
      </div>

      {/* Tooltip */}
      {hover && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          zIndex: 200, minWidth: 220,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "12px 14px",
          boxShadow: "0 8px 24px var(--shadow-color)",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Network Health Index
          </div>
          {/* Score bar */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
              <span style={{ color: "var(--text-muted)" }}>Overall</span>
              <span style={{ fontWeight: 700, color, fontFamily: "monospace" }}>{nhi}/100</span>
            </div>
            <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${nhi}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
            </div>
          </div>
          {/* Components */}
          {data.components && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {([
                ["SP Quorum",     data.components.spQuorum,           30],
                ["Node Health",   data.components.nodeAvailability,   25],
                ["Epoch Health",  data.components.epochHealth,        25],
                ["Storage Util",  data.components.storageUtilization, 20],
              ] as [string, number, number][]).map(([label, score, weight]) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>
                    <span>{label} <span style={{ opacity: 0.5 }}>({weight}%)</span></span>
                    <span style={{ fontFamily: "monospace", fontWeight: 600, color: score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444" }}>{Math.round(score)}</span>
                  </div>
                  <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${score}%`, background: score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444", borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {data.detail && (
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace" }}>{data.detail}</div>
          )}
          <div style={{ marginTop: 8, fontSize: 9, color: "var(--text-dim)", display: "flex", justifyContent: "space-between" }}>
            <span>Refreshes every 60s</span>
            <span style={{ color }}>{data.status}</span>
          </div>
        </div>
      )}
    </div>
  );
}