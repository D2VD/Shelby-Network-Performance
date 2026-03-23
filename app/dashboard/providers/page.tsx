"use client";
// app/dashboard/providers/page.tsx v3.2
// THÊM: Testnet gate — hiện TestnetBanner thay vì globe trống
// (giữ nguyên toàn bộ logic v3.1, chỉ thêm network === "testnet" check)

import { useState, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useProviders } from "@/lib/use-providers";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

const GlobeMap = dynamic(() => import("@/components/map-wrapper"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d1117", color: "#4b5563", fontFamily: "var(--font-mono)", fontSize: 13, gap: 10, flexDirection: "column" }}>
      <style>{`@keyframes spin4{to{transform:rotate(360deg)}}`}</style>
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="14" stroke="#1f2937" strokeWidth="2"/>
        <circle cx="18" cy="18" r="14" stroke="#3b82f6" strokeWidth="2" strokeDasharray="22 66" strokeLinecap="round" style={{transformOrigin:"18px 18px",animation:"spin4 1.2s linear infinite"}}/>
      </svg>
      Loading globe…
    </div>
  ),
});

function Badge({ label, ok }: { label: string; ok: boolean }) {
  return <span className={`badge badge-${ok ? "green" : "red"}`}><span className="badge-dot"/>{label}</span>;
}

function GeoTag({ source }: { source?: string }) {
  const isGeo = source === "geo-ip";
  return <span className={`badge badge-${isGeo ? "blue" : "amber"}`} style={{ fontSize: 10 }}>{isGeo ? "Geo-IP" : "Zone est."}</span>;
}

