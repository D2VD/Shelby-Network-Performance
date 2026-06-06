"use client";
/**
 * components/globe-engine.tsx — v8.0
 *
 * CHANGES vs v7.0:
 *  1. Switch from pointsData → htmlElementsData for square diamond markers
 *  2. Starfield CSS background (dark mode) — no WebGL dependency
 *  3. Combined SP + sovereignty markers in one htmlElementsData array
 *  4. Hover detail panel showing SP address, AZ, health, geo city
 *  5. Arc fan-out preserved from v7 (real blob events → multiple SPs)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

interface GlobeEngineProps {
  providers:        StorageProvider[];
  network:          "shelbynet" | "testnet";
  accentColor:      string;
  onProviderClick?: (provider: StorageProvider) => void;
}

interface BlobEventArc {
  id: string; startLat: number; startLng: number; endLat: number; endLng: number;
  color: string[]; stroke: number; arcAlt: number; dashAnimTime: number; isReal: boolean;
}

// ── Sovereignty markers ────────────────────────────────────────────────────────
const SOVEREIGNTY = [
  { lat: 16.5,  lng: 112.0,  label: "Hoàng Sa (VN)", flag: "🇻🇳" },
  { lat: 10.0,  lng: 114.17, label: "Trường Sa (VN)", flag: "🇻🇳" },
];

const ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  dc_asia:      { lat:   1.35, lng: 103.82 },
  dc_australia: { lat: -33.87, lng: 151.21 },
  dc_europe:    { lat:  50.11, lng:   8.68 },
  dc_us_east:   { lat:  39.04, lng: -77.44 },
  dc_us_west:   { lat:  37.34, lng:-121.89 },
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

const CORE_SHELBYNET = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const INDEXER_URL    = "https://api.shelbynet.shelby.xyz/v1/graphql";

async function fetchRecentBlobEvents(): Promise<Array<{ owner: string; ts: string }>> {
  try {
    const r = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `{
        account_transactions(
          where: { account_address: { _eq: "${CORE_SHELBYNET}" } }
          order_by: { transaction_version: desc }
          limit: 20
        ) { account_address transaction_version }
      }` }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) return [];
    const j = await r.json() as any;
    return (j?.data?.account_transactions ?? []).map((t: any) => ({ owner: t.account_address, ts: String(t.transaction_version) }));
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
  byZone.forEach((zProviders, zone) => {
    const anchor = ZONE_ANCHORS[zone];
    zProviders.forEach((p, idx) => {
      let lat = p.geo?.lat ?? anchor?.lat ?? 0;
      let lng = p.geo?.lng ?? anchor?.lng ?? 0;
      const sameCoord = zProviders.filter(
        o => Math.abs((o.geo?.lat ?? 0) - lat) < 0.01 && Math.abs((o.geo?.lng ?? 0) - lng) < 0.01
      );
      if (sameCoord.length > 1 && anchor) {
        const j = jitter(anchor.lat, anchor.lng, idx, zProviders.length);
        lat = j.lat; lng = j.lng;
      }
      result.push({ ...p, clLat: lat, clLng: lng });
    });
  });
  return result;
}

// ── CDN loader ────────────────────────────────────────────────────────────────
const GLOBE_CDN = "https://cdn.jsdelivr.net/npm/globe.gl@2.34.2/dist/globe.gl.min.js";
let _loaded = false, _loading = false;
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
    s.onerror = () => reject(new Error("CDN load failed"));
    document.head.appendChild(s);
  });
}

// ── Build hex dot texture ─────────────────────────────────────────────────────
function buildHexDotTexture(): string {
  const W = 2048, H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0c1a2e";
  ctx.fillRect(0, 0, W, H);
  const hexR = 9, spacing = hexR * 3.2, rowH = spacing * Math.sqrt(3) / 2, dotR = hexR * 0.55;
  let row = 0;
  for (let y = 0; y < H + rowH; y += rowH) {
    const xOffset = (row % 2) * (spacing / 2);
    for (let x = xOffset; x < W + spacing; x += spacing) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const px = x + dotR * Math.cos(angle), py = y + dotR * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "#2060c0";
      ctx.fill();
    }
    row++;
  }
  return canvas.toDataURL("image/png");
}

// ── Starfield CSS (dark mode background) ─────────────────────────────────────
function injectStarfieldStyles(containerId: string) {
  const id = "globe-engine-stars";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    #${containerId} { position: relative; overflow: hidden; }
    #${containerId}::before {
      content: '';
      position: absolute; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,0.55) 0%, transparent 100%),
        radial-gradient(1px 1px at 25% 40%, rgba(255,255,255,0.45) 0%, transparent 100%),
        radial-gradient(1.5px 1.5px at 40% 20%, rgba(255,255,255,0.6)  0%, transparent 100%),
        radial-gradient(1px 1px at 55% 60%, rgba(255,255,255,0.4)  0%, transparent 100%),
        radial-gradient(1px 1px at 70% 30%, rgba(255,255,255,0.5)  0%, transparent 100%),
        radial-gradient(1.5px 1.5px at 80% 75%, rgba(255,255,255,0.55) 0%, transparent 100%),
        radial-gradient(1px 1px at 90% 10%, rgba(255,255,255,0.4)  0%, transparent 100%),
        radial-gradient(1px 1px at 15% 80%, rgba(255,255,255,0.45) 0%, transparent 100%),
        radial-gradient(1px 1px at 60% 90%, rgba(255,255,255,0.35) 0%, transparent 100%),
        radial-gradient(1px 1px at 35% 65%, rgba(255,255,255,0.5)  0%, transparent 100%);
    }
  `;
  document.head.appendChild(style);
}

// ── Hover detail panel data ───────────────────────────────────────────────────
interface HoveredSP {
  addressShort: string;
  az:           string;
  health:       string;
  city:         string;
  country:      string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GlobeEngine({ providers, network, accentColor, onProviderClick }: GlobeEngineProps) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const globeRef    = useRef<any>(null);
  const containerId = useRef(`globe-engine-${Math.random().toString(36).slice(2, 7)}`);

  const [status,         setStatus]         = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg,       setErrorMsg]        = useState("");
  const [eventArcs,      setEventArcs]       = useState<BlobEventArc[]>([]);
  const [lastEventCount, setLastEventCount]  = useState(0);
  const [hoveredSP,      setHoveredSP]       = useState<HoveredSP | null>(null);

  // ── Arc builder ─────────────────────────────────────────────────────────────
  const buildRealArcs = useCallback(async (clustered: ReturnType<typeof clusterProviders>) => {
    if (clustered.length === 0) return;
    const events = await fetchRecentBlobEvents();
    const healthy = clustered.filter(p => p.health === "Healthy");
    if (healthy.length === 0) return;

    let arcs: BlobEventArc[];
    if (events.length > 0) {
      arcs = events.slice(0, 12).flatMap((ev, evIdx) => {
        const origin      = ownerToLatLng(ev.owner);
        const targetCount = Math.min(3, healthy.length);
        return Array.from({ length: targetCount }, (_, fanIdx) => {
          const spIdx  = (evIdx * 7 + fanIdx * 3) % healthy.length;
          const sp     = healthy[spIdx];
          const isData = fanIdx < 2;
          return {
            id:           `${ev.ts}_${fanIdx}`,
            startLat:     origin.lat, startLng: origin.lng,
            endLat:       sp.clLat,  endLng:   sp.clLng,
            color:        isData ? ["#2563eb88","#2563ebcc"] : ["#93c5fd44","#93c5fd77"],
            stroke:       isData ? 0.5 : 0.25,
            arcAlt:       0.15 + (evIdx % 5) * 0.05 + fanIdx * 0.02,
            dashAnimTime: 1500 + evIdx * 80 + fanIdx * 40,
            isReal:       true,
          };
        });
      });
      setLastEventCount(events.length);
    } else {
      arcs = FALLBACK_ORIGINS.slice(0, 4).flatMap((origin, oi) =>
        healthy.slice(0, Math.min(healthy.length, 16)).map((sp, si) => ({
          id:           `sim_${oi}_${si}`,
          startLat:     origin.lat, startLng: origin.lng,
          endLat:       sp.clLat,  endLng:   sp.clLng,
          color:        si < 10 ? ["#2563eb55","#2563ebaa"] : ["#93c5fd22","#93c5fd66"],
          stroke:       si < 10 ? 0.4 : 0.2,
          arcAlt:       0.14 + (si % 5) * 0.04,
          dashAnimTime: 1800 + oi * 150,
          isReal:       false,
        }))
      );
    }
    setEventArcs(arcs);
  }, []);

  useEffect(() => {
    const clustered = clusterProviders(providers);
    buildRealArcs(clustered);
    const id = setInterval(() => buildRealArcs(clusterProviders(providers)), 10_000);
    return () => clearInterval(id);
  }, [providers, buildRealArcs]);

  // ── Build HTML element for each SP (square diamond marker) ────────────────
  const buildHtmlElements = useCallback(() => {
    const clustered = clusterProviders(providers);

    // SP markers
    const spMarkers = clustered.filter(p => p.clLat !== 0 || p.clLng !== 0).map(p => ({
      lat:      p.clLat,
      lng:      p.clLng,
      type:     "sp" as const,
      provider: p,
    }));

    // Sovereignty markers
    const sovMarkers = SOVEREIGNTY.map(s => ({
      lat:      s.lat,
      lng:      s.lng,
      type:     "sovereignty" as const,
      label:    s.label,
      flag:     s.flag,
      provider: null,
    }));

    return [...spMarkers, ...sovMarkers];
  }, [providers]);

  const makeHtmlEl = useCallback((d: any): HTMLElement => {
    const el = document.createElement("div");
    el.style.cssText = "pointer-events: auto; cursor: pointer; position: relative;";

    if (d.type === "sovereignty") {
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:4px;white-space:nowrap;pointer-events:none">
          <div style="width:8px;height:8px;background:#fbbf24;transform:rotate(45deg);box-shadow:0 0 8px #fbbf24;flex-shrink:0"></div>
          <span style="font-size:9px;font-family:monospace;color:#fde68a;font-weight:700;text-shadow:0 0 10px rgba(0,0,0,0.9)">${d.flag} ${d.label}</span>
        </div>`;
      return el;
    }

    const p     = d.provider as StorageProvider & { clLat: number; clLng: number };
    const color = p.health === "Healthy" ? "#38bdf8" : p.state === "Frozen" ? "#60a5fa" : "#ef4444";
    const size  = p.health === "Healthy" ? 10 : 7;
    const city  = p.geo?.city ?? "";
    const cc    = p.geo?.countryCode ?? "";

    el.innerHTML = `
      <div style="
        width:${size}px;height:${size}px;
        background:${color};
        transform:rotate(45deg);
        box-shadow:0 0 ${p.health==="Healthy"?8:4}px ${color}aa;
        border:1px solid rgba(255,255,255,0.3);
        transition:transform 0.15s,box-shadow 0.15s;
      "></div>`;

    el.addEventListener("mouseenter", () => {
      (el.firstElementChild as HTMLElement).style.transform = "rotate(45deg) scale(1.5)";
      (el.firstElementChild as HTMLElement).style.boxShadow = `0 0 14px ${color}cc`;
      setHoveredSP({
        addressShort: p.addressShort,
        az:           p.availabilityZone,
        health:       p.health,
        city:         city,
        country:      cc,
      });
    });
    el.addEventListener("mouseleave", () => {
      (el.firstElementChild as HTMLElement).style.transform = "rotate(45deg)";
      (el.firstElementChild as HTMLElement).style.boxShadow = `0 0 ${p.health==="Healthy"?8:4}px ${color}aa`;
      setHoveredSP(null);
    });
    el.addEventListener("click", () => {
      if (onProviderClick) onProviderClick(p);
    });

    return el;
  }, [providers, onProviderClick]);

  // ── Globe init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    let active = true;

    (async () => {
      try {
        await loadGlobe();
        if (!active || !mountRef.current) return;

        const GlobeGL = (window as any).Globe;
        if (typeof GlobeGL !== "function") throw new Error("Globe not found after CDN load");

        const el = mountRef.current;
        el.id = containerId.current;
        injectStarfieldStyles(containerId.current);

        const hexTexture = buildHexDotTexture();

        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth  || 700)
          .height(el.clientHeight || 500)
          .backgroundColor("rgba(0,0,0,0)")
          .globeImageUrl(hexTexture)
          .showAtmosphere(true)
          .atmosphereColor("#3b82f6")
          .atmosphereAltitude(0.18)
          // ── HTML element markers (SP squares + sovereignty diamonds) ──────
          .htmlElementsData(buildHtmlElements())
          .htmlLat("lat")
          .htmlLng("lng")
          .htmlAltitude(0.015)
          .htmlElement((d: any) => makeHtmlEl(d))
          // ── Arcs ──────────────────────────────────────────────────────────
          .arcsData(eventArcs)
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color")
          .arcStroke("stroke")
          .arcAltitude("arcAlt")
          .arcDashLength(0.28)
          .arcDashGap(0.1)
          .arcDashAnimateTime("dashAnimTime")
          .pointOfView({ lat: 20, lng: 30, altitude: 1.9 }, 1200);

        globe.onGlobeReady(() => {
          if (!active) return;
          setStatus("ready");
        });
        setTimeout(() => { if (active) setStatus(s => s === "loading" ? "ready" : s); }, 7000);

        const ctrl = globe.controls();
        ctrl.autoRotate      = true;
        ctrl.autoRotateSpeed = 0.28;
        ctrl.enableDamping   = true;
        ctrl.dampingFactor   = 0.08;

        globeRef.current = globe;

        const ro = new ResizeObserver(entries => {
          for (const e of entries) globe.width(e.contentRect.width).height(e.contentRect.height);
        });
        ro.observe(el);
      } catch (err: any) {
        if (active) { setErrorMsg(err?.message ?? String(err)); setStatus("error"); }
      }
    })();

    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Refresh HTML elements when providers change ────────────────────────────
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.htmlElementsData(buildHtmlElements());
    g.htmlElement((d: any) => makeHtmlEl(d));
  }, [providers, buildHtmlElements, makeHtmlEl]);

  // ── Refresh arcs ────────────────────────────────────────────────────────────
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.arcsData(eventArcs);
  }, [eventArcs]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#070e1a", overflow: "hidden" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%", opacity: status === "ready" ? 1 : 0, transition: "opacity 0.8s" }} />

      {/* Loading */}
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "#070e1a", color: "#38bdf8", fontFamily: "monospace", fontSize: 13 }}>
          <style>{`@keyframes _gs2{to{transform:rotate(360deg)}}`}</style>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="#1e3a6e" strokeWidth="2"/>
            <circle cx="18" cy="18" r="14" stroke="#38bdf8" strokeWidth="2" strokeDasharray="22 66" strokeLinecap="round"
              style={{ transformOrigin:"18px 18px", animation:"_gs2 1.2s linear infinite" }}/>
          </svg>
          Loading globe…
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "#070e1a", color: "#64748b", fontSize: 12, textAlign: "center", padding: "0 24px" }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <span style={{ color: "#94a3b8" }}>Globe failed to load</span>
          <span style={{ fontSize: 10, color: "#475569", maxWidth: 300 }}>{errorMsg}</span>
          <button onClick={() => window.location.reload()} style={{ marginTop: 8, padding: "5px 14px", borderRadius: 7, border: "1px solid #1e3a6e", background: "#0c1a2e", color: "#38bdf8", cursor: "pointer", fontSize: 11 }}>Retry</button>
        </div>
      )}

      {/* SP hover detail panel */}
      {status === "ready" && hoveredSP && (
        <div style={{
          position: "absolute", bottom: 48, left: 12, zIndex: 30,
          background: "rgba(7,14,26,0.95)", border: "1px solid #1e3a6e",
          borderRadius: 10, padding: "10px 14px", fontFamily: "monospace", fontSize: 11,
          color: "#e2e8f0", backdropFilter: "blur(8px)", pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: 3 }}>{hoveredSP.addressShort}</div>
          <div style={{ color: "#94a3b8" }}>{hoveredSP.az}</div>
          {hoveredSP.city && <div style={{ color: "#64748b" }}>{hoveredSP.city}{hoveredSP.country ? `, ${hoveredSP.country}` : ""}</div>}
          <div style={{ marginTop: 3, color: hoveredSP.health === "Healthy" ? "#34d399" : "#f87171", fontWeight: 700 }}>
            {hoveredSP.health}
          </div>
        </div>
      )}

      {/* Status badges */}
      {status === "ready" && providers.length > 0 && (
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 10, display: "flex", gap: 6, flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ fontSize: 11, fontFamily: "monospace", background: "rgba(7,14,26,0.9)", border: "1px solid #1e3a6e", borderRadius: 8, padding: "4px 10px", color: "#38bdf8", backdropFilter: "blur(8px)" }}>
            {providers.length} nodes online
          </div>
          <div style={{ fontSize: 9, fontFamily: "monospace", background: "rgba(7,14,26,0.85)", border: `1px solid ${lastEventCount > 0 ? "#065f46" : "#1e3a6e"}`, borderRadius: 6, padding: "3px 8px", color: lastEventCount > 0 ? "#34d399" : "#475569", backdropFilter: "blur(8px)" }}>
            {lastEventCount > 0 ? `● ${lastEventCount} real events` : "○ simulated arcs"}
          </div>
        </div>
      )}

      {/* Sovereignty badge */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 10, fontSize: 9, fontFamily: "monospace", background: "rgba(7,14,26,0.9)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "4px 10px", color: "#fde68a", backdropFilter: "blur(8px)" }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Legend */}
      {status === "ready" && (
        <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 10, display: "flex", gap: 12, alignItems: "center", fontSize: 9, fontFamily: "monospace", color: "#64748b", background: "rgba(7,14,26,0.8)", border: "1px solid #1e3a6e", borderRadius: 6, padding: "5px 10px", backdropFilter: "blur(8px)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, background: "#38bdf8", transform: "rotate(45deg)" }}/>
            Healthy SP
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, background: "#ef4444", transform: "rotate(45deg)" }}/>
            Faulty / Waitlisted
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 7, height: 7, background: "#fbbf24", transform: "rotate(45deg)" }}/>
            Sovereignty
          </span>
        </div>
      )}
      <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 10, fontSize: 9, fontFamily: "monospace", color: "#334155", pointerEvents: "none" }}>
        drag · scroll · hover = detail
      </div>
    </div>
  );
}