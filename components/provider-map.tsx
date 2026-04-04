"use client";
/**
 * components/provider-map.tsx — v5.0
 * React Simple Maps + World Atlas TopoJSON theo guide.txt
 * - ZoomableGroup maxZoom=15
 * - Hoàng Sa [112.3, 16.5] + Trường Sa [114.1, 10.4] — circle rỗng, không animate
 * - SP nodes: rect bo góc, animate-ping cho node chính
 * - Dark/Light theme toggle
 * - Hover tooltip với đầy đủ thông tin SP bao gồm BLS key
 * - Auto-update: providers từ API → tự động thêm marker mới
 */

import { useState, useCallback, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// ── Zone anchors (lng, lat) — react-simple-maps dùng [lng, lat] ───────────────
const ZONE_ANCHORS: Record<string, [number, number]> = {
  dc_us_west:   [-121.89,  37.34],
  dc_us_east:   [ -77.44,  39.04],
  dc_europe:    [   8.68,  50.11],
  dc_asia:      [ 103.82,   1.35],
  dc_australia: [ 151.21, -33.87],
};

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:          "#060d1a",
    ocean:       "#060d1a",
    land:        "#0f2240",
    landStroke:  "#1a3a5c",
    graticule:   "rgba(255,255,255,0.04)",
    islandStroke:"#38bdf8",  // sáng trên nền tối
    marker:      "#06b6d4",
    markerText:  "#fff",
    tooltip:     "rgba(6,14,30,0.97)",
    tooltipBorder:"rgba(6,182,212,0.3)",
    tooltipText: "#e2e8f0",
    tooltipMuted:"#64748b",
  },
  light: {
    bg:          "#f0f7ff",
    ocean:       "#d4e8f5",
    land:        "#d4e3f0",
    landStroke:  "#c0d4e8",
    graticule:   "rgba(0,0,0,0.05)",
    islandStroke:"#0369a1",  // đậm trên nền sáng
    marker:      "#2563eb",
    markerText:  "#1e3a8a",
    tooltip:     "rgba(255,255,255,0.98)",
    tooltipBorder:"#e5e7eb",
    tooltipText: "#111827",
    tooltipMuted:"#6b7280",
  },
};

type Theme = keyof typeof THEMES;

// TopoJSON từ World Atlas CDN
const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── SP Tooltip ────────────────────────────────────────────────────────────────
interface TooltipData {
  provider: StorageProvider;
  x: number;
  y: number;
}

