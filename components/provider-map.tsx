"use client";
// components/provider-map.tsx — v4.0
// MapLibre GL JS (CDN) — dark network map như Teraswitch/hình 1
// Chỉ dùng trong /dashboard/providers (admin page)

import { useEffect, useRef, useState, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";

// ─── Zone anchors (lat/lng) ───────────────────────────────────────────────────
const ZONE_ANCHORS: Record<string, { lat: number; lng: number; label: string }> = {
  dc_us_west:   { lat:  37.34, lng: -121.89, label: "US West (San Jose)"   },
  dc_us_east:   { lat:  39.04, lng:  -77.44, label: "US East (Virginia)"   },
  dc_europe:    { lat:  50.11, lng:    8.68, label: "Europe (Frankfurt)"   },
  dc_asia:      { lat:   1.35, lng:  103.82, label: "Asia (Singapore)"     },
  dc_australia: { lat: -33.87, lng:  151.21, label: "Australia (Sydney)"   },
};

// MapLibre CDN
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const MAPLIBRE_JS  = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";

// Free dark tile style (no API key needed)
const MAP_STYLE = "https://demotiles.maplibre.org/style.json";

// ─── Load MapLibre from CDN ───────────────────────────────────────────────────
let mlLoaded = false;
let mlLoading = false;
const mlCbs: Array<() => void> = [];

function loadMapLibre(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (mlLoaded) { resolve(); return; }
    mlCbs.push(resolve);
    if (mlLoading) return;
    mlLoading = true;

    // CSS
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }

    // JS
    const script = document.createElement("script");
    script.src = MAPLIBRE_JS; script.async = true;
    script.onload = () => {
      mlLoaded = true;
      mlCbs.forEach(cb => cb());
      mlCbs.length = 0;
    };
    script.onerror = () => reject(new Error("MapLibre CDN failed"));
    document.head.appendChild(script);
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// ─── Cluster tooltip (HTML, rendered outside canvas) ─────────────────────────
function ZoneTooltip({
  zone, providers, anchor, onClose,
}: {
  zone: string;
  providers: StorageProvider[];
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const meta = ZONE_ANCHORS[zone];
  const healthy = providers.filter(p => p.health === "Healthy").length;

  return (
    <div style={{
      position: "absolute",
      left: Math.min(anchor.x + 16, window.innerWidth - 260),
      top: Math.max(anchor.y - 80, 8),
      zIndex: 20,
      background: "rgba(8,15,28,0.97)",
      border: "1px solid rgba(6,182,212,0.4)",
      borderRadius: 12,
      padding: "14px 16px",
      minWidth: 220,
      backdropFilter: "blur(16px)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
            {meta?.label ?? zone}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {healthy}/{providers.length} healthy
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
        >×</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 200, overflowY: "auto" }}>
        {providers.map((p, i) => (
          <div key={p.address || i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 9px", borderRadius: 7,
            background: p.health === "Healthy" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
            border: `1px solid ${p.health === "Healthy" ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
          }}>
            <span style={{
              fontSize: 11, fontFamily: "monospace", color: "#94a3b8",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140,
            }}>
              {p.addressShort}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: p.health === "Healthy" ? "#22c55e" : "#ef4444",
            }}>
              {p.health === "Healthy" ? "OK" : "ERR"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main map component ───────────────────────────────────────────────────────
export function ProviderMap({ providers }: ProviderMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef<any[]>([]);
  const [ready,    setReady]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [tooltip,  setTooltip]  = useState<{
    zone: string; providers: StorageProvider[]; anchor: { x: number; y: number };
  } | null>(null);

  // Group providers by zone
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    loadMapLibre().then(() => {
      if (cancelled || !containerRef.current) return;
      const ml = (window as any).maplibregl;
      if (!ml) return;

      const map = new ml.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            "osm": {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            }
          },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#060d1a" },
            },
            {
              id: "osm-tiles",
              type: "raster",
              source: "osm",
              paint: {
                "raster-opacity": 0.15,
                "raster-saturation": -1,
                "raster-brightness-min": 0,
                "raster-brightness-max": 0.3,
              },
            },
          ],
        },
        center: [20, 20],
        zoom: 1.5,
        minZoom: 1,
        maxZoom: 6,
        attributionControl: false,
      });

      map.on("load", () => {
        if (cancelled) { map.remove(); return; }
        mapRef.current = map;
        setReady(true);
      });

      map.on("error", (e: any) => {
        console.warn("[Map]", e.error?.message);
        // Non-fatal — map still works
      });
    }).catch(e => {
      setError(e.message);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Draw markers + arcs when map ready + providers change
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    const ml  = (window as any).maplibregl;

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Remove old arc layers
    ["shelby-arcs", "shelby-arcs-anim"].forEach(id => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });

    const zoneKeys = Object.keys(ZONE_ANCHORS).filter(z => byZone.has(z));

    // ── Arc lines between zones ──
    const arcFeatures: any[] = [];
    for (let i = 0; i < zoneKeys.length; i++) {
      for (let j = i + 1; j < zoneKeys.length; j++) {
        const a = ZONE_ANCHORS[zoneKeys[i]];
        const b = ZONE_ANCHORS[zoneKeys[j]];
        arcFeatures.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [a.lng, a.lat],
              [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2 + 8], // slight arc
              [b.lng, b.lat],
            ],
          },
        });
      }
    }

    if (arcFeatures.length > 0) {
      map.addSource("shelby-arcs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: arcFeatures },
      });
      // Base dim arc
      map.addLayer({
        id: "shelby-arcs",
        type: "line",
        source: "shelby-arcs",
        paint: {
          "line-color": "#06b6d4",
          "line-width": 1,
          "line-opacity": 0.25,
        },
      });
    }

    // ── Zone cluster markers ──
    zoneKeys.forEach(zone => {
      const anchor  = ZONE_ANCHORS[zone];
      if (!anchor) return;
      const sps      = byZone.get(zone) ?? [];
      const healthy  = sps.filter(p => p.health === "Healthy").length;
      const allOk    = healthy === sps.length && sps.length > 0;
      const partial  = healthy > 0 && healthy < sps.length;

      const dotColor = allOk ? "#22c55e" : partial ? "#f59e0b" : "#ef4444";
      const ringColor = allOk ? "rgba(34,197,94,0.3)" : partial ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)";

      // Custom marker element
      const el = document.createElement("div");
      el.style.cssText = `
        position: relative;
        width: ${44 + sps.length}px;
        height: ${44 + sps.length}px;
        cursor: pointer;
      `;
      el.innerHTML = `
        <div style="
          position: absolute; inset: 0;
          border-radius: 50%;
          background: ${ringColor};
          animation: shelby-map-pulse 2.5s ease-in-out infinite;
        "></div>
        <div style="
          position: absolute; inset: 6px;
          border-radius: 50%;
          background: rgba(6,20,45,0.92);
          border: 2px solid ${dotColor};
          display: flex; align-items: center; justify-content: center;
          flex-direction: column;
          box-shadow: 0 0 16px ${dotColor}55, inset 0 0 8px rgba(6,182,212,0.08);
        ">
          <span style="
            font-size: ${sps.length >= 10 ? 13 : 16}px;
            font-weight: 800;
            color: #fff;
            font-family: monospace;
            line-height: 1;
          ">${sps.length}</span>
          <span style="
            font-size: 7px;
            color: ${dotColor};
            font-weight: 700;
            letter-spacing: 0.05em;
            margin-top: 1px;
          ">SP${sps.length > 1 ? "s" : ""}</span>
        </div>
        <style>
          @keyframes shelby-map-pulse {
            0%, 100% { transform: scale(1); opacity: 0.7; }
            50% { transform: scale(1.12); opacity: 1; }
          }
        </style>
      `;

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect();
        setTooltip({
          zone,
          providers: sps,
          anchor: {
            x: rect.left - (containerRect?.left ?? 0) + rect.width / 2,
            y: rect.top  - (containerRect?.top  ?? 0),
          },
        });
      });

      const marker = new ml.Marker({ element: el, anchor: "center" })
        .setLngLat([anchor.lng, anchor.lat])
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Close tooltip when clicking map background
    const handleMapClick = () => setTooltip(null);
    map.on("click", handleMapClick);
    return () => { map.off("click", handleMapClick); };
  }, [ready, providers]); // eslint-disable-line

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 340 }}>
      {/* Map container */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Error fallback */}
      {error && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#060d1a", color: "#64748b", fontSize: 13,
        }}>
          Map unavailable: {error}
        </div>
      )}

      {/* Loading */}
      {!ready && !error && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#060d1a", color: "#475569", fontSize: 13,
          flexDirection: "column", gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            border: "2px solid #1e3a5f", borderTopColor: "#06b6d4",
            animation: "shelby-spin 1s linear infinite",
          }} />
          <style>{`@keyframes shelby-spin{to{transform:rotate(360deg)}}`}</style>
          Loading map…
        </div>
      )}

      {/* Zone tooltip */}
      {tooltip && (
        <ZoneTooltip
          zone={tooltip.zone}
          providers={tooltip.providers}
          anchor={tooltip.anchor}
          onClose={() => setTooltip(null)}
        />
      )}

      {/* SP count badge */}
      {providers.length > 0 && (
        <div style={{
          position: "absolute", bottom: 12, left: 12, zIndex: 10,
          background: "rgba(6,14,28,0.85)", border: "1px solid rgba(6,182,212,0.25)",
          borderRadius: 8, padding: "4px 12px", fontSize: 11, color: "#94a3b8",
          backdropFilter: "blur(8px)",
        }}>
          {providers.length} Storage Providers
          &nbsp;·&nbsp;
          <span style={{ color: "#22c55e" }}>
            {providers.filter(p => p.health === "Healthy").length} Healthy
          </span>
        </div>
      )}

      {/* VN Sovereignty */}
      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 10,
        background: "rgba(6,14,28,0.85)", border: "1px solid rgba(217,119,6,0.3)",
        borderRadius: 7, padding: "3px 10px", fontSize: 9, color: "#92400e",
        backdropFilter: "blur(8px)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>
    </div>
  );
}