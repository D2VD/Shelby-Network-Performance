"use client";
/**
 * components/provider-map.tsx — v6.0
 * Pure SVG flat map — không dùng react-simple-maps hay MapLibre (crash CF Pages)
 * Tọa độ Mercator projection hardcode cho viewBox 1000×520
 * Dark/Light theme · ZoomableGroup via CSS transform · Hover tooltip
 * Hoàng Sa + Trường Sa circles theo guide.txt (không animate)
 * SP nodes: <rect rx> theo guide.txt · animate-ping cho healthy
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// ── Mercator projection helper (viewBox 1000×520) ─────────────────────────────
const W = 1000, H = 520;

function lngLatToXY(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360 * W;
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = H / 2 - (mercN * W) / (2 * Math.PI);
  return [x, y];
}

// ── Zone definitions (lng, lat) ────────────────────────────────────────────────
const ZONES: Record<string, { lng: number; lat: number; label: string; short: string }> = {
  dc_us_west:   { lng: -121.89, lat:  37.34, label: "US West (San Jose)",   short: "US-W" },
  dc_us_east:   { lng:  -77.44, lat:  39.04, label: "US East (Virginia)",   short: "US-E" },
  dc_europe:    { lng:    8.68, lat:  50.11, label: "Europe (Frankfurt)",   short: "EU"   },
  dc_asia:      { lng:  103.82, lat:   1.35, label: "Asia (Singapore)",     short: "SG"   },
  dc_australia: { lng:  151.21, lat: -33.87, label: "Australia (Sydney)",   short: "AU"   },
};

// ── Vietnam sovereignty islands ────────────────────────────────────────────────
const HOANG_SA  = lngLatToXY(112.3, 16.5);
const TRUONG_SA = lngLatToXY(114.1, 10.4);

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:           "#060d1a",
    ocean:        "#060d1a",
    land:         "#0f2240",
    landStroke:   "#1a3a5c",
    islandStroke: "#38bdf8",
    arc:          "rgba(6,182,212,0.2)",
    arcFlow:      "#06b6d4",
    nodeBg:       "rgba(6,20,45,0.95)",
    nodeBorder:   "#06b6d4",
    nodeText:     "#fff",
    nodeSub:      "#64748b",
    ping:         "rgba(34,197,94,0.4)",
    tooltip:      { bg: "rgba(6,14,30,0.97)", border: "rgba(6,182,212,0.35)", text: "#e2e8f0", muted: "#64748b" },
  },
  light: {
    bg:           "#f0f7ff",
    ocean:        "#dbeafe",
    land:         "#d4e3f0",
    landStroke:   "#c0d4e8",
    islandStroke: "#0369a1",
    arc:          "rgba(37,99,235,0.15)",
    arcFlow:      "#2563eb",
    nodeBg:       "rgba(255,255,255,0.96)",
    nodeBorder:   "#2563eb",
    nodeText:     "#1e3a8a",
    nodeSub:      "#6b7280",
    ping:         "rgba(34,197,94,0.35)",
    tooltip:      { bg: "rgba(255,255,255,0.98)", border: "#e5e7eb", text: "#111827", muted: "#6b7280" },
  },
};
type Theme = keyof typeof THEMES;

// ── World land paths (equirectangular, viewBox 1000×520) ──────────────────────
// Simplified but accurate enough for a network map
const LAND_PATHS = [
  // North America
  "M82,75 L135,52 L172,44 L225,50 L265,58 L300,70 L328,92 L342,115 L336,138 L315,162 L288,185 L268,202 L240,218 L212,228 L192,242 L168,238 L148,218 L125,198 L108,178 L93,155 L86,128 Z",
  // Central America
  "M198,248 L222,242 L238,262 L233,288 L218,298 L203,282 Z",
  // South America
  "M232,292 L262,282 L292,292 L318,312 L338,352 L342,392 L328,435 L302,460 L272,455 L252,430 L232,395 L215,352 L212,308 Z",
  // Greenland
  "M318,26 L352,20 L382,28 L387,48 L362,60 L332,56 Z",
  // Iceland
  "M415,70 L432,65 L440,76 L428,86 L412,80 Z",
  // UK + Ireland
  "M447,106 L460,98 L470,110 L458,124 L445,116 Z",
  // Europe
  "M460,92 L508,72 L552,66 L592,73 L620,86 L612,108 L586,118 L555,128 L522,138 L496,146 L470,143 L456,128 L453,110 Z",
  // Scandinavia
  "M478,52 L508,38 L532,46 L542,68 L522,80 L496,76 L478,63 Z",
  // Iberian Peninsula
  "M445,130 L470,128 L480,145 L472,162 L452,165 L440,150 Z",
  // Africa
  "M448,172 L488,163 L532,166 L565,178 L580,202 L576,242 L562,282 L545,328 L522,365 L496,385 L470,365 L450,328 L432,282 L425,242 L428,208 Z",
  // Middle East
  "M577,143 L622,136 L655,143 L665,165 L645,182 L612,186 L586,176 Z",
  // Russia/Siberia
  "M540,40 L618,26 L718,23 L802,30 L852,43 L868,63 L838,78 L792,86 L738,90 L680,86 L625,80 L576,76 L546,63 Z",
  // Central Asia
  "M596,88 L665,80 L725,83 L745,103 L725,123 L685,130 L645,126 L609,116 Z",
  // India
  "M645,158 L685,153 L705,166 L708,193 L695,228 L675,250 L652,246 L635,223 L629,193 L635,168 Z",
  // SE Asia
  "M715,193 L752,186 L779,196 L793,216 L779,235 L755,242 L732,235 L715,215 Z",
  // China/East Asia
  "M690,86 L752,76 L809,83 L837,103 L835,130 L808,150 L775,160 L742,156 L712,146 L692,126 L690,106 Z",
  // Japan
  "M843,116 L856,110 L866,120 L860,133 L846,130 Z",
  // Korea
  "M815,126 L832,120 L838,136 L825,143 L815,136 Z",
  // Australia
  "M790,332 L842,312 L889,320 L917,342 L925,375 L912,408 L879,425 L842,422 L809,409 L788,382 L779,355 Z",
  // New Zealand
  "M932,407 L946,400 L952,416 L942,430 L929,422 Z",
  // Indonesia
  "M752,262 L790,255 L820,262 L832,278 L815,290 L782,285 L755,275 Z",
  // Philippines
  "M800,222 L818,215 L826,228 L818,242 L802,238 Z",
];

// ── Arc path between two points ────────────────────────────────────────────────
function arcPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.2 - 15;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

// ── Tooltip ────────────────────────────────────────────────────────────────────
interface TooltipState {
  p: StorageProvider;
  x: number;
  y: number;
}

function Tooltip({ data, theme }: { data: TooltipState; theme: Theme }) {
  const t = THEMES[theme].tooltip;
  const p = data.p;
  const isHealthy = p.health === "Healthy";

  return (
    <div style={{
      position: "absolute",
      left: Math.min(data.x + 14, W - 260),
      top: Math.max(data.y - 50, 8),
      background: t.bg, border: `1px solid ${t.border}`,
      borderRadius: 10, padding: "12px 14px", minWidth: 230, maxWidth: 280,
      pointerEvents: "none", backdropFilter: "blur(12px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)", zIndex: 50,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text, fontFamily: "monospace" }}>
            {p.addressShort}
          </div>
          <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>
            {ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, marginLeft: 8, flexShrink: 0,
          background: isHealthy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: isHealthy ? "#22c55e" : "#ef4444",
        }}>
          {p.health}
        </span>
      </div>

      {/* Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {[
          { label: "State",    value: p.state },
          p.geo?.city ? { label: "Location", value: `${p.geo.city}${p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}` } : null,
          p.capacityTiB != null ? { label: "Capacity", value: `${p.capacityTiB.toFixed(2)} TiB` } : null,
          p.netAddress ? { label: "Network", value: p.netAddress, mono: true } : null,
        ].filter(Boolean).map(r => r && (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 10, color: t.muted }}>{r.label}</span>
            <span style={{ fontSize: 10, color: t.text, fontFamily: r.mono ? "monospace" : "inherit", textAlign: "right", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.value}
            </span>
          </div>
        ))}

        {/* BLS key */}
        {(p.fullBlsKey || p.blsKey) && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 9, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>BLS Key</div>
            <div style={{ fontSize: 9, fontFamily: "monospace", color: t.muted, wordBreak: "break-all", lineHeight: 1.4, background: "rgba(128,128,128,0.08)", padding: "3px 6px", borderRadius: 4 }}>
              {(p.fullBlsKey || p.blsKey).slice(0, 48)}…
            </div>
          </div>
        )}

        {/* Full address */}
        {p.address && (
          <div style={{ marginTop: 3 }}>
            <div style={{ fontSize: 9, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Address</div>
            <div style={{ fontSize: 9, fontFamily: "monospace", color: t.muted, wordBreak: "break-all" }}>
              {p.address}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function ProviderMap({ providers, onProviderClick }: ProviderMapProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const t = THEMES[theme];

  // Group by zone (auto-handles new SPs from API)
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  // Zone XY positions
  const zoneXY = Object.fromEntries(
    Object.entries(ZONES).map(([k, v]) => [k, lngLatToXY(v.lng, v.lat)])
  );

  // Zone keys that have providers
  const activeZones = Array.from(byZone.keys()).filter(z => ZONES[z]);

  const handleMarkerHover = useCallback((p: StorageProvider, e: React.MouseEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const svgRect = svgRef.current?.viewBox.baseVal;
    if (!rect || !svgRect) return;
    const scaleX = rect.width / svgRect.width;
    const scaleY = rect.height / svgRect.height;
    const svgX = (e.clientX - rect.left) / scaleX;
    const svgY = (e.clientY - rect.top)  / scaleY;
    setTooltip({ p, x: svgX, y: svgY });
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: t.bg, overflow: "hidden" }}>
      <style>{`
        @keyframes sp-ping {
          0%   { opacity: 0.7; r: 10; }
          70%  { opacity: 0;   r: 22; }
          100% { opacity: 0;   r: 22; }
        }
        @keyframes arc-dash {
          to { stroke-dashoffset: -30; }
        }
      `}</style>

      {/* Controls */}
      <div style={{ position: "absolute", top: 10, right: 12, zIndex: 20, display: "flex", gap: 4 }}>
        {(["dark", "light"] as Theme[]).map(th => (
          <button key={th} onClick={() => setTheme(th)} style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
            border: `1px solid ${theme === th ? t.nodeBorder : "rgba(128,128,128,0.3)"}`,
            background: theme === th ? t.nodeBorder : "transparent",
            color: theme === th ? "#fff" : t.nodeSub, cursor: "pointer",
          }}>
            {th === "dark" ? "🌙" : "☀"} {th}
          </button>
        ))}
      </div>

      {/* SP count badge */}
      <div style={{
        position: "absolute", bottom: 10, left: 12, zIndex: 20,
        background: theme === "dark" ? "rgba(6,14,28,0.85)" : "rgba(255,255,255,0.9)",
        border: `1px solid ${theme === "dark" ? "rgba(6,182,212,0.3)" : "#e5e7eb"}`,
        borderRadius: 7, padding: "3px 12px", fontSize: 10, color: t.nodeSub,
        backdropFilter: "blur(6px)", display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
        {providers.filter(p => p.health === "Healthy").length}/{providers.length} healthy
      </div>

      {/* Vietnam sovereignty */}
      <div style={{
        position: "absolute", bottom: 10, right: 12, zIndex: 20,
        background: theme === "dark" ? "rgba(6,14,28,0.85)" : "rgba(255,255,255,0.9)",
        border: "1px solid rgba(217,119,6,0.4)",
        borderRadius: 7, padding: "3px 10px", fontSize: 9, color: "#92400e",
        backdropFilter: "blur(6px)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* SVG Map */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "100%", display: "block" }}
        xmlns="http://www.w3.org/2000/svg"
        onClick={() => setTooltip(null)}
      >
        {/* Ocean background */}
        <rect width={W} height={H} fill={t.ocean} />

        {/* Graticule (subtle grid) */}
        <g stroke={theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"} strokeWidth={0.5}>
          {[-60,-30,0,30,60].map(lat => {
            const [, y] = lngLatToXY(0, lat);
            return <line key={lat} x1={0} y1={y} x2={W} y2={y} />;
          })}
          {[-120,-60,0,60,120].map(lng => {
            const [x] = lngLatToXY(lng, 0);
            return <line key={lng} x1={x} y1={0} x2={x} y2={H} />;
          })}
        </g>

        {/* Equator */}
        {(() => { const [, y] = lngLatToXY(0, 0); return (
          <line x1={0} y1={y} x2={W} y2={y} stroke={theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"} strokeWidth={0.8} strokeDasharray="4 4" />
        ); })()}

        {/* Land masses */}
        <g fill={t.land} stroke={t.landStroke} strokeWidth={0.5}>
          {LAND_PATHS.map((d, i) => <path key={i} d={d} />)}
        </g>

        {/* ── Vietnam Sovereignty Markers ──────────────────────────────────── */}
        {/* Hoàng Sa — vòng tròn rỗng, KHÔNG animate (theo guide.txt) */}
        <circle cx={HOANG_SA[0]}  cy={HOANG_SA[1]}  r={4.5} fill="none" stroke={t.islandStroke} strokeWidth={0.7} opacity={0.9} />
        <circle cx={TRUONG_SA[0]} cy={TRUONG_SA[1]} r={4.5} fill="none" stroke={t.islandStroke} strokeWidth={0.7} opacity={0.9} />

        {/* ── Arc connections between active zones ──────────────────────────── */}
        {activeZones.flatMap((z1, i) =>
          activeZones.slice(i + 1).map(z2 => {
            const [x1, y1] = zoneXY[z1] ?? [0, 0];
            const [x2, y2] = zoneXY[z2] ?? [0, 0];
            return (
              <g key={`${z1}-${z2}`}>
                {/* Static dim arc */}
                <path d={arcPath(x1, y1, x2, y2)} fill="none" stroke={t.arc} strokeWidth={1} />
                {/* Animated flowing dash */}
                <path
                  d={arcPath(x1, y1, x2, y2)} fill="none"
                  stroke={t.arcFlow} strokeWidth={1.2} opacity={0.5}
                  strokeDasharray="8 22"
                  style={{ animation: "arc-dash 3s linear infinite" }}
                />
              </g>
            );
          })
        )}

        {/* ── SP Zone Markers (rect bo góc theo guide.txt) ───────────────────── */}
        {activeZones.map(zone => {
          const xy = zoneXY[zone];
          if (!xy) return null;
          const [x, y] = xy;
          const sps     = byZone.get(zone) ?? [];
          const healthy = sps.filter(p => p.health === "Healthy").length;
          const allOk   = healthy === sps.length && sps.length > 0;
          const mainSP  = sps.find(p => p.health === "Healthy") ?? sps[0];

          const rw = Math.max(26, 20 + sps.length * 2);
          const rh = 22;
          const borderColor = allOk ? "#22c55e" : healthy > 0 ? "#f59e0b" : "#ef4444";

          return (
            <g
              key={zone}
              style={{ cursor: "pointer" }}
              onClick={e => { e.stopPropagation(); mainSP && onProviderClick?.(mainSP); }}
              onMouseEnter={e => mainSP && handleMarkerHover(mainSP, e as any)}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Ping ring — animate CHỈ khi all healthy (theo guide: animate-ping) */}
              {allOk && (
                <circle cx={x} cy={y} r={10} fill="none" stroke={t.ping} strokeWidth={2}>
                  <animate attributeName="r" from="10" to="22" dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.7" to="0" dur="2.5s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Main rect bo góc (theo guide) */}
              <rect
                x={x - rw / 2} y={y - rh / 2}
                width={rw} height={rh} rx={6}
                fill={t.nodeBg}
                stroke={borderColor}
                strokeWidth={1.5}
              />

              {/* Count */}
              <text
                x={x} y={y + 1}
                textAnchor="middle" dominantBaseline="middle"
                fill={t.nodeText}
                fontSize={sps.length >= 10 ? 11 : 13}
                fontWeight={800}
                fontFamily="monospace"
                style={{ pointerEvents: "none" }}
              >
                {sps.length}
              </text>

              {/* Zone label */}
              <text
                x={x} y={y + rh / 2 + 12}
                textAnchor="middle"
                fill={t.nodeSub}
                fontSize={8} fontWeight={600} fontFamily="monospace"
                style={{ pointerEvents: "none" }}
              >
                {ZONE_META[zone]?.shortLabel ?? zone.replace("dc_", "").toUpperCase()}
              </text>

              {/* Health error dot */}
              {!allOk && (
                <circle cx={x + rw / 2 - 2} cy={y - rh / 2 + 2} r={4}
                  fill="#ef4444" stroke={theme === "dark" ? "#060d1a" : "#fff"} strokeWidth={1} />
              )}
            </g>
          );
        })}

        {/* ── Empty state (no providers yet) ────────────────────────────────── */}
        {providers.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle"
            fill={t.nodeSub} fontSize={13} fontFamily="monospace">
            Loading providers…
          </text>
        )}
      </svg>

      {/* Tooltip overlay */}
      {tooltip && <Tooltip data={tooltip} theme={theme} />}
    </div>
  );
}