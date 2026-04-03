"use client";
/**
 * components/provider-map.tsx — v3.0
 * Flat world map với SP cluster bubbles (thay thế globe).
 * Style: light mode, dark map tiles, cluster badges số lượng.
 * Reference: dạng như Solana Beach / Celestia explorer map.
 */

import { useState, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// ── Zone config: tọa độ % trên SVG viewBox 1000×500 ───────────────────────────
const ZONES: Record<string, {
  label:     string;
  shortLabel:string;
  x:         number; // % of 1000
  y:         number; // % of 500
  color:     string;
}> = {
  dc_us_west:   { label: "US West (San Jose)",   shortLabel: "US-W", x: 130, y: 180, color: "#6366f1" },
  dc_us_east:   { label: "US East (Virginia)",   shortLabel: "US-E", x: 245, y: 170, color: "#8b5cf6" },
  dc_europe:    { label: "Europe (Frankfurt)",   shortLabel: "EU",   x: 498, y: 130, color: "#2563eb" },
  dc_asia:      { label: "Asia (Singapore)",     shortLabel: "SG",   x: 772, y: 270, color: "#0891b2" },
  dc_australia: { label: "Australia (Sydney)",   shortLabel: "AU",   x: 862, y: 385, color: "#059669" },
};

// ── World map SVG path (simplified equirectangular, viewBox 1000×500) ─────────
const WORLD_PATHS = {
  northAmerica: `M 95,85 L 145,55 L 175,45 L 235,52 L 270,60 L 305,68 L 330,90 L 345,110 
    L 340,135 L 320,160 L 295,185 L 275,205 L 245,220 L 215,230 L 195,245 
    L 170,240 L 150,220 L 125,200 L 108,180 L 95,155 L 88,130 Z`,
  centralAmerica: `M 200,250 L 225,245 L 240,265 L 235,290 L 220,300 L 205,285 Z`,
  southAmerica: `M 235,295 L 265,285 L 295,295 L 320,315 L 340,355 L 345,395 
    L 330,440 L 305,465 L 275,460 L 255,435 L 235,400 L 218,355 L 215,310 Z`,
  greenland: `M 320,28 L 355,22 L 385,30 L 390,50 L 365,62 L 335,58 Z`,
  uk: `M 450,108 L 462,100 L 470,112 L 458,125 L 448,118 Z`,
  europe: `M 462,95 L 510,75 L 555,68 L 595,75 L 622,88 L 615,108 L 588,118 
    L 558,128 L 525,138 L 498,148 L 472,145 L 458,130 L 455,112 Z`,
  scandanavia: `M 480,55 L 510,40 L 535,48 L 545,70 L 525,82 L 498,78 L 480,65 Z`,
  africa: `M 450,175 L 490,165 L 535,168 L 568,180 L 582,205 L 578,245 
    L 565,285 L 548,330 L 525,368 L 498,388 L 472,368 L 452,330 
    L 435,285 L 428,245 L 432,210 Z`,
  middleEast: `M 580,145 L 625,138 L 658,145 L 668,168 L 648,185 L 615,188 L 588,178 Z`,
  russia: `M 542,42 L 620,28 L 720,25 L 805,32 L 855,45 L 870,65 L 840,80 
    L 795,88 L 740,92 L 682,88 L 628,82 L 578,78 L 548,65 Z`,
  centralAsia: `M 598,90 L 668,82 L 728,85 L 748,105 L 728,125 L 688,132 L 648,128 L 612,118 Z`,
  india: `M 648,160 L 688,155 L 708,168 L 712,195 L 698,230 L 678,252 L 655,248 
    L 638,225 L 632,195 L 638,170 Z`,
  seAsia: `M 718,195 L 755,188 L 782,198 L 795,218 L 782,238 L 758,245 L 735,238 L 718,218 Z`,
  china: `M 692,88 L 755,78 L 812,85 L 840,105 L 838,132 L 812,152 L 778,162 
    L 745,158 L 715,148 L 695,128 L 692,108 Z`,
  japan: `M 845,118 L 858,112 L 868,122 L 862,135 L 848,132 Z`,
  korea: `M 818,128 L 835,122 L 840,138 L 828,145 L 818,138 Z`,
  australia: `M 792,335 L 845,315 L 892,322 L 920,345 L 928,378 L 915,412 
    L 882,428 L 845,425 L 812,412 L 792,385 L 782,358 Z`,
  newZealand: `M 935,410 L 948,402 L 955,418 L 945,432 L 932,425 Z`,
};

// ── Dashed arc giữa các zones ──────────────────────────────────────────────────
function arcPath(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.18;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

// ── Cluster Tooltip ────────────────────────────────────────────────────────────
function ClusterTooltip({
  zone, providers, x, y, onClose,
}: {
  zone:      string;
  providers: StorageProvider[];
  x:         number;
  y:         number;
  onClose:   () => void;
}) {
  const meta = ZONES[zone];
  return (
    <div style={{
      position:  "absolute",
      left:      Math.min(x + 20, 520),
      top:       Math.max(y - 20, 8),
      zIndex:    100,
      background:"#fff",
      border:    "1px solid #e5e7eb",
      borderRadius: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      minWidth:  240,
      maxWidth:  280,
      overflow:  "hidden",
    }}>
      {/* Header */}
      <div style={{
        background: "#f8fafc",
        borderBottom: "1px solid #f0f0f0",
        padding: "10px 14px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
            {meta?.label ?? zone}
          </div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
            {providers.length} storage provider{providers.length > 1 ? "s" : ""}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 14, color: "#9ca3af", padding: "2px 6px", borderRadius: 4,
          lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Provider list */}
      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        {providers.map((p, i) => (
          <div key={p.address} style={{
            padding: "9px 14px",
            borderBottom: i < providers.length - 1 ? "1px solid #f5f5f5" : "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            {/* Status dot */}
            <div style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: p.health === "Healthy" ? "#22c55e" : "#ef4444",
              boxShadow: p.health === "Healthy" ? "0 0 6px #22c55e66" : "none",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: "#111827",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: "var(--font-mono, monospace)",
              }}>
                {p.addressShort}
              </div>
              {p.geo?.city && (
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                  {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
                </div>
              )}
            </div>
            <div style={{
              fontSize: 9, fontWeight: 600, padding: "2px 7px",
              borderRadius: 5,
              background: p.health === "Healthy" ? "#f0fdf4" : "#fef2f2",
              color: p.health === "Healthy" ? "#16a34a" : "#dc2626",
            }}>
              {p.health === "Healthy" ? "OK" : "ERR"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function ProviderMap({ providers, onProviderClick }: ProviderMapProps) {
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [tooltipPos,  setTooltipPos] = useState({ x: 0, y: 0 });

  // Group providers by zone
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  const zoneKeys = Array.from(byZone.keys()).filter(z => ZONES[z]);

  const handleClusterClick = useCallback((zone: string, svgX: number, svgY: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget.closest("svg")?.parentElement as HTMLElement)?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = rect.width / 1000;
    const scaleY = rect.height / 500;
    setTooltipPos({ x: svgX * scaleX, y: svgY * scaleY });
    setActiveZone(z => z === zone ? null : zone);
  }, []);

  return (
    <div
      style={{ position: "relative", width: "100%", userSelect: "none" }}
      onClick={() => setActiveZone(null)}
    >
      <svg
        viewBox="0 0 1000 500"
        style={{ width: "100%", height: "auto", display: "block" }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Ocean gradient */}
          <linearGradient id="ocean-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f0f7ff" />
            <stop offset="100%" stopColor="#e8f4fd" />
          </linearGradient>
          {/* Glow filter for active cluster */}
          <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
          </filter>
        </defs>

        {/* Ocean background */}
        <rect x="0" y="0" width="1000" height="500" fill="url(#ocean-grad)" rx="0" />

        {/* Subtle grid lines */}
        {[0, 125, 250, 375, 500, 625, 750, 875, 1000].map(x => (
          <line key={`vg${x}`} x1={x} y1="0" x2={x} y2="500"
            stroke="#c5dff0" strokeWidth="0.5" opacity="0.4" />
        ))}
        {[0, 100, 200, 300, 400, 500].map(y => (
          <line key={`hg${y}`} x1="0" y1={y} x2="1000" y2={y}
            stroke="#c5dff0" strokeWidth="0.5" opacity="0.4" />
        ))}

        {/* Equator */}
        <line x1="0" y1="250" x2="1000" y2="250"
          stroke="#b5d4e8" strokeWidth="0.8" strokeDasharray="6 4" opacity="0.6" />
        <text x="8" y="246" fontSize="7" fill="#94a3b8" fontFamily="monospace">0°</text>

        {/* World map land masses */}
        <g fill="#d4e3f0" stroke="#c0d4e8" strokeWidth="0.6">
          {Object.values(WORLD_PATHS).map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>

        {/* Vietnam sovereignty markers */}
        <g>
          <circle cx="766" cy="238" r="2.5" fill="#d97706" />
          <circle cx="771" cy="256" r="2.5" fill="#d97706" />
          <text x="776" y="242" fontSize="7" fill="#92400e" fontFamily="monospace" fontWeight="600">
            Hoàng Sa (VN)
          </text>
          <text x="776" y="260" fontSize="7" fill="#92400e" fontFamily="monospace" fontWeight="600">
            Trường Sa (VN)
          </text>
        </g>

        {/* Arcs between zones (dashed connection lines) */}
        {zoneKeys.map((z1, i) =>
          zoneKeys.slice(i + 1).map((z2) => {
            const a = ZONES[z1], b = ZONES[z2];
            if (!a || !b) return null;
            return (
              <path
                key={`arc-${z1}-${z2}`}
                d={arcPath(a.x, a.y, b.x, b.y)}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1"
                strokeDasharray="4 5"
                opacity="0.35"
              />
            );
          })
        )}

        {/* Zone cluster bubbles */}
        {zoneKeys.map(zone => {
          const meta    = ZONES[zone];
          const sps     = byZone.get(zone) ?? [];
          const healthy = sps.filter(p => p.health === "Healthy").length;
          const isActive = activeZone === zone;
          const allHealthy = healthy === sps.length;
          const color = meta.color;

          // Bubble size: base 22px + 2px per SP
          const r = Math.min(22 + sps.length * 1.5, 34);

          return (
            <g
              key={zone}
              onClick={e => handleClusterClick(zone, meta.x, meta.y, e)}
              style={{ cursor: "pointer" }}
              filter={isActive ? "url(#glow)" : undefined}
            >
              {/* Pulse ring */}
              {allHealthy && (
                <circle
                  cx={meta.x} cy={meta.y} r={r + 6}
                  fill="none" stroke={color} strokeWidth="1.5" opacity="0.3"
                  style={{ animation: "pulse-ring 2s ease-out infinite" }}
                />
              )}

              {/* Outer ring */}
              <circle
                cx={meta.x} cy={meta.y} r={r + 2}
                fill="none" stroke={color} strokeWidth={isActive ? 2 : 1}
                opacity={isActive ? 0.8 : 0.4}
              />

              {/* Main bubble */}
              <circle
                cx={meta.x} cy={meta.y} r={r}
                fill={isActive ? color : "#fff"}
                stroke={color}
                strokeWidth={isActive ? 0 : 1.5}
                filter="url(#drop-shadow)"
                opacity={isActive ? 0.9 : 1}
              />

              {/* Count badge */}
              <text
                x={meta.x} y={meta.y + 1}
                textAnchor="middle" dominantBaseline="central"
                fontSize={sps.length >= 10 ? 13 : 15}
                fontWeight="700"
                fontFamily="system-ui, sans-serif"
                fill={isActive ? "#fff" : color}
              >
                {sps.length}
              </text>

              {/* Zone label */}
              <text
                x={meta.x} y={meta.y + r + 12}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fontFamily="monospace"
                fill="#64748b"
                letterSpacing="0.05em"
              >
                {meta.shortLabel}
              </text>

              {/* Health indicator dot */}
              {!allHealthy && (
                <circle
                  cx={meta.x + r - 2} cy={meta.y - r + 2} r="5"
                  fill="#ef4444"
                  stroke="#fff"
                  strokeWidth="1.5"
                />
              )}
            </g>
          );
        })}

        {/* Total SPs badge - bottom right */}
        {providers.length > 0 && (
          <g>
            <rect x="928" y="472" width="68" height="22" rx="6" fill="#fff" stroke="#e5e7eb" strokeWidth="1" />
            <text x="962" y="487" textAnchor="middle" fontSize="9" fontFamily="monospace" fill="#6b7280">
              {providers.length} SPs online
            </text>
          </g>
        )}

        <style>{`
          @keyframes pulse-ring {
            0%   { r: ${28}; opacity: 0.4; }
            100% { r: ${38}; opacity: 0; }
          }
        `}</style>
      </svg>

      {/* Cluster tooltip (rendered outside SVG for proper HTML rendering) */}
      {activeZone && byZone.has(activeZone) && (
        <ClusterTooltip
          zone={activeZone}
          providers={byZone.get(activeZone)!}
          x={tooltipPos.x}
          y={tooltipPos.y}
          onClose={() => setActiveZone(null)}
        />
      )}
    </div>
  );
}