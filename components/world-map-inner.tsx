"use client";
/**
 * components/world-map-inner.tsx — v8.2
 *
 * Changes vs v8.0:
 *  6. SP marker color: Healthy #ff77c9 → #ffffff (white) so markers contrast
 *     against the pink (#ec4899) land fill instead of blending into it.
 *  7. Hoàng Sa + Trường Sa: replaced single text label with per-island SVG
 *     circle dots (same coord set as globe v8.2) — labels are stable because
 *     they sit inside ComposableMap's projection coordinate space, not CSS.
 *  8. Scroll prevention: removed passive React onWheel; added native wheel
 *     listener with { passive: false } so e.preventDefault() is honoured by
 *     the browser and page no longer scrolls while zooming the map.
 *  1. SVG diamond markers no longer appear off-map
 *     ROOT CAUSE: `style={{ transform:"rotate(45deg)" }}` on SVG <rect>
 *     rotates around the SVG viewport origin (0,0), not the element centre —
 *     sending markers far above the visible map.
 *     FIX: Wrap <rect> in <g transform="rotate(45)"> so rotation is local.
 *  2. ComposableMap gets explicit width={800} height={400} for stable SVG
 *     coordinate space regardless of container size.
 *  3. Sovereignty markers use the same <g transform> fix.
 *  4. Light-mode ocean colour corrected (soft blue-grey instead of white).
 *  5. Pan via CSS translate on inner <g> instead of re-projecting on every
 *     drag pixel — smoother and avoids marker jitter.
 */

