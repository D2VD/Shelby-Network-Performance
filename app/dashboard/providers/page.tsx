"use client";
/**
 * app/dashboard/providers/page.tsx — v6.1
 *
 * Light mode — giống Plausible Live View:
 *   Left sidebar (340px): light bg, metrics + provider list
 *   Right area (flex):    Globe (light blue)
 *
 * Network info panel giống hình 3: rộng hơn, các metric hiển thị 2 cột.
 */

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useProviders } from "@/lib/use-providers";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";
import useSWR from "swr";

const GlobeMap = dynamic(() => import("@/components/map-wrapper"), {
  ssr: false,
  loading: () => (
    <div style={{
      width: "100%", height: "100%", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#f0f4f8",
      color: "#9ca3af", fontFamily: "var(--font-mono)", fontSize: 13,
      flexDirection: "column", gap: 10,
    }}>
      <style>{`@keyframes _s{to{transform:rotate(360deg)}}`}</style>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" stroke="#e5e7eb" strokeWidth="2"/>
        <circle cx="16" cy="16" r="12" stroke="#0ea5e9" strokeWidth="2"
          strokeDasharray="19 57" strokeLinecap="round"
          style={{ transformOrigin:"16px 16px", animation:"_s 1.2s linear infinite" }}/>
      </svg>
      Loading globe…
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────
interface Stats {
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
  slices:                number | null;
  placementGroups:       number | null;
  storageProviders:      number | null;
}
interface NodeInfo { blockHeight: number; ledgerVersion: number; chainId: number }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return v.toLocaleString("en-US");
  return String(v);
}
function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}

// ─── Provider detail panel ────────────────────────────────────────────────────
function ProviderPanel({ p, accentColor, network, onClose }: {
  p: StorageProvider & { fullBlsKey?: string };
  accentColor: string; network: string; onClose: () => void;
}) {
  return (
    <div style={{
      position: "absolute", top: 12, right: 12, zIndex: 30,
      width: 280,
      background: "rgba(255,255,255,0.97)",
      backdropFilter: "blur(16px)",
      border: "1px solid #e5e7eb",
      borderRadius: 14, padding: "16px 18px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 2 }}>Storage Provider</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#0369a1", fontWeight: 600 }}>{p.addressShort}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
        <span className={`badge badge-${p.state === "Active" ? "green" : "red"}`}><span className="badge-dot"/>{p.state}</span>
        <span className={`badge badge-${p.health === "Healthy" ? "green" : "red"}`}><span className="badge-dot"/>{p.health}</span>
      </div>
      {p.geo?.city && (
        <div style={{ marginBottom: 10, padding: "7px 10px", background: "#f9fafb", border: "1px solid #f0f0f0", borderRadius: 7 }}>
          <div style={{ fontSize: 8, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Location</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#374151" }}>{[p.geo.city, p.geo.countryCode].filter(Boolean).join(", ")}</div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>{p.geo.lat.toFixed(4)}°, {p.geo.lng.toFixed(4)}°</div>
        </div>
      )}
      {[
        { l: "Zone",     v: ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone },
        { l: "Capacity", v: p.capacityTiB ? `${p.capacityTiB.toFixed(2)} TiB` : "—" },
        { l: "Net IP",   v: p.netAddress || "—" },
      ].map(({ l, v }) => (
        <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em" }}>{l}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#6b7280", maxWidth: "60%", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
        </div>
      ))}
      <a href={`https://explorer.aptoslabs.com/account/${p.address}?network=${network}`}
        target="_blank" rel="noreferrer"
        style={{
          display: "block", textAlign: "center", padding: "7px 0",
          borderRadius: 7, fontSize: 11, marginTop: 8,
          background: "#eff6ff", border: "1px solid #bfdbfe",
          color: "#2563eb", textDecoration: "none", fontFamily: "var(--font-mono)",
        }}>
        View on Explorer ↗
      </a>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const { network, config } = useNetwork();
  const { providers, loading: provLoad, error, refresh } = useProviders();
  const [selected, setSelected] = useState<StorageProvider | null>(null);

  // Network stats
  const { data: statsData } = useSWR<any>(
    `/api/network/stats?network=${network}`,
    (url: string) => fetch(url).then(r => r.json()),
    { refreshInterval: 15_000 }
  );

  const stats: Stats    = statsData?.data?.stats ?? {};
  const node:  NodeInfo | null = statsData?.data?.node ?? null;

  const activeCount  = providers.filter(p => p.state === "Active").length;
  const healthyCount = providers.filter(p => p.health === "Healthy").length;
  const zones        = useMemo(() => new Set(providers.map(p => p.availabilityZone)).size, [providers]);

  if (network === "testnet") return <TestnetBanner />;

  // Full-viewport override
  return (
    <div style={{
      position:   "fixed",
      inset:      0,
      top:        60,
      display:    "flex",
      background: "#f3f4f6",
      overflow:   "hidden",
    }}>

      {/* ── LEFT SIDEBAR — light mode ── */}
      <div style={{
        width:         340,
        flexShrink:    0,
        background:    "#ffffff",
        borderRight:   "1px solid #e5e7eb",
        overflowY:     "auto",
        display:       "flex",
        flexDirection: "column",
        boxShadow:     "2px 0 8px rgba(0,0,0,0.04)",
        zIndex:        10,
      }}>
        {/* ── Header ── */}
        <div style={{ padding: "18px 20px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-mono)" }}>
                {provLoad ? "Loading…" : "Live"}
              </span>
            </div>
            {node && (
              <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "var(--font-mono)" }}>
                Block #{node.blockHeight.toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#111827", letterSpacing: -0.5 }}>
            Shelby Globe
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
            {config.label} · Storage provider network
          </div>
        </div>

        <div style={{ height: 1, background: "#f3f4f6" }} />

        {/* ── Provider summary — 2x2 grid ── */}
        <div style={{ padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 10 }}>
            Provider overview
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: "Total",   value: providers.length, color: "#2563eb" },
              { label: "Active",  value: activeCount,      color: "#059669" },
              { label: "Healthy", value: healthyCount,     color: "#7c3aed" },
              { label: "Regions", value: zones,            color: "#d97706" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                padding: "10px 12px",
                background: "#f9fafb",
                border: "1px solid #f0f0f0",
                borderRadius: 10,
                borderTop: `3px solid ${color}`,
              }}>
                <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "#f3f4f6" }} />

        {/* ── Network metrics — wider layout ── */}
        <div style={{ padding: "14px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 10 }}>
            Network metrics
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Total blobs",    value: fmt(stats.totalBlobs),            icon: "◈", color: "#2563eb" },
              { label: "Storage used",   value: fmtBytes(stats.totalStorageUsedBytes), icon: "▣", color: "#059669" },
              { label: "Blob events",    value: fmt(stats.totalBlobEvents),        icon: "↯", color: "#9333ea" },
              { label: "Slices",         value: fmt(stats.slices),                 icon: "⬡", color: "#d97706" },
              { label: "Pl. groups",     value: fmt(stats.placementGroups),        icon: "▦", color: "#0891b2" },
            ].map(({ label, value, icon, color }) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: "#f9fafb",
                border: "1px solid #f0f0f0",
                borderRadius: 8,
              }}>
                <span style={{ fontSize: 15, color, opacity: 0.8, flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: "#111827", marginTop: 1 }}>{value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "#f3f4f6" }} />

        {/* ── Provider list ── */}
        <div style={{ padding: "14px 20px", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af" }}>
              Storage providers
            </div>
            <button onClick={refresh} style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 11, color: "#6b7280", padding: "2px 6px",
              borderRadius: 5, fontFamily: "var(--font-mono)",
            }}>
              ⟳ Refresh
            </button>
          </div>

          {error && <div style={{ fontSize: 11, color: "#ef4444", marginBottom: 8 }}>⚠ {error}</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {providers.map(p => (
              <button
                key={p.address}
                onClick={() => setSelected(s => s?.address === p.address ? null : p)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderRadius: 8, width: "100%",
                  textAlign: "left", cursor: "pointer", transition: "all 0.12s",
                  background: selected?.address === p.address ? "#eff6ff" : "transparent",
                  border: `1px solid ${selected?.address === p.address ? "#bfdbfe" : "transparent"}`,
                }}
                onMouseEnter={e => { if (selected?.address !== p.address) e.currentTarget.style.background = "#f9fafb"; }}
                onMouseLeave={e => { if (selected?.address !== p.address) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: p.health === "Healthy" ? "#22c55e" : "#ef4444",
                  boxShadow: p.health === "Healthy" ? "0 0 4px #22c55e" : "none",
                }} />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, color: "#374151",
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.addressShort}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 600, color: "#9ca3af",
                  background: "#f3f4f6", padding: "1px 5px", borderRadius: 4,
                  flexShrink: 0,
                }}>
                  {ZONE_META[p.availabilityZone]?.shortLabel ?? p.availabilityZone.replace("dc_", "").toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Legend ── */}
        <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #f0f0f0" }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ca3af", marginBottom: 8 }}>Legend</div>
          {[
            { label: "Blob write: Client → SPs (erasure 10+6)", color: "#2563eb" },
            { label: "Parity chunk arc",                          color: "#93c5fd" },
            { label: "Capacity ring (active SP)",                 color: "#0ea5e9" },
            { label: "Hoàng Sa · Trường Sa — VN",                color: "#d97706" },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ width: 14, height: 2, background: color, borderRadius: 1, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: "#9ca3af" }}>{label}</span>
            </div>
          ))}
          <div style={{ marginTop: 8, fontSize: 9, color: "#d1d5db" }}>drag · scroll · click node</div>
        </div>
      </div>

      {/* ── RIGHT: Globe ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#f0f4f8" }}>
        <GlobeMap providers={providers} onProviderClick={setSelected} />
        {selected && (
          <ProviderPanel
            p={selected as any}
            accentColor={config.color}
            network={network}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}