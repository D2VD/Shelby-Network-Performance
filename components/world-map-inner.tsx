"use client";
// components/world-map-inner.tsx
// Inner component dùng react-simple-maps — chỉ render client-side
// Import file này qua dynamic() + ssr:false trong provider-map.tsx

import { useState, useRef, useCallback, useEffect } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from "react-simple-maps";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";
import { useTheme } from "./theme-context";

// TopoJSON world map — hosted on CDN, không bundle vào app
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const ZONES: Record<string, { lng: number; lat: number; label: string; short: string; flag: string }> = {
  dc_us_west:   { lng: -121.89, lat: 37.34,  label: "US West (San Jose)", short: "US-W", flag: "🇺🇸" },
  dc_us_east:   { lng: -77.44,  lat: 39.04,  label: "US East (Virginia)", short: "US-E", flag: "🇺🇸" },
  dc_europe:    { lng: 8.68,    lat: 50.11,  label: "Europe (Frankfurt)", short: "EU",   flag: "🇩🇪" },
  dc_asia:      { lng: 103.82,  lat: 1.35,   label: "Asia (Singapore)",   short: "SG",   flag: "🇸🇬" },
  dc_australia: { lng: 151.21,  lat: -33.87, label: "Australia (Sydney)", short: "AU",   flag: "🇦🇺" },
};

const ZONE_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444"];

