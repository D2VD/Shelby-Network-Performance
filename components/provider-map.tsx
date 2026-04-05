"use client";
/**
 * components/provider-map.tsx — v7.0
 * Map theo demo_map.txt: react-simple-maps với ZoomableGroup maxZoom=10
 * Dynamic import để tránh SSR crash trên CF Pages
 * Cluster popup tooltip (không expand dọc)
 * Hoàng Sa [112.3, 16.5] + Trường Sa [114.1, 10.4] — circle rỗng, không animate
 * SP nodes: rect bo góc, animate-ping cho zone chính (all healthy)
 * Dark/Light theme
 */

import dynamic from "next/dynamic";
import { useState, useCallback, Suspense } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// ── Themes (theo demo_map.txt) ─────────────────────────────────────────────────
const THEMES = {
  blue: {
    bg:          "#0f172a",
    land:        "#1e293b",
    border:      "#334155",
    markerMain:  "#ffffff",
    markerSub:   "#3b82f6",
    textMain:    "#000000",
    textSub:     "#ffffff",
    islandStroke:"#38bdf8",
    arc:         "rgba(59,130,246,0.2)",
    arcFlow:     "#3b82f6",
    nodeSub:     "rgba(255,255,255,0.5)",
    tooltip:     { bg: "rgba(15,23,42,0.97)", border: "rgba(59,130,246,0.4)", text: "#f1f5f9", muted: "#94a3b8" },
  },
  white: {
    bg:          "#ffffff",
    land:        "#f1f5f9",
    border:      "#e2e8f0",
    markerMain:  "#2563eb",
    markerSub:   "#94a3b8",
    textMain:    "#ffffff",
    textSub:     "#ffffff",
    islandStroke:"#0369a1",
    arc:         "rgba(37,99,235,0.15)",
    arcFlow:     "#2563eb",
    nodeSub:     "#64748b",
    tooltip:     { bg: "rgba(255,255,255,0.98)", border: "#e5e7eb", text: "#111827", muted: "#6b7280" },
  },
};
type Theme = keyof typeof THEMES;

// ── Zone config (lng, lat) ─────────────────────────────────────────────────────
const ZONES: Record<string, { lng: number; lat: number; label: string; short: string }> = {
  dc_us_west:   { lng: -121.89, lat:  37.34, label: "US West (San Jose)",  short: "US-W" },
  dc_us_east:   { lng:  -77.44, lat:  39.04, label: "US East (Virginia)",  short: "US-E" },
  dc_europe:    { lng:    8.68, lat:  50.11, label: "Europe (Frankfurt)",  short: "EU"   },
  dc_asia:      { lng:  103.82, lat:   1.35, label: "Asia (Singapore)",    short: "SG"   },
  dc_australia: { lng:  151.21, lat: -33.87, label: "Australia (Sydney)",  short: "AU"   },
};

