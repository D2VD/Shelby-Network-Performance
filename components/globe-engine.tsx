"use client";
/**
 * components/globe-engine.tsx — v9.0
 *
 * Fixes vs v8:
 *  1. Globe fully visible — wrapper is position:absolute inset:0
 *  2. Pink continents — polygonsData with TopoJSON (no hex texture)
 *  3. Starfield — injected via CSS radial-gradients on .globe-engine-wrap
 *  4. SP marker animation — scale-in overshoot on appear, via CSS keyframes
 *  5. Sovereignty markers — text label only on globe (no gold squares)
 *  6. Drag direction — ctrl.rotateSpeed = -0.7 (right drag → globe right)
 *  7. Arc fan-out preserved, pink arc color #ff77c9
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";

interface GlobeEngineProps {
  providers: StorageProvider[];
  network: "shelbynet" | "testnet";
  accentColor: string;
  onProviderClick?: (provider: StorageProvider) => void;
}

interface BlobEventArc {
  id: string;
  startLat: number; startLng: number;
  endLat: number;   endLng: number;
  color: string[];
  stroke: number;
  arcAlt: number;
  dashAnimTime: number;
}

const SOVEREIGNTY_LABELS = [
  { lat: 16.5,  lng: 112.0,  text: "🇻🇳 Hoàng Sa (VN)" },
  { lat: 10.0,  lng: 114.17, text: "🇻🇳 Trường Sa (VN)" },
];

const ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  dc_asia:      { lat:  1.35, lng: 103.82 },
  dc_australia: { lat: -33.87, lng: 151.21 },
  dc_europe:    { lat: 50.11, lng:   8.68 },
  dc_us_east:   { lat: 39.04, lng: -77.44 },
  dc_us_west:   { lat: 37.34, lng:-121.89 },
};

const FALLBACK_ORIGINS = [
  { lat: 51.51,  lng:  -0.13 },
  { lat: 35.68,  lng: 139.65 },
  { lat: 37.77,  lng:-122.42 },
  { lat: 40.71,  lng: -74.01 },
  { lat: -23.55, lng: -46.63 },
  { lat: 28.61,  lng:  77.21 },
  { lat: 52.52,  lng:  13.40 },
  { lat:  1.35,  lng: 103.82 },
];

const CORE_CONTRACT =
  "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

async function fetchRecentBlobEvents() {
  try {
    const r = await fetch("/api/network/transactions?network=shelbynet&cursor=0", {
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) return [];
    const j = await r.json() as any;
    return (j?.txs ?? []).slice(0, 20) as Array<{ sender: string; version: string }>;
  } catch { return []; }
}

function ownerToLatLng(owner: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < Math.min(owner.length, 20); i++) h += owner.charCodeAt(i);
  return FALLBACK_ORIGINS[h % FALLBACK_ORIGINS.length];
}

function jitter(lat: number, lng: number, idx: number, total: number) {
  if (total <= 1) return { lat, lng };
  const angle  = (idx / total) * 2 * Math.PI;
  const radius = 2.0 + (idx % 4) * 0.5;
  return { lat: lat + radius * Math.sin(angle), lng: lng + radius * Math.cos(angle) };
}

function clusterProviders(providers: StorageProvider[]) {
  const byZone = new Map<string, StorageProvider[]>();
  providers.forEach(p => {
    const z = p.availabilityZone ?? "unknown";
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  });
  const result: Array<StorageProvider & { clLat: number; clLng: number }> = [];
  byZone.forEach((list, zone) => {
    const anchor = ZONE_ANCHORS[zone];
    list.forEach((p, idx) => {
      let lat = p.geo?.lat ?? anchor?.lat ?? 0;
      let lng = p.geo?.lng ?? anchor?.lng ?? 0;
      const dupes = list.filter(
        o =>
          Math.abs((o.geo?.lat ?? 0) - lat) < 0.01 &&
          Math.abs((o.geo?.lng ?? 0) - lng) < 0.01
      );
      if (dupes.length > 1 && anchor) {
        const j = jitter(anchor.lat, anchor.lng, idx, list.length);
        lat = j.lat; lng = j.lng;
      }
      result.push({ ...p, clLat: lat, clLng: lng });
    });
  });
  return result;
}

// ── CDN loader ─────────────────────────────────────────────────────────────
const GLOBE_CDN =
  "https://cdn.jsdelivr.net/npm/globe.gl@2.34.2/dist/globe.gl.min.js";
let _loaded = false;
let _loading = false;
const _cbs: Array<() => void> = [];
function loadGlobe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (_loaded) { resolve(); return; }
    _cbs.push(resolve);
    if (_loading) return;
    _loading = true;
    const s = document.createElement("script");
    s.src = GLOBE_CDN; s.async = true;
    s.onload  = () => { _loaded = true; _cbs.forEach(cb => cb()); _cbs.length = 0; };
    s.onerror = () => reject(new Error("globe.gl CDN load failed"));
    document.head.appendChild(s);
  });
}

// ── World TopoJSON countries (cached) ──────────────────────────────────────
let _worldFeatures: any[] | null = null;
async function loadWorldCountries(): Promise<any[]> {
  if (_worldFeatures) return _worldFeatures;
  try {
    const topo = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
    ).then(r => r.json()) as any;
    // topojson-client is bundled with globe.gl; access via window
    const topojson = (window as any).topojson;
    const geo = topojson
      ? topojson.feature(topo, topo.objects.countries).features
      : [];
    _worldFeatures = geo;
    return geo;
  } catch { return []; }
}

// ── Inject CSS once ────────────────────────────────────────────────────────
const STYLE_ID = "globe-engine-v9";
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
.globe-engine-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(1px 1px at  7% 11%, rgba(255,255,255,.70) 0%, transparent 100%),
    radial-gradient(1px 1px at 14% 48%, rgba(255,255,255,.50) 0%, transparent 100%),
    radial-gradient(2px 2px at 23% 19%, rgba(255,255,255,.65) 0%, transparent 100%),
    radial-gradient(1px 1px at 31% 72%, rgba(255,255,255,.45) 0%, transparent 100%),
    radial-gradient(1px 1px at 42% 36%, rgba(255,255,255,.55) 0%, transparent 100%),
    radial-gradient(2px 2px at 55% 82%, rgba(255,255,255,.60) 0%, transparent 100%),
    radial-gradient(1px 1px at 63% 27%, rgba(255,255,255,.48) 0%, transparent 100%),
    radial-gradient(1px 1px at 71% 61%, rgba(255,255,255,.52) 0%, transparent 100%),
    radial-gradient(2px 2px at 78% 14%, rgba(255,255,255,.65) 0%, transparent 100%),
    radial-gradient(1px 1px at 85% 79%, rgba(255,255,255,.45) 0%, transparent 100%),
    radial-gradient(1px 1px at 91% 43%, rgba(255,255,255,.55) 0%, transparent 100%),
    radial-gradient(1px 1px at 96% 91%, rgba(255,255,255,.40) 0%, transparent 100%),
    radial-gradient(1px 1px at  4% 87%, rgba(255,255,255,.48) 0%, transparent 100%),
    radial-gradient(1px 1px at 48% 95%, rgba(255,255,255,.42) 0%, transparent 100%),
    radial-gradient(1px 1px at 17% 33%, rgba(255,255,255,.38) 0%, transparent 100%),
    radial-gradient(1px 1px at 37% 58%, rgba(255,255,255,.35) 0%, transparent 100%),
    radial-gradient(1px 1px at 66% 47%, rgba(255,255,255,.38) 0%, transparent 100%),
    radial-gradient(1px 1px at 83% 23%, rgba(255,255,255,.40) 0%, transparent 100%),
    #070e1a;
}
@keyframes markerScaleIn {
  0%   { transform: scale(0);    opacity: 0; }
  60%  { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1);    opacity: 1; }
}
.globe-sp-marker {
  animation: markerScaleIn 0.38s cubic-bezier(0.34,1.56,0.64,1) forwards;
  cursor: pointer;
  will-change: transform, opacity;
}
.globe-sp-marker:hover .sp-diamond {
  transform: rotate(45deg) scale(1.5) !important;
  filter: brightness(1.4);
}
@keyframes sovFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.globe-sov-label {
  animation: sovFadeIn 0.5s ease forwards;
  pointer-events: none;
}
`;
  document.head.appendChild(s);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function GlobeEngine({
  providers, network, accentColor, onProviderClick,
}: GlobeEngineProps) {
  const mountRef  = useRef<HTMLDivElement>(null);
  const globeRef  = useRef<any>(null);

  const [status,    setStatus]    = useState<"loading" | "ready" | "error">("loading");
  const [errMsg,    setErrMsg]    = useState("");
  const [arcs,      setArcs]      = useState<BlobEventArc[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [hovered,   setHovered]   = useState<{
    addr: string; az: string; health: string; city: string;
  } | null>(null);

  // Arc builder
  const buildArcs = useCallback(async (clustered: ReturnType<typeof clusterProviders>) => {
    if (!clustered.length) return;
    const events  = await fetchRecentBlobEvents();
    const healthy = clustered.filter(p => p.health === "Healthy");
    if (!healthy.length) return;

    let built: BlobEventArc[];
    if (events.length > 0) {
      built = events.slice(0, 12).flatMap((ev: any, ei: number) => {
        const origin = ownerToLatLng(ev.sender ?? "");
        return [0, 1, 2].map(fi => {
          const sp = healthy[(ei * 7 + fi * 3) % healthy.length];
          return {
            id:           `${ev.version}_${fi}`,
            startLat:     origin.lat, startLng: origin.lng,
            endLat:       sp.clLat,   endLng:   sp.clLng,
            color:        fi < 2 ? ["#ff77c977","#ff77c9cc"] : ["#ffb3e044","#ffb3e077"],
            stroke:       fi < 2 ? 0.5 : 0.25,
            arcAlt:       0.15 + (ei % 5) * 0.05 + fi * 0.02,
            dashAnimTime: 1500 + ei * 80 + fi * 40,
          };
        });
      });
      setLiveCount(events.length);
    } else {
      built = FALLBACK_ORIGINS.slice(0, 4).flatMap((o, oi) =>
        healthy.slice(0, 16).map((sp, si) => ({
          id: `sim_${oi}_${si}`,
          startLat: o.lat, startLng: o.lng,
          endLat: sp.clLat, endLng: sp.clLng,
          color:  si < 10 ? ["#ff77c955","#ff77c9aa"] : ["#ffb3e022","#ffb3e066"],
          stroke: si < 10 ? 0.4 : 0.2,
          arcAlt: 0.14 + (si % 5) * 0.04,
          dashAnimTime: 1800 + oi * 150,
        }))
      );
    }
    setArcs(built);
  }, []);

  useEffect(() => {
    const cl = clusterProviders(providers);
    buildArcs(cl);
    const id = setInterval(() => buildArcs(clusterProviders(providers)), 10_000);
    return () => clearInterval(id);
  }, [providers, buildArcs]);

  // Build HTML element data array
  const buildHtmlData = useCallback(() => {
    const cl = clusterProviders(providers);
    const spItems = cl
      .filter(p => p.clLat !== 0 || p.clLng !== 0)
      .map(p => ({ lat: p.clLat, lng: p.clLng, type: "sp", provider: p }));
    const sovItems = SOVEREIGNTY_LABELS.map(s => ({
      lat: s.lat, lng: s.lng, type: "sovereignty", text: s.text, provider: null,
    }));
    return [...spItems, ...sovItems];
  }, [providers]);

  // Create HTML element for each datum
  const makeEl = useCallback((d: any): HTMLElement => {
    const el = document.createElement("div");

    if (d.type === "sovereignty") {
      // Text-only: no square marker on globe
      el.className = "globe-sov-label";
      el.innerHTML = `
        <span style="
          font-size:9px;font-family:monospace;font-weight:700;letter-spacing:0.03em;
          color:#fde68a;
          text-shadow:0 0 8px rgba(0,0,0,0.95),0 0 3px rgba(0,0,0,0.9);
          background:rgba(0,0,0,0.5);
          padding:2px 6px;border-radius:4px;
          border:1px solid rgba(251,191,36,0.4);
          white-space:nowrap;
        ">${d.text}</span>
      `;
      return el;
    }

    const p     = d.provider as StorageProvider & { clLat: number; clLng: number };
    const color =
      p.health === "Healthy"       ? "#ff77c9"
      : p.state  === "Waitlisted"  ? "#f59e0b"
      : p.state  === "Frozen"      ? "#60a5fa"
      : "#ef4444";
    const size  = p.health === "Healthy" ? 10 : 7;

    el.className = "globe-sp-marker";
    el.innerHTML = `
      <div class="sp-diamond" style="
        width:${size}px;height:${size}px;
        background:${color};
        transform:rotate(45deg);
        box-shadow:0 0 ${size + 2}px ${color}99;
        border:1px solid rgba(255,255,255,0.25);
        transition:transform 0.15s ease,box-shadow 0.15s ease,filter 0.15s ease;
      "></div>
    `;

    el.addEventListener("mouseenter", () =>
      setHovered({
        addr:   p.addressShort ?? (p.address?.slice(0, 8) + "…" + p.address?.slice(-6)),
        az:     p.availabilityZone ?? "",
        health: p.health as string,
        city:   p.geo?.city ? `${p.geo.city}${p.geo.countryCode ? ", " + p.geo.countryCode : ""}` : "",
      })
    );
    el.addEventListener("mouseleave", () => setHovered(null));
    el.addEventListener("click",      () => onProviderClick?.(p));
    return el;
  }, [providers, onProviderClick]);

  // Globe initialisation
  useEffect(() => {
    if (!mountRef.current) return;
    let active = true;
    injectStyles();

    (async () => {
      try {
        await loadGlobe();
        if (!active || !mountRef.current) return;

        const GlobeGL = (window as any).Globe;
        if (typeof GlobeGL !== "function") throw new Error("Globe not on window");

        const el = mountRef.current;

        // Load country polygons for pink land
        const countries = await loadWorldCountries();

        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth   || 800)
          .height(el.clientHeight || 600)
          .backgroundColor("rgba(0,0,0,0)")
          // ── Pink land polygons ──────────────────────────────────
          .polygonsData(countries)
          .polygonCapColor(() => "rgba(255, 100, 180, 0.78)")
          .polygonSideColor(() => "rgba(220, 60, 150, 0.18)")
          .polygonStrokeColor(() => "rgba(255, 140, 210, 0.45)")
          .polygonAltitude(0.005)
          // ── Atmosphere (pink glow) ──────────────────────────────
          .showAtmosphere(true)
          .atmosphereColor("#ff88cc")
          .atmosphereAltitude(0.18)
          // ── HTML elements (SP markers + sovereignty labels) ─────
          .htmlElementsData(buildHtmlData())
          .htmlLat("lat").htmlLng("lng").htmlAltitude(0.015)
          .htmlElement((d: any) => makeEl(d))
          // ── Arcs ────────────────────────────────────────────────
          .arcsData(arcs)
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color").arcStroke("stroke").arcAltitude("arcAlt")
          .arcDashLength(0.28).arcDashGap(0.1)
          .arcDashAnimateTime("dashAnimTime")
          .pointOfView({ lat: 20, lng: 10, altitude: 1.85 }, 1200);

        globe.onGlobeReady(() => { if (active) setStatus("ready"); });
        setTimeout(() => { if (active) setStatus(s => s === "loading" ? "ready" : s); }, 8_000);

        // Controls
        const ctrl = globe.controls();
        ctrl.autoRotate      = true;
        ctrl.autoRotateSpeed = 0.25;
        ctrl.enableDamping   = true;
        ctrl.dampingFactor   = 0.08;
        // DRAG FIX: negative rotateSpeed → drag-right rotates globe right
        ctrl.rotateSpeed     = -0.7;

        globeRef.current = globe;

        const ro = new ResizeObserver(entries => {
          for (const e of entries)
            globe.width(e.contentRect.width).height(e.contentRect.height);
        });
        ro.observe(el);
      } catch (e: any) {
        if (active) { setErrMsg(String(e?.message ?? e)); setStatus("error"); }
      }
    })();

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh HTML elements when providers change
  useEffect(() => {
    if (!globeRef.current) return;
    globeRef.current
      .htmlElementsData(buildHtmlData())
      .htmlElement((d: any) => makeEl(d));
  }, [providers, buildHtmlData, makeEl]);

  // Refresh arcs
  useEffect(() => {
    globeRef.current?.arcsData(arcs);
  }, [arcs]);

  return (
    // position:absolute inset:0 ensures the globe always fills its parent fully
    <div className="globe-engine-wrap">
      {/* Globe mount */}
      <div
        ref={mountRef}
        style={{
          width: "100%", height: "100%",
          opacity: status === "ready" ? 1 : 0,
          transition: "opacity 1s ease",
        }}
      />

      {/* Loading spinner */}
      {status === "loading" && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 14, color: "#ff77c9",
          fontFamily: "monospace", fontSize: 13,
        }}>
          <style>{`@keyframes _gs{to{transform:rotate(360deg)}}`}</style>
          <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
            <circle cx="19" cy="19" r="15" stroke="#2e1a2e" strokeWidth="2"/>
            <circle cx="19" cy="19" r="15" stroke="#ff77c9" strokeWidth="2"
              strokeDasharray="24 70" strokeLinecap="round"
              style={{ transformOrigin:"19px 19px", animation:"_gs 1.1s linear infinite" }}/>
          </svg>
          Loading globe…
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 8, color: "#64748b", fontSize: 12, textAlign: "center", padding: "0 24px",
        }}>
          <span style={{ fontSize: 24 }}>⚠</span>
          <span style={{ color: "#94a3b8" }}>Globe failed to load</span>
          <span style={{ fontSize: 10, color: "#475569", maxWidth: 300 }}>{errMsg}</span>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8, padding: "5px 14px", borderRadius: 7,
              border: "1px solid #1e3a6e", background: "#0c1a2e",
              color: "#ff77c9", cursor: "pointer", fontSize: 11,
            }}
          >Retry</button>
        </div>
      )}

      {/* Hover detail panel */}
      {status === "ready" && hovered && (
        <div style={{
          position: "absolute", bottom: 56, left: 12, zIndex: 30,
          background: "rgba(7,14,26,0.95)",
          border: "1px solid rgba(255,119,201,0.3)", borderRadius: 10,
          padding: "9px 13px", fontFamily: "monospace", fontSize: 11,
          color: "#e2e8f0", backdropFilter: "blur(8px)", pointerEvents: "none",
          minWidth: 170,
        }}>
          <div style={{ color: "#ff77c9", fontWeight: 700, marginBottom: 3 }}>{hovered.addr}</div>
          <div style={{ color: "#94a3b8" }}>{hovered.az}</div>
          {hovered.city && <div style={{ color: "#64748b", fontSize: 10 }}>{hovered.city}</div>}
          <div style={{
            marginTop: 4, fontWeight: 700,
            color: hovered.health === "Healthy" ? "#34d399" : "#f87171",
          }}>{hovered.health}</div>
        </div>
      )}

      {/* Node count badge */}
      {status === "ready" && providers.length > 0 && (
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{
            fontSize: 11, fontFamily: "monospace",
            background: "rgba(7,14,26,0.88)",
            border: "1px solid rgba(255,119,201,0.25)", borderRadius: 8,
            padding: "4px 10px", color: "#ff77c9", backdropFilter: "blur(8px)",
          }}>
            {providers.length} nodes online
          </div>
          <div style={{
            fontSize: 9, fontFamily: "monospace",
            background: "rgba(7,14,26,0.8)",
            border: `1px solid ${liveCount > 0 ? "#065f46" : "rgba(255,119,201,0.12)"}`,
            borderRadius: 6, padding: "3px 8px",
            color: liveCount > 0 ? "#34d399" : "#475569",
          }}>
            {liveCount > 0 ? `● ${liveCount} live events` : "○ simulated arcs"}
          </div>
        </div>
      )}

      {/* Legend */}
      {status === "ready" && (
        <div style={{
          position: "absolute", bottom: 36, left: 12, zIndex: 10,
          display: "flex", gap: 10, alignItems: "center",
          fontSize: 9, fontFamily: "monospace", color: "#64748b",
          background: "rgba(7,14,26,0.8)",
          border: "1px solid rgba(255,119,201,0.15)", borderRadius: 6,
          padding: "4px 10px", backdropFilter: "blur(8px)",
        }}>
          {[
            { color: "#ff77c9", label: "Healthy" },
            { color: "#f59e0b", label: "Waitlisted" },
            { color: "#60a5fa", label: "Frozen" },
            { color: "#ef4444", label: "Faulty" },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{
                display: "inline-block", width: 7, height: 7,
                background: color, transform: "rotate(45deg)",
              }}/>
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Sovereignty text badge */}
      <div style={{
        position: "absolute", bottom: 12, right: 12, zIndex: 10,
        fontSize: 9, fontFamily: "monospace",
        background: "rgba(7,14,26,0.85)",
        border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6,
        padding: "4px 9px", color: "#fde68a",
        backdropFilter: "blur(8px)", pointerEvents: "none",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      <div style={{
        position: "absolute", bottom: 14, left: "50%",
        transform: "translateX(-50%)", zIndex: 10,
        fontSize: 9, fontFamily: "monospace", color: "#1e293b",
        pointerEvents: "none",
      }}>
        drag · scroll · hover
      </div>
    </div>
  );
}