// ── GeoShare donut ────────────────────────────────────────────────────────────
function GeoShare({ byZone, isDark }: { byZone: Map<string, StorageProvider[]>; isDark: boolean }) {
  const total  = Array.from(byZone.values()).reduce((s, a) => s + a.length, 0);
  const entries = Array.from(byZone.entries()).map(([z, sps], i) => ({
    zone: z, label: ZONES[z]?.label ?? z, flag: ZONES[z]?.flag ?? "🌐",
    count: sps.length, healthy: sps.filter(p => p.health === "Healthy").length,
    pct: total > 0 ? sps.length / total * 100 : 0,
    color: ZONE_COLORS[i % ZONE_COLORS.length],
  })).sort((a, b) => b.count - a.count);

  const R = 42, cx = 54, cy = 54, stroke = 16, circ = 2 * Math.PI * R;
  let off = 0;
  const allH = Array.from(byZone.values()).flat().filter(p => p.health === "Healthy").length;

  const bg  = isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.97)";
  const bdr = isDark ? "rgba(56,189,248,0.2)" : "#e2e8f0";
  const pt  = isDark ? "#e2e8f0" : "#111827";
  const pm  = isDark ? "#94a3b8" : "#6b7280";

  return (
    <div style={{ background: bg, border: `1px solid ${bdr}`, borderRadius: 14, padding: "14px 16px", width: 285, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: pt, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 1 }}>Geographic & Provider Share</div>
      <div style={{ fontSize: 10, color: pm, marginBottom: 12 }}>Compare zone distribution</div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
        <svg width={108} height={108} viewBox="0 0 108 108" style={{ flexShrink: 0 }}>
          {entries.map(e => {
            const dash = e.pct / 100 * circ, gap = circ - dash;
            const seg = <circle key={e.zone} cx={cx} cy={cy} r={R} fill="none" stroke={e.color} strokeWidth={stroke} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} opacity={0.88} />;
            off += dash; return seg;
          })}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={15} fontWeight={800} fill={pt}>{total}</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9} fill={pm}>SPs</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          {entries.map(e => (
            <div key={e.zone} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: e.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: pt, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.flag} {e.label.split("(")[0].trim()}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: pt, fontFamily: "monospace", flexShrink: 0 }}>{e.count} <span style={{ color: pm, fontWeight: 400 }}>· {e.pct.toFixed(0)}%</span></span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", paddingTop: 9, borderTop: `1px solid ${bdr}` }}>
        {[{ label: "ZONES", value: String(entries.length) }, { label: "TOTAL", value: String(total) }, { label: "HEALTHY", value: String(allH) }].map(({ label, value }, i) => (
          <div key={label} style={{ flex: 1, textAlign: "center", borderRight: i < 2 ? `1px solid ${bdr}` : "none" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: pt, fontFamily: "monospace" }}>{value}</div>
            <div style={{ fontSize: 9, color: pm, letterSpacing: "0.06em" }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cluster popup (hover) ──────────────────────────────────────────────────────
function ClusterPopup({ zone, sps, x, y, pinned, onClose, isDark }: {
  zone: string; sps: StorageProvider[]; x: number; y: number;
  pinned: boolean; onClose: () => void; isDark: boolean;
}) {
  const [cp, setCp] = useState<string | null>(null);
  const meta = ZONES[zone];
  const bg  = isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.98)";
  const bdr = isDark ? "rgba(56,189,248,0.25)" : "#e2e8f0";
  const pt  = isDark ? "#e2e8f0" : "#111827";
  const pm  = isDark ? "#94a3b8" : "#6b7280";

  // Clamp so popup stays inside viewport
  const tipW = 340;
  const style: React.CSSProperties = {
    position: "absolute",
    left: Math.min(x + 12, typeof window !== "undefined" ? window.innerWidth - tipW - 16 : x + 12),
    top: Math.max(8, y - 20),
    zIndex: 100, width: tipW, maxHeight: 480,
    background: bg, border: `1px solid ${bdr}`, borderRadius: 14,
    padding: "15px 17px", boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
    display: "flex", flexDirection: "column",
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    pointerEvents: pinned ? "auto" : "none",
  };

  return (
    <div style={style}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: pt }}>{meta?.flag} {meta?.label ?? zone}</div>
          <div style={{ fontSize: 11, color: pm, marginTop: 2 }}>
            {sps.filter(p => p.health === "Healthy").length}/{sps.length} healthy
            {!pinned && <span style={{ marginLeft: 8, opacity: .6 }}>· Click to pin</span>}
          </div>
        </div>
        {pinned && <button onClick={onClose} style={{ background: "none", border: "none", color: pm, cursor: "pointer", fontSize: 20, lineHeight: 1, pointerEvents: "auto" }}>×</button>}
      </div>
      <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {sps.map((p, i) => {
          const isH = p.health === "Healthy", bls = p.fullBlsKey || p.blsKey || "";
          return (
            <div key={p.address || i} style={{ background: isH ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)", border: `1px solid ${isH ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: 9, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: pt, fontFamily: "monospace" }}>{p.addressShort}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: isH ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: isH ? "#22c55e" : "#ef4444" }}>{p.health}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>{p.state}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px", marginBottom: bls ? 6 : 0 }}>
                {p.capacityTiB != null && <div><div style={{ fontSize: 9, color: pm, textTransform: "uppercase" }}>Capacity</div><div style={{ fontSize: 11, color: pt, fontWeight: 500 }}>{p.capacityTiB.toFixed(1)} TiB</div></div>}
                {p.geo?.city && <div><div style={{ fontSize: 9, color: pm, textTransform: "uppercase" }}>City</div><div style={{ fontSize: 11, color: pt, fontWeight: 500 }}>{p.geo.city}, {p.geo.countryCode}</div></div>}
                {p.netAddress && <div><div style={{ fontSize: 9, color: pm, textTransform: "uppercase" }}>Net IP</div><div style={{ fontSize: 10, color: pt, fontFamily: "monospace" }}>{p.netAddress}</div></div>}
              </div>
              {bls && (
                <div style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(128,128,128,0.07)", borderRadius: 4, padding: "3px 6px" }}>
                  <span style={{ fontSize: 9, color: pm, flexShrink: 0 }}>BLS</span>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: pt, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bls.slice(0, 30)}…</span>
                  {pinned && (
                    <button onClick={async () => { await navigator.clipboard.writeText(bls).catch(() => {}); setCp(p.address); setTimeout(() => setCp(null), 1500); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: cp === p.address ? "#22c55e" : pm, pointerEvents: "auto" }}>
                      {cp === p.address ? "✓" : "⧉"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main WorldMapInner ────────────────────────────────────────────────────────
interface WorldMapInnerProps {
  providers: StorageProvider[];
}

export default function WorldMapInner({ providers }: WorldMapInnerProps) {
  const { isDark } = useTheme();

  const [hoverZone,  setHoverZone]  = useState<string | null>(null);
  const [pinnedZone, setPinnedZone] = useState<string | null>(null);
  const [hoverPos,   setHoverPos]   = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group providers by zone
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  const azones = Array.from(byZone.keys()).filter(z => ZONES[z]);

  // Theme colors — hình 4 style (muted earth tones, clean)
  const oceanColor = isDark ? "#0d1526" : "#c5d8f0";
  const landColor  = isDark ? "#1e3a5f" : "#d4a574";  // terra cotta on blue ocean
  const borderColor = isDark ? "#0d1526" : "#c5d8f0";

  const handleZoneEnter = useCallback((zone: string, e: React.MouseEvent) => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHoverZone(zone);
  }, []);

  const handleZoneLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => {
      if (!pinnedZone) setHoverZone(null);
    }, 200);
  }, [pinnedZone]);

  const activeZone = pinnedZone ?? hoverZone;

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: oceanColor, overflow: "hidden" }}>

      {/* React-Simple-Maps world map */}
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 155, center: [15, 5] }}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill={landColor}
                stroke={borderColor}
                strokeWidth={0.4}
                style={{
                  default:  { outline: "none" },
                  hover:    { outline: "none", fill: isDark ? "#2d5282" : "#c49060" },
                  pressed:  { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {/* Connection arcs between zones */}
        {azones.flatMap((z1, i) =>
          azones.slice(i + 1).map(z2 => {
            const p1 = ZONES[z1], p2 = ZONES[z2];
            return (
              <Line
                key={`${z1}-${z2}`}
                from={[p1.lng, p1.lat]}
                to={[p2.lng, p2.lat]}
                stroke={isDark ? "rgba(56,189,248,0.25)" : "rgba(37,99,235,0.2)"}
                strokeWidth={0.8}
                strokeLinecap="round"
              />
            );
          })
        )}

        {/* Zone cluster markers */}
        {azones.map((zone, zi) => {
          const zd = ZONES[zone];
          const sps = byZone.get(zone) ?? [];
          const healthy = sps.filter(p => p.health === "Healthy").length;
          const allOk = healthy === sps.length && sps.length > 0;
          const color = ZONE_COLORS[zi % ZONE_COLORS.length];
          const isActive = activeZone === zone;

          return (
            <Marker key={zone} coordinates={[zd.lng, zd.lat]}>
              <g
                style={{ cursor: "pointer" }}
                onMouseEnter={e => handleZoneEnter(zone, e as any)}
                onMouseLeave={handleZoneLeave}
                onClick={e => {
                  e.stopPropagation();
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) setHoverPos({ x: (e as any).clientX - rect.left, y: (e as any).clientY - rect.top });
                  setPinnedZone(z => z === zone ? null : zone);
                  setHoverZone(zone);
                }}
              >
                {/* Pulse ring for active zones */}
                {isActive && (
                  <circle r={18} fill={color} fillOpacity={0.15} style={{ animation: "map-pulse 2s ease-out infinite" }} />
                )}
                {/* Cluster bubble */}
                <circle
                  r={14}
                  fill={allOk ? (isDark ? "#1e3a5f" : "#1e40af") : "#7f1d1d"}
                  stroke={allOk ? (isDark ? "#38bdf8" : "#3b82f6") : "#ef4444"}
                  strokeWidth={isActive ? 2.5 : 1.5}
                  fillOpacity={0.92}
                />
                {/* SP count */}
                <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={800} fill="#fff" fontFamily="monospace" style={{ pointerEvents: "none" }}>
                  {sps.length}
                </text>
                {/* Zone label below */}
                <text textAnchor="middle" dy={22} fontSize={8} fill={isDark ? "#94a3b8" : "#475569"} fontFamily="monospace" style={{ pointerEvents: "none" }}>
                  {zd.short}
                </text>
                {/* Unhealthy indicator */}
                {!allOk && <circle cx={10} cy={-10} r={4} fill="#ef4444" stroke={isDark ? "#0d1526" : "#fff"} strokeWidth={1} />}
              </g>
            </Marker>
          );
        })}
      </ComposableMap>

      <style>{`
        @keyframes map-pulse {
          0%   { opacity: 0.7; transform: scale(1); }
          70%  { opacity: 0;   transform: scale(2.2); }
          100% { opacity: 0;   transform: scale(2.2); }
        }
      `}</style>

      {/* Bottom hints */}
      <div style={{ position: "absolute", bottom: 10, left: 300, zIndex: 10, fontSize: 9, color: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.3)", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
        {providers.filter(p => p.health === "Healthy").length}/{providers.length} · Hover=inspect · Click=pin
      </div>
      <div style={{ position: "absolute", bottom: 10, right: 12, zIndex: 10, fontSize: 9, color: "rgba(217,119,6,0.85)", fontFamily: "monospace" }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Cluster hover popup */}
      {activeZone && byZone.has(activeZone) && (
        <ClusterPopup
          zone={activeZone}
          sps={byZone.get(activeZone)!}
          x={hoverPos.x}
          y={hoverPos.y}
          pinned={pinnedZone === activeZone}
          onClose={() => { setPinnedZone(null); setHoverZone(null); }}
          isDark={isDark}
        />
      )}

      {/* GeoShare panel */}
      {providers.length > 0 && (
        <div style={{ position: "absolute", top: 10, left: 12, zIndex: 25 }}>
          <GeoShare byZone={byZone} isDark={isDark} />
        </div>
      )}
    </div>
  );
}