// ── Dynamic imports (tránh SSR) ────────────────────────────────────────────────
const ComposableMap = dynamic(
  () => import("react-simple-maps").then(m => ({ default: m.ComposableMap })),
  { ssr: false }
);
const ZoomableGroup = dynamic(
  () => import("react-simple-maps").then(m => ({ default: m.ZoomableGroup })),
  { ssr: false }
);
const Geographies = dynamic(
  () => import("react-simple-maps").then(m => ({ default: m.Geographies })),
  { ssr: false }
);
const Geography = dynamic(
  () => import("react-simple-maps").then(m => ({ default: m.Geography })),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-simple-maps").then(m => ({ default: m.Marker })),
  { ssr: false }
);

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Cluster Popup Tooltip ─────────────────────────────────────────────────────
// Popup nổi lên, không expand row (fix issue #2)
function ClusterPopup({
  zone, providers, theme, onClose,
}: {
  zone: string;
  providers: StorageProvider[];
  theme: Theme;
  onClose: () => void;
}) {
  const t = THEMES[theme].tooltip;
  const meta = ZONES[zone];
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const copy = async (text: string, addr: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1500);
  };

  const healthy = providers.filter(p => p.health === "Healthy").length;

  return (
    <div style={{
      position: "absolute",
      top: "50%", left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: 100,
      background: t.bg,
      border: `1px solid ${t.border}`,
      borderRadius: 14,
      padding: "16px 18px",
      width: 320,
      maxHeight: 420,
      overflow: "hidden",
      backdropFilter: "blur(16px)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      display: "flex", flexDirection: "column", gap: 0,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{meta?.label ?? zone}</div>
          <div style={{ fontSize: 11, color: t.muted, marginTop: 2 }}>
            {healthy}/{providers.length} healthy · {zone}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: t.muted, fontSize: 18, lineHeight: 1, padding: "2px 4px" }}
        >
          ×
        </button>
      </div>

      {/* SP list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: 340, paddingRight: 4 }}>
        {providers.map((p, i) => {
          const isH = p.health === "Healthy";
          return (
            <div key={p.address || i} style={{
              background: isH ? "rgba(34,197,94,0.07)" : "rgba(239,68,68,0.07)",
              border: `1px solid ${isH ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
              borderRadius: 8, padding: "9px 11px",
            }}>
              {/* Row 1: address + health */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: t.text, fontFamily: "monospace" }}>
                  {p.addressShort}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "1px 7px", borderRadius: 4,
                  background: isH ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  color: isH ? "#22c55e" : "#ef4444",
                }}>
                  {p.health}
                </span>
              </div>

              {/* Row 2: details grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                <Info label="State"    value={p.state}  muted={t.muted} text={t.text} />
                {p.capacityTiB != null && <Info label="Capacity" value={`${p.capacityTiB.toFixed(1)} TiB`} muted={t.muted} text={t.text} />}
                {p.geo?.city && <Info label="City" value={p.geo.city} muted={t.muted} text={t.text} />}
              </div>

              {/* BLS key */}
              {(p.fullBlsKey || p.blsKey) && (
                <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 9, color: t.muted, flexShrink: 0 }}>BLS</span>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: t.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {(p.fullBlsKey || p.blsKey).slice(0, 32)}…
                  </span>
                  <button
                    onClick={() => copy(p.fullBlsKey || p.blsKey || "", p.address)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: copiedAddr === p.address ? "#22c55e" : t.muted, flexShrink: 0 }}
                  >
                    {copiedAddr === p.address ? "✓" : "⧉"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Info({ label, value, muted, text }: { label: string; value: string; muted: string; text: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 10, color: text, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────
function MapSkeleton({ theme }: { theme: Theme }) {
  return (
    <div style={{ width: "100%", height: "100%", background: THEMES[theme].bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 13, color: THEMES[theme].nodeSub, fontFamily: "monospace" }}>
        Loading map…
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export function ProviderMap({ providers, onProviderClick }: ProviderMapProps) {
  const [theme, setTheme] = useState<Theme>("blue");
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const t = THEMES[theme];

  // Group providers by zone — auto-handles new SPs
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  const activeZones = Array.from(byZone.keys()).filter(z => ZONES[z]);

  const handleMarkerClick = useCallback((zone: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveZone(prev => prev === zone ? null : zone);
  }, []);

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%", background: t.bg, overflow: "hidden" }}
      onClick={() => setActiveZone(null)}
    >
      <style>{`
        @keyframes rsm-ping {
          0%   { opacity: 0.7; transform: scale(1); }
          70%  { opacity: 0;   transform: scale(2.2); }
          100% { opacity: 0;   transform: scale(2.2); }
        }
        .rsm-ping { animation: rsm-ping 2.5s cubic-bezier(0,0,0.2,1) infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes arc-flow { to { stroke-dashoffset: -40; } }
      `}</style>

      {/* Theme toggle */}
      <div style={{ position: "absolute", top: 10, right: 12, zIndex: 30, display: "flex", gap: 4, background: "rgba(15,23,42,0.3)", padding: "4px 6px", borderRadius: 20, backdropFilter: "blur(8px)", border: "1px solid rgba(100,116,139,0.2)" }}>
        {(["blue", "white"] as Theme[]).map(th => (
          <button key={th} onClick={e => { e.stopPropagation(); setTheme(th); }} style={{
            padding: "4px 14px", borderRadius: 16, fontSize: 11, fontWeight: 600,
            border: "none", cursor: "pointer",
            background: theme === th ? (th === "blue" ? "#2563eb" : "#fff") : "transparent",
            color: theme === th ? (th === "blue" ? "#fff" : "#2563eb") : "rgba(148,163,184,0.8)",
            transition: "all 0.2s",
          }}>
            {th === "blue" ? "Deep Blue" : "Clean White"}
          </button>
        ))}
      </div>

      {/* Status badge */}
      <div style={{
        position: "absolute", bottom: 10, left: 12, zIndex: 30,
        background: "rgba(15,23,42,0.7)", borderRadius: 6, padding: "4px 10px",
        color: "rgba(255,255,255,0.4)", fontSize: 9, fontFamily: "monospace",
        letterSpacing: "0.15em", textTransform: "uppercase",
        backdropFilter: "blur(6px)",
      }}>
        Global Infrastructure Nodes // Status: {providers.filter(p => p.health === "Healthy").length > 0 ? "Active" : "Loading"}
      </div>

      {/* VN Sovereignty */}
      <div style={{
        position: "absolute", bottom: 10, right: 12, zIndex: 30,
        background: "rgba(15,23,42,0.7)", borderRadius: 6, padding: "4px 10px",
        fontSize: 9, color: "rgba(217,119,6,0.9)",
        backdropFilter: "blur(6px)", fontFamily: "monospace",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Map */}
      <Suspense fallback={<MapSkeleton theme={theme} />}>
        <ComposableMap
          projectionConfig={{ scale: 180 }}
          style={{ width: "100%", height: "100%" }}
        >
          <ZoomableGroup
            zoom={zoom}
            minZoom={1}
            maxZoom={10}
            onMoveEnd={({ zoom: z }) => setZoom(z)}
          >
            {/* Land */}
            <Geographies geography={GEO_URL}>
              {({ geographies }: any) =>
                geographies.map((geo: any) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={t.land}
                    stroke={t.border}
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover:   { fill: theme === "blue" ? "#334155" : "#cbd5e1", outline: "none", cursor: "grab" },
                      pressed: { outline: "none" },
                    }}
                  />
                ))
              }
            </Geographies>

            {/* Hoàng Sa — circle rỗng, KHÔNG animate */}
            <Marker coordinates={[112.3, 16.5] as any}>
              <circle r={3.5 / zoom} fill="none" stroke={t.islandStroke} strokeWidth={0.6 / zoom} opacity={0.9} />
            </Marker>
            {/* Trường Sa */}
            <Marker coordinates={[114.1, 10.4] as any}>
              <circle r={3.5 / zoom} fill="none" stroke={t.islandStroke} strokeWidth={0.6 / zoom} opacity={0.9} />
            </Marker>

            {/* SP Zone Markers */}
            {activeZones.map(zone => {
              const zCfg = ZONES[zone];
              const sps     = byZone.get(zone) ?? [];
              const healthy = sps.filter(p => p.health === "Healthy").length;
              const allOk   = healthy === sps.length && sps.length > 0;
              const isMain  = allOk && sps.length >= 5; // "main" node = largest healthy zone

              const markerColor = isMain ? t.markerMain : t.markerSub;
              const textColor   = isMain ? t.textMain   : t.textSub;
              const borderColor = allOk ? (isMain ? "rgba(255,255,255,0.5)" : "rgba(59,130,246,0.5)") : "#ef4444";

              const rw = Math.max(22, 18 + sps.length * 1.5);
              const rh = 20;

              return (
                <Marker key={zone} coordinates={[zCfg.lng, zCfg.lat] as any}>
                  <g
                    style={{ cursor: "pointer" }}
                    onClick={(e: any) => handleMarkerClick(zone, e)}
                  >
                    {/* Ping ring (animate-ping style) — chỉ node chính */}
                    {isMain && (
                      <rect
                        x={-rw / 2 - 6} y={-rh / 2 - 6}
                        width={rw + 12} height={rh + 12} rx={10}
                        fill={markerColor} fillOpacity={0.2}
                        className="rsm-ping"
                      />
                    )}

                    {/* Main rect (bo góc theo guide) */}
                    <rect
                      x={-rw / 2} y={-rh / 2}
                      width={rw} height={rh} rx={6}
                      fill={markerColor}
                      stroke={borderColor} strokeWidth={1}
                      style={{ filter: "drop-shadow(0px 4px 4px rgba(0,0,0,0.25))" }}
                    />

                    {/* Count badge */}
                    <text
                      textAnchor="middle" y={5}
                      style={{
                        fontFamily: "Inter, system-ui, sans-serif",
                        fontSize: `${sps.length >= 10 ? 9 : 10}px`,
                        fontWeight: "700",
                        fill: textColor,
                        pointerEvents: "none",
                      }}
                    >
                      {sps.length}
                    </text>

                    {/* Zone label below */}
                    <text
                      textAnchor="middle" y={rh / 2 + 10}
                      style={{
                        fontSize: "7px", fill: t.nodeSub,
                        fontFamily: "monospace", fontWeight: "600",
                        pointerEvents: "none",
                      }}
                    >
                      {ZONE_META[zone]?.shortLabel ?? zCfg.short}
                    </text>

                    {/* Error dot */}
                    {!allOk && (
                      <circle
                        cx={rw / 2 - 2} cy={-rh / 2 + 2} r={3}
                        fill="#ef4444" stroke={t.bg} strokeWidth={0.8}
                      />
                    )}
                  </g>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </Suspense>

      {/* Cluster Popup (issue #2: popup nổi, không expand dọc) */}
      {activeZone && byZone.has(activeZone) && (
        <ClusterPopup
          zone={activeZone}
          providers={byZone.get(activeZone)!}
          theme={theme}
          onClose={() => setActiveZone(null)}
        />
      )}

      {/* Scroll hint */}
      <div style={{
        position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)",
        fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace",
        pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        Scroll to zoom · Drag to pan · Click node to see all SPs
      </div>
    </div>
  );
}