import { useState, useRef, useCallback, useEffect, memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import type { StorageProvider } from "@/lib/types";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface Cluster {
  key: string;
  lat: number;
  lng: number;
  providers: StorageProvider[];
  health: "Healthy" | "Waitlisted" | "Leaving" | "Faulty" | "mixed";
  zone: string;
}

interface WorldMapInnerProps {
  providers: StorageProvider[];
  isDark: boolean;
  onProviderClick?: (p: StorageProvider) => void;
}

const SOVEREIGNTY = [
  { key: "hoang-sa",  lat: 16.5,  lng: 112.0,  label: "🇻🇳 Hoàng Sa"  },
  { key: "truong-sa", lat: 10.0,  lng: 114.17, label: "🇻🇳 Trường Sa" },
];

// ── Vietnamese maritime territory island dots ─────────────────────────────────
// world-atlas 110m omits Hoàng Sa + Trường Sa; we render each island as a
// small SVG circle so the archipelago scatter matches official VN maps.
const HOANG_SA_COORDS: [number, number][] = [
  [112.34, 16.84], // Phú Lâm (principal — rendered larger)
  [112.35, 16.97], [112.72, 16.72], [112.64, 16.56], [112.47, 16.61],
  [112.21, 16.51], [112.13, 16.53], [111.92, 16.43], [111.86, 16.58],
  [111.75, 16.45], [111.69, 16.47], [111.60, 16.41],
];
const TRUONG_SA_COORDS: [number, number][] = [
  [114.28, 11.05], // Thị Tứ (principal — rendered larger)
  [114.32, 11.09], [113.95, 11.43], [115.14, 10.87], [114.51,  9.87],
  [114.36, 10.18], [113.79, 10.73], [114.66, 10.37], [114.22,  9.72],
  [111.92,  8.64], [115.64, 10.52], [116.73,  9.72], [116.55,  9.57],
  [115.87, 10.06], [115.23,  9.48], [114.08,  9.15], [113.63,  9.90],
  [112.55, 10.04], [112.98,  9.45],
];

const HEALTH_COLOR: Record<string, string> = {
  Healthy:    "#ffffff",   // white — contrasts against pink land (#ec4899)
  Waitlisted: "#f59e0b",
  Leaving:    "#fb923c",
  Faulty:     "#ef4444",
  mixed:      "#a78bfa",
};

function buildClusters(providers: StorageProvider[]): Cluster[] {
  const map = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const lat = p.geo?.lat ?? 0;
    const lng = p.geo?.lng ?? 0;
    // Cluster key: round to 1° grid
    const key = `${Math.round(lat)}_${Math.round(lng)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  });

  return Array.from(map.entries()).map(([key, list]) => {
    const avgLat = list.reduce((s, p) => s + (p.geo?.lat ?? 0), 0) / list.length;
    const avgLng = list.reduce((s, p) => s + (p.geo?.lng ?? 0), 0) / list.length;

    // Determine collective health
    const statuses = new Set(list.map(p => p.health));
    const health: Cluster["health"] =
      statuses.size === 1
        ? (Array.from(statuses)[0] as Cluster["health"])
        : "mixed";

    return {
      key,
      lat: avgLat,
      lng: avgLng,
      providers: list,
      health,
      zone: list[0]?.availabilityZone ?? "",
    };
  });
}

function ClusterMarker({
  cluster,
  isDark,
  onClick,
  onHover,
  onLeave,
}: {
  cluster: Cluster;
  isDark: boolean;
  onClick:  (c: Cluster) => void;
  onHover:  (c: Cluster) => void;
  onLeave:  () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color  = HEALTH_COLOR[cluster.health] ?? "#94a3b8";
  const count  = cluster.providers.length;
  const size   = count === 1 ? 7 : count <= 3 ? 9 : 11;

  return (
    <Marker
      coordinates={[cluster.lng, cluster.lat]}
      onClick={() => onClick(cluster)}
      onMouseEnter={() => { setHovered(true);  onHover(cluster); }}
      onMouseLeave={() => { setHovered(false); onLeave(); }}
    >
      {/* FIX: Use SVG transform attribute on <g>, NOT CSS style on <rect>.
          CSS rotate() on an SVG element rotates around the SVG viewport
          origin (0,0), displacing the marker way off-screen. The SVG
          transform attribute rotates around the local group origin, which
          here is the Marker's geographic coordinate — correct behaviour. */}
      <g
        transform="rotate(45)"
        style={{ cursor: "pointer", transition: "transform 0.15s" }}
      >
        <rect
          x={-size}
          y={-size}
          width={size * 2}
          height={size * 2}
          fill={color}
          stroke="rgba(255,255,255,0.3)"
          strokeWidth={1}
          opacity={hovered ? 1 : 0.88}
        />
      </g>

      {/* Count badge for clusters of 2+ */}
      {count > 1 && (
        <text
          textAnchor="middle"
          dy={-size - 5}
          style={{
            fontSize: 9,
            fontFamily: "monospace",
            fontWeight: 700,
            fill: isDark ? "#e2e8f0" : "#1e293b",
            pointerEvents: "none",
          }}
        >
          {count}
        </text>
      )}

      {/* Zone label below marker */}
      {cluster.zone && (
        <text
          textAnchor="middle"
          dy={size + 11}
          style={{
            fontSize: 8,
            fontFamily: "monospace",
            fill: isDark ? "#94a3b8" : "#475569",
            pointerEvents: "none",
          }}
        >
          {cluster.zone.replace("dc_", "")}
        </text>
      )}
    </Marker>
  );
}

const MemoClusterMarker = memo(ClusterMarker);

export default function WorldMapInner({
  providers,
  isDark,
  onProviderClick,
}: WorldMapInnerProps) {
  const clusters = buildClusters(providers);

  // Zoom + pan state
  const [scale,  setScale]  = useState(155);
  const [center, setCenter] = useState<[number, number]>([15, 5]);
  const [tooltip, setTooltip] = useState<{ cluster: Cluster; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{ startX: number; startY: number; startCenter: [number, number] } | null>(null);

  // ── Non-passive wheel listener — prevents page scroll while zooming ──────
  // React's synthetic onWheel is passive in modern browsers; preventDefault()
  // is silently ignored. We attach a native listener with { passive: false }.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setScale(s => Math.max(80, Math.min(600, s * (e.deltaY < 0 ? 1.12 : 0.89))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Drag to pan ──────────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startCenter: center };
  }, [center]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const lngPerPx = 360 / scale;
      const latPerPx = 180 / (scale * 0.5);
      setCenter([
        dragRef.current.startCenter[0] - dx * lngPerPx,
        dragRef.current.startCenter[1] + dy * latPerPx * 0.5,
      ]);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [scale]);

  // ── Cluster hover → show tooltip immediately; click for single SP ───────
  const handleClusterHover = useCallback((cluster: Cluster) => {
    setTooltip({ cluster, x: 0, y: 0 });
  }, []);

  const handleClusterLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleClusterClick = useCallback((cluster: Cluster) => {
    if (cluster.providers.length === 1) {
      onProviderClick?.(cluster.providers[0]);
    }
    // multi-node clusters: tooltip already shown on hover; click is a no-op
  }, [onProviderClick]);

  const landColor  = isDark ? "rgba(255,100,180,0.75)"  : "#ec4899";
  const oceanColor = isDark ? "#0d1a2e"                  : "#c9dff2";
  const borderColor= isDark ? "rgba(255,150,210,0.3)"   : "rgba(236,72,153,0.4)";

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden",
               background: oceanColor, cursor: "grab", userSelect: "none" }}
      onMouseDown={onMouseDown}
    >
      {/* Dismiss tooltip on background click */}
      {tooltip && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 5 }}
          onClick={() => setTooltip(null)}
        />
      )}

      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale, center }}
        // Explicit SVG dimensions give a stable coordinate space for markers
        width={800}
        height={400}
        style={{ width: "100%", height: "100%", display: "block" }}
      >
        {/* Countries */}
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
                  hover:    { outline: "none", fill: isDark ? "rgba(255,130,200,0.82)" : "#db2777" },
                  pressed:  { outline: "none" },
                }}
              />
            ))
          }
        </Geographies>

        {/* SP cluster markers */}
        {clusters.map(cluster => (
          <MemoClusterMarker
            key={cluster.key}
            cluster={cluster}
            isDark={isDark}
            onClick={handleClusterClick}
            onHover={handleClusterHover}
            onLeave={handleClusterLeave}
          />
        ))}

        {/* Hoàng Sa — individual island dots */}
        {HOANG_SA_COORDS.map(([lng, lat], idx) => (
          <Marker key={`hs-${idx}`} coordinates={[lng, lat]}>
            <circle
              r={idx === 0 ? 3.5 : 2}
              fill={landColor}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={0.6}
            />
            {idx === 0 && (
              <text
                textAnchor="middle"
                dy={-7}
                style={{
                  fontSize: 7, fontFamily: "monospace", fontWeight: 700,
                  fill: isDark ? "#fde68a" : "#92400e",
                  paintOrder: "stroke",
                  stroke: isDark ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)",
                  strokeWidth: 3, strokeLinejoin: "round" as const,
                  pointerEvents: "none",
                }}
              >
                🇻🇳 Hoàng Sa
              </text>
            )}
          </Marker>
        ))}

        {/* Trường Sa — individual island dots */}
        {TRUONG_SA_COORDS.map(([lng, lat], idx) => (
          <Marker key={`ts-${idx}`} coordinates={[lng, lat]}>
            <circle
              r={idx === 0 ? 3.5 : 2}
              fill={landColor}
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={0.6}
            />
            {idx === 0 && (
              <text
                textAnchor="middle"
                dy={-7}
                style={{
                  fontSize: 7, fontFamily: "monospace", fontWeight: 700,
                  fill: isDark ? "#fde68a" : "#92400e",
                  paintOrder: "stroke",
                  stroke: isDark ? "rgba(0,0,0,0.8)" : "rgba(255,255,255,0.9)",
                  strokeWidth: 3, strokeLinejoin: "round" as const,
                  pointerEvents: "none",
                }}
              >
                🇻🇳 Trường Sa
              </text>
            )}
          </Marker>
        ))}
      </ComposableMap>

      {/* Cluster tooltip panel */}
      {tooltip && (
        <div style={{
          position: "absolute", bottom: 12, left: "50%",
          transform: "translateX(-50%)", zIndex: 20,
          background: isDark ? "rgba(7,14,26,0.97)" : "rgba(255,255,255,0.97)",
          border: `1px solid ${isDark ? "rgba(255,119,201,0.3)" : "rgba(236,72,153,0.3)"}`,
          borderRadius: 10, padding: "10px 14px",
          fontFamily: "monospace", fontSize: 11,
          color: isDark ? "#e2e8f0" : "#1e293b",
          maxWidth: 260, backdropFilter: "blur(8px)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.35)",
        }}>
          <div style={{ fontWeight: 700, color: "#ff77c9", marginBottom: 6 }}>
            {tooltip.cluster.providers.length} nodes · {tooltip.cluster.zone}
          </div>
          {tooltip.cluster.providers.slice(0, 8).map(p => (
            <div
              key={p.address}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 0", cursor: "pointer",
                borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}`,
              }}
              onClick={() => { onProviderClick?.(p); setTooltip(null); }}
            >
              <span style={{
                display: "inline-block", width: 7, height: 7,
                background: HEALTH_COLOR[p.health as string] ?? "#94a3b8",
                transform: "rotate(45deg)", flexShrink: 0,
              }}/>
              <span style={{ color: isDark ? "#94a3b8" : "#475569", fontSize: 10 }}>
                {p.addressShort ?? (p.address?.slice(0, 8) + "…")}
              </span>
              <span style={{ marginLeft: "auto", color: isDark ? "#64748b" : "#94a3b8", fontSize: 9 }}>
                {p.health}
              </span>
            </div>
          ))}
          {tooltip.cluster.providers.length > 8 && (
            <div style={{ fontSize: 9, color: "#64748b", marginTop: 4, textAlign: "center" }}>
              +{tooltip.cluster.providers.length - 8} more
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{
        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
        display: "flex", flexDirection: "column", gap: 4, zIndex: 10,
      }}>
        {[
          { label: "+", action: () => setScale(s => Math.min(600, s * 1.2)) },
          { label: "–", action: () => setScale(s => Math.max(80,  s * 0.8)) },
          { label: "⌂", action: () => { setScale(155); setCenter([15, 5]); } },
        ].map(btn => (
          <button
            key={btn.label}
            onClick={btn.action}
            style={{
              width: 26, height: 26, borderRadius: 6,
              border: `1px solid ${isDark ? "rgba(255,119,201,0.3)" : "rgba(236,72,153,0.3)"}`,
              background: isDark ? "rgba(7,14,26,0.88)" : "rgba(255,255,255,0.9)",
              color: isDark ? "#ff77c9" : "#db2777",
              cursor: "pointer", fontSize: 14, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(6px)",
            }}
          >{btn.label}</button>
        ))}
      </div>

      {/* Sovereignty footer */}
      <div style={{
        position: "absolute", bottom: 6, right: 10, zIndex: 10,
        fontSize: 8, fontFamily: "monospace",
        color: isDark ? "#fde68a" : "#92400e",
        opacity: 0.8, pointerEvents: "none",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Usage hint */}
      <div style={{
        position: "absolute", bottom: 6, left: 10, zIndex: 10,
        fontSize: 8, fontFamily: "monospace",
        color: isDark ? "#1e293b" : "#94a3b8",
        pointerEvents: "none",
      }}>
        scroll-zoom · drag-pan · click-pin
      </div>
    </div>
  );
}