function ProviderPanel({ p, accentColor, network, onClose }: { p: StorageProvider & { fullBlsKey?: string }; accentColor: string; network: string; onClose: () => void }) {
  return (
    <div style={{ position: "absolute", top: 16, right: 16, zIndex: 30, width: 300, background: "rgba(13,17,23,0.96)", backdropFilter: "blur(16px)", border: `1px solid ${accentColor}44`, borderRadius: 14, padding: "18px 20px", boxShadow: "0 16px 48px rgba(0,0,0,0.7)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 3 }}>Storage provider</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: accentColor }}>{p.addressShort}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: 20, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <Badge label={p.state} ok={p.state === "Active"}/>
        <Badge label={p.health} ok={p.health === "Healthy"}/>
        {p.geo && <GeoTag source={p.geo.source}/>}
      </div>
      {p.geo?.city && (
        <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
          <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Location</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#e5e7eb" }}>{[p.geo.city, p.geo.countryCode].filter(Boolean).join(", ")}</div>
          <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{p.geo.lat.toFixed(4)}°, {p.geo.lng.toFixed(4)}°</div>
        </div>
      )}
      {[
        { l: "Zone",     v: ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone },
        { l: "Capacity", v: p.capacityTiB ? `${p.capacityTiB.toFixed(2)} TiB` : "—" },
        { l: "Net IP",   v: p.netAddress || "—", mono: true },
      ].map(({ l, v, mono }) => (
        <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>{l}</span>
          <span style={{ fontFamily: mono ? "var(--font-mono)" : "inherit", fontSize: 11, color: "#9ca3af", maxWidth: "65%", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
        </div>
      ))}
      {p.blsKey && p.blsKey !== "—" && (
        <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
          <div style={{ fontSize: 8, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>BLS key</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#4b5563", wordBreak: "break-all", lineHeight: 1.5 }}>{p.fullBlsKey || p.blsKey}</div>
        </div>
      )}
      <div style={{ marginBottom: 12, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
        <div style={{ fontSize: 8, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Full address</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#4b5563", wordBreak: "break-all", lineHeight: 1.5 }}>{p.address}</div>
      </div>
      <a href={`https://explorer.aptoslabs.com/account/${p.address}?network=${network}`} target="_blank" rel="noreferrer"
        style={{ display: "block", textAlign: "center", padding: "8px 0", borderRadius: 8, fontSize: 11, background: `${accentColor}18`, border: `1px solid ${accentColor}33`, color: accentColor, textDecoration: "none", fontFamily: "var(--font-mono)" }}>
        View on Explorer ↗
      </a>
    </div>
  );
}

function RowWithTooltip({ p, accentColor, network, onClick }: { p: StorageProvider & { fullBlsKey?: string }; accentColor: string; network: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <tr
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseMove={handleMouseMove}
        style={{ cursor: "pointer" }}
      >
        <td><span className="mono" style={{ color: "var(--info)", fontSize: 12 }}>{p.addressShort}</span></td>
        <td style={{ fontSize: 12 }}>{p.geo?.city ? `${p.geo.city}, ${p.geo.countryCode}` : "—"}</td>
        <td><GeoTag source={p.geo?.source}/></td>
        <td><Badge label={p.state}  ok={p.state === "Active"}/></td>
        <td><Badge label={p.health} ok={p.health === "Healthy"}/></td>
        <td><span className="mono text-sm">{p.capacityTiB ? `${p.capacityTiB.toFixed(2)} TiB` : "—"}</span></td>
        <td><span className="mono text-sm text-muted" style={{ fontSize: 11 }}>{p.blsKey && p.blsKey !== "—" ? p.blsKey : "—"}</span></td>
        <td><span className="text-sm text-muted">{ZONE_META[p.availabilityZone]?.shortLabel ?? p.availabilityZone}</span></td>
      </tr>

      {hovered && (
        <tr style={{ height: 0, border: "none", padding: 0 }}>
          <td colSpan={8} style={{ padding: 0, border: "none", height: 0 }}>
            <div style={{ position: "fixed", left: pos.x + 18, top: pos.y - 10, zIndex: 9999, pointerEvents: "none", width: 260, background: "rgba(13,17,23,0.97)", backdropFilter: "blur(16px)", border: `1px solid ${accentColor}44`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 16px 40px rgba(0,0,0,0.55)" }}>
              <div style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Storage provider</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: accentColor, marginBottom: 10, wordBreak: "break-all" }}>{p.addressShort}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                <Badge label={p.state}  ok={p.state === "Active"}/>
                <Badge label={p.health} ok={p.health === "Healthy"}/>
                {p.geo && <GeoTag source={p.geo.source}/>}
              </div>
              {p.geo?.city && (
                <div style={{ marginBottom: 8, padding: "8px 10px", background: "rgba(255,255,255,0.05)", borderRadius: 7 }}>
                  <div style={{ fontSize: 8, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Location</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#e5e7eb" }}>{[p.geo.city, p.geo.countryCode].filter(Boolean).join(", ")}</div>
                  <div style={{ fontSize: 10, color: "#4b5563", marginTop: 1 }}>{p.geo.lat.toFixed(4)}°, {p.geo.lng.toFixed(4)}°</div>
                </div>
              )}
              {[
                { l: "Zone",     v: ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone },
                { l: "Capacity", v: p.capacityTiB ? `${p.capacityTiB.toFixed(2)} TiB` : "—" },
                { l: "Net IP",   v: p.netAddress || "—" },
              ].map(({ l, v }) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 9, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>{l}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#9ca3af", maxWidth: "58%", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
                </div>
              ))}
              {p.blsKey && p.blsKey !== "—" && (
                <div style={{ marginTop: 6, padding: "7px 9px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
                  <div style={{ fontSize: 8, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>BLS key</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#4b5563", wordBreak: "break-all", lineHeight: 1.5 }}>{p.fullBlsKey || p.blsKey}</div>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 9, color: "#4b5563", textAlign: "center" }}>Click to open detail panel</div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ProvidersPage() {
  const { network, config } = useNetwork();
  const { providers, loading, error, source, fetchedAt, refresh } = useProviders();
  const [selected,  setSelected]  = useState<StorageProvider | null>(null);
  const [showTable, setShowTable] = useState(true);

  const zones        = useMemo(() => { const m = new Map<string, number>(); providers.forEach(p => m.set(p.availabilityZone, (m.get(p.availabilityZone) ?? 0) + 1)); return m; }, [providers]);
  const activeCount  = providers.filter(p => p.state === "Active").length;
  const healthyCount = providers.filter(p => p.health === "Healthy").length;
  const geoCount     = providers.filter(p => p.geo?.source === "geo-ip").length;

  // ── Testnet gate ──────────────────────────────────────────────────────────
  if (network === "testnet") return <TestnetBanner />;

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="page-title">Globe view</h1>
          <p className="page-subtitle">
            {providers.length} storage providers on <strong>{config.label}</strong>
            {geoCount > 0 && ` · ${geoCount} Geo-IP resolved`}
            {fetchedAt && ` · ${new Date(fetchedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setShowTable(v => !v)} className="btn btn-secondary">{showTable ? "Hide table" : "Show table"}</button>
          <button onClick={refresh} className="btn btn-secondary">{loading ? "⟳ Loading…" : "⟳ Refresh"}</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {error}</div>}

      {providers.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { l: "Total",   v: providers.length, color: "var(--info)"    },
            { l: "Active",  v: activeCount,       color: "var(--success)" },
            { l: "Healthy", v: healthyCount,      color: "#9333ea"        },
            { l: "Regions", v: zones.size,        color: "#d97706"        },
          ].map(({ l, v, color }) => (
            <div key={l} className="stat-card" style={{ borderTop: `3px solid ${color}`, padding: "12px 16px" }}>
              <div className="stat-card-label">{l}</div>
              <div className="stat-card-value" style={{ fontSize: 22, color }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--gray-400)" }}>Data source:</span>
          <span className={`badge badge-${source === "kv-geo" ? "blue" : source === "indexer" ? "green" : "gray"}`}>
            {source === "kv-geo" ? "KV + Geo-IP" : source === "indexer" ? "Indexer" : source === "rpc" ? "RPC on-chain" : "Unknown"}
          </span>
          {source !== "kv-geo" && <span style={{ fontSize: 11, color: "var(--gray-400)" }}>— coordinates are zone estimates (run Worker to get precise geo)</span>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
        <div style={{ position: "relative", height: 460 }}>
          <GlobeMap providers={providers} onProviderClick={setSelected}/>
          {selected && (
            <ProviderPanel p={selected as any} accentColor={config.color} network={network} onClose={() => setSelected(null)}/>
          )}
        </div>
      </div>

      {showTable && providers.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Provider directory</div>
            <span className="text-sm text-muted">{providers.length} nodes</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Address</th><th>Location</th><th>Source</th>
                  <th>State</th><th>Health</th><th>Capacity</th>
                  <th>BLS key</th><th>Zone</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(p => (
                  <RowWithTooltip
                    key={p.address}
                    p={p as any}
                    accentColor={config.color}
                    network={network}
                    onClick={() => setSelected(p)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