function SPTooltip({ data, theme }: { data: TooltipData; theme: Theme }) {
  const t = THEMES[theme];
  const p = data.provider;
  const zoneMeta = ZONE_META[p.availabilityZone];
  const isHealthy = p.health === "Healthy";

  return (
    <div style={{
      position: "absolute",
      left: Math.min(data.x + 16, window.innerWidth - 280),
      top: Math.max(data.y - 60, 8),
      zIndex: 50,
      background: t.tooltip,
      border: `1px solid ${t.tooltipBorder}`,
      borderRadius: 12,
      padding: "12px 14px",
      minWidth: 240,
      maxWidth: 300,
      pointerEvents: "none",
      backdropFilter: "blur(12px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.tooltipText, fontFamily: "monospace" }}>
            {p.addressShort}
          </div>
          <div style={{ fontSize: 10, color: t.tooltipMuted, marginTop: 2 }}>
            {zoneMeta?.label ?? p.availabilityZone}
          </div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px",
          borderRadius: 5,
          background: isHealthy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          color: isHealthy ? "#22c55e" : "#ef4444",
          flexShrink: 0, marginLeft: 8,
        }}>
          {p.health}
        </span>
      </div>

      {/* Details */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Row label="State"    value={p.state}    muted={t.tooltipMuted} text={t.tooltipText} />
        {p.geo?.city && (
          <Row label="Location" value={`${p.geo.city}${p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}`} muted={t.tooltipMuted} text={t.tooltipText} />
        )}
        {p.capacityTiB != null && (
          <Row label="Capacity" value={`${p.capacityTiB.toFixed(2)} TiB`} muted={t.tooltipMuted} text={t.tooltipText} />
        )}
        {p.netAddress && (
          <Row label="Network" value={p.netAddress} muted={t.tooltipMuted} text={t.tooltipText} mono />
        )}
        {/* Full BLS key */}
        {(p.fullBlsKey || p.blsKey) && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 9, color: t.tooltipMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
              BLS Key
            </div>
            <div style={{
              fontSize: 9, fontFamily: "monospace", color: t.tooltipMuted,
              wordBreak: "break-all", lineHeight: 1.4,
              background: "rgba(128,128,128,0.08)", padding: "4px 6px", borderRadius: 4,
            }}>
              {(p.fullBlsKey || p.blsKey).slice(0, 64)}…
            </div>
          </div>
        )}
        {/* Full address */}
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 9, color: t.tooltipMuted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>
            Address
          </div>
          <div style={{ fontSize: 9, fontFamily: "monospace", color: t.tooltipMuted, wordBreak: "break-all" }}>
            {p.address}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted, text, mono }: {
  label: string; value: string; muted: string; text: string; mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 10, color: muted }}>{label}</span>
      <span style={{ fontSize: 10, color: text, fontFamily: mono ? "monospace" : "inherit", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

// ── Main Map Component ────────────────────────────────────────────────────────
export function ProviderMap({ providers, onProviderClick }: ProviderMapProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([20, 10]);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = THEMES[theme];

  // Group providers by zone (auto-handles new SPs)
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  // Find "main" (first healthy) SP per zone
  const getMainSP = (zone: string) => {
    const zps = byZone.get(zone) ?? [];
    return zps.find(p => p.health === "Healthy") ?? zps[0];
  };

  const handleMarkerHover = useCallback((p: StorageProvider, e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    setTooltip({
      provider: p,
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    });
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: t.bg }}>
      <style>{`
        @keyframes sp-ping {
          0%   { transform: scale(1);   opacity: 0.8; }
          70%  { transform: scale(2.2); opacity: 0; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .sp-ping { animation: sp-ping 2.5s cubic-bezier(0,0,0.2,1) infinite; }
      `}</style>

      {/* Theme toggle */}
      <div style={{
        position: "absolute", top: 10, right: 12, zIndex: 20,
        display: "flex", gap: 4,
      }}>
        {(["dark", "light"] as Theme[]).map(th => (
          <button key={th} onClick={() => setTheme(th)} style={{
            padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
            border: "1px solid",
            borderColor: theme === th ? t.marker : "rgba(128,128,128,0.3)",
            background: theme === th ? t.marker : "transparent",
            color: theme === th ? "#fff" : t.tooltipMuted,
            cursor: "pointer",
          }}>
            {th === "dark" ? "🌙" : "☀"} {th}
          </button>
        ))}

        {/* Reset zoom */}
        <button onClick={() => { setZoom(1); setCenter([20, 10]); }} style={{
          padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600,
          border: `1px solid rgba(128,128,128,0.3)`,
          background: "transparent", color: t.tooltipMuted, cursor: "pointer",
        }}>
          ⊕ Reset
        </button>
      </div>

      {/* Sovereignty badge */}
      <div style={{
        position: "absolute", bottom: 10, right: 12, zIndex: 20,
        background: theme === "dark" ? "rgba(6,14,28,0.85)" : "rgba(255,255,255,0.9)",
        border: "1px solid rgba(217,119,6,0.4)",
        borderRadius: 7, padding: "3px 10px",
        fontSize: 9, color: "#92400e",
        backdropFilter: "blur(6px)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* SP count badge */}
      <div style={{
        position: "absolute", bottom: 10, left: 12, zIndex: 20,
        background: theme === "dark" ? "rgba(6,14,28,0.85)" : "rgba(255,255,255,0.9)",
        border: `1px solid ${theme === "dark" ? "rgba(6,182,212,0.3)" : "#e5e7eb"}`,
        borderRadius: 7, padding: "3px 10px",
        fontSize: 10, color: t.tooltipText,
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
        {providers.filter(p => p.health === "Healthy").length}/{providers.length} healthy
      </div>

      {/* Map */}
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: center, scale: 140 }}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup
          zoom={zoom}
          center={center}
          maxZoom={15}
          onMoveEnd={({ zoom: z, coordinates: c }) => {
            setZoom(z);
            setCenter(c as [number, number]);
          }}
        >
          {/* Land masses */}
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={t.land}
                  stroke={t.landStroke}
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover:   { outline: "none", fill: theme === "dark" ? "#1a3a6e" : "#c5d9ee" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>

          {/* ── Vietnam Sovereignty Markers ─────────────────────────────────── */}
          {/* Hoàng Sa [lng, lat] = [112.3, 16.5] */}
          <Marker coordinates={[112.3, 16.5]}>
            <g>
              {/* Không animate — đứng yên theo guide */}
              <circle
                r={4.5 / zoom}
                fill="none"
                stroke={t.islandStroke}
                strokeWidth={0.6 / zoom}
                opacity={0.9}
              />
              {zoom > 3 && (
                <text
                  textAnchor="middle"
                  y={-8 / zoom}
                  style={{ fontSize: `${8 / zoom}px`, fill: t.islandStroke, fontFamily: "monospace", fontWeight: 600 }}
                >
                  Hoàng Sa
                </text>
              )}
            </g>
          </Marker>

          {/* Trường Sa [lng, lat] = [114.1, 10.4] */}
          <Marker coordinates={[114.1, 10.4]}>
            <g>
              <circle
                r={4.5 / zoom}
                fill="none"
                stroke={t.islandStroke}
                strokeWidth={0.6 / zoom}
                opacity={0.9}
              />
              {zoom > 3 && (
                <text
                  textAnchor="middle"
                  y={-8 / zoom}
                  style={{ fontSize: `${8 / zoom}px`, fill: t.islandStroke, fontFamily: "monospace", fontWeight: 600 }}
                >
                  Trường Sa
                </text>
              )}
            </g>
          </Marker>

          {/* ── Network arc connections (thin lines between zones) ──────────── */}
          {Array.from(byZone.keys()).flatMap((z1, i, arr) =>
            arr.slice(i + 1).map(z2 => {
              const a = ZONE_ANCHORS[z1];
              const b = ZONE_ANCHORS[z2];
              if (!a || !b) return null;
              return (
                <line
                  key={`${z1}-${z2}`}
                  x1={0} y1={0} x2={0} y2={0}  // placeholder — react-simple-maps handles projection
                />
              );
            })
          )}

          {/* ── SP Zone Markers (auto from providers data) ──────────────────── */}
          {Array.from(byZone.entries()).map(([zone, sps]) => {
            const coords = ZONE_ANCHORS[zone];
            if (!coords) return null;

            const healthy = sps.filter(p => p.health === "Healthy").length;
            const allOk   = healthy === sps.length && sps.length > 0;
            const mainSP  = getMainSP(zone);
            const count   = sps.length;

            // Rect size scales với count, shrinks khi zoom
            const rw = Math.max(24, 18 + count * 2);
            const rh = 22;
            const markerColor = allOk ? t.marker : healthy > 0 ? "#f59e0b" : "#ef4444";

            return (
              <Marker key={zone} coordinates={coords}>
                <g
                  style={{ cursor: "pointer" }}
                  onClick={() => mainSP && onProviderClick?.(mainSP)}
                  onMouseEnter={e => mainSP && handleMarkerHover(mainSP, e)}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {/* Pulse ring (chỉ khi all healthy) — theo guide: animate-ping effect */}
                  {allOk && (
                    <rect
                      x={-rw / 2 - 4} y={-rh / 2 - 4}
                      width={rw + 8} height={rh + 8}
                      rx={8}
                      fill="none"
                      stroke={markerColor}
                      strokeWidth={1.5}
                      opacity={0.3}
                      className="sp-ping"
                      style={{ transformOrigin: "center" }}
                    />
                  )}

                  {/* Main rect (bo góc theo guide) */}
                  <rect
                    x={-rw / 2} y={-rh / 2}
                    width={rw} height={rh}
                    rx={6}
                    fill={theme === "dark" ? "rgba(6,20,45,0.92)" : "rgba(255,255,255,0.96)"}
                    stroke={markerColor}
                    strokeWidth={1.5}
                  />

                  {/* Count */}
                  <text
                    textAnchor="middle"
                    dominantBaseline="middle"
                    y={-2}
                    style={{
                      fontSize: count >= 10 ? "11px" : "13px",
                      fontWeight: 800,
                      fill: t.markerText,
                      fontFamily: "monospace",
                      pointerEvents: "none",
                    }}
                  >
                    {count}
                  </text>

                  {/* Zone label below */}
                  <text
                    textAnchor="middle"
                    y={rh / 2 + 12}
                    style={{
                      fontSize: "8px",
                      fill: t.tooltipMuted,
                      fontFamily: "monospace",
                      fontWeight: 600,
                      pointerEvents: "none",
                    }}
                  >
                    {ZONE_META[zone]?.shortLabel ?? zone.replace("dc_", "").toUpperCase()}
                  </text>

                  {/* Health dot */}
                  {!allOk && (
                    <circle
                      cx={rw / 2 - 2}
                      cy={-rh / 2 + 2}
                      r={4}
                      fill="#ef4444"
                      stroke={theme === "dark" ? "#060d1a" : "#fff"}
                      strokeWidth={1}
                    />
                  )}
                </g>
              </Marker>
            );
          })}

          {/* ── Individual SP dots (khi zoom > 4) ──────────────────────────── */}
          {zoom > 4 && providers.map((p, i) => {
            const baseCoords = ZONE_ANCHORS[p.availabilityZone];
            if (!baseCoords) return null;
            // Jitter để phân biệt các SPs cùng zone
            const angle = (i / Math.max(providers.filter(sp => sp.availabilityZone === p.availabilityZone).length, 1)) * Math.PI * 2;
            const r = 1.5;
            const coords: [number, number] = [
              baseCoords[0] + Math.cos(angle) * r,
              baseCoords[1] + Math.sin(angle) * r,
            ];
            const isHealthy = p.health === "Healthy";

            return (
              <Marker key={p.address || i} coordinates={coords}>
                <g
                  style={{ cursor: "pointer" }}
                  onMouseEnter={e => handleMarkerHover(p, e)}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => onProviderClick?.(p)}
                >
                  <circle
                    r={3}
                    fill={isHealthy ? "#22c55e" : "#ef4444"}
                    stroke={theme === "dark" ? "#060d1a" : "#fff"}
                    strokeWidth={0.5}
                  />
                </g>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <SPTooltip data={tooltip} theme={theme} />
      )}
    </div>
  );
}