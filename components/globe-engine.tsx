"use client";
/**
 * components/globe-engine.tsx — v4.1 (globe.gl via CDN)
 *
 * Load globe.gl từ CDN script tag — không cần npm install,
 * tránh Next.js bundle issues với Three.js/WASM.
 * Layers:
 *   1. SP nodes       — glowing points tại geo-IP của từng provider
 *   2. PG replication — animated dashed arcs, erasure 10+6 cross-zone
 *   3. Upload arcs    — client origin → SP (simulated từ global hubs)
 *   4. Capacity rings — ring size = capacityTiB
 *   5. Sovereignty    — Hoàng Sa + Trường Sa gold HTML markers
 */

import { useEffect, useRef, useState } from "react";
import type { StorageProvider } from "@/lib/types";

interface GlobeEngineProps {
  providers:        StorageProvider[];
  network:          "shelbynet" | "testnet";
  accentColor:      string;
  onProviderClick?: (provider: StorageProvider) => void;
}

// Simulated upload origins — global internet exchange points
const UPLOAD_ORIGINS = [
  { lat: 51.51,  lng: -0.13   },  // London
  { lat: 35.68,  lng: 139.65  },  // Tokyo
  { lat: 37.77,  lng: -122.42 },  // San Francisco
  { lat: 40.71,  lng: -74.01  },  // New York
  { lat: -23.55, lng: -46.63  },  // São Paulo
  { lat: 28.61,  lng: 77.21   },  // New Delhi
  { lat: 52.52,  lng: 13.40   },  // Berlin
];

const SOVEREIGNTY = [
  { lat: 16.5,  lng: 112.0,  label: "Hoàng Sa (VN)"  },
  { lat: 10.0,  lng: 114.17, label: "Trường Sa (VN)"  },
];

const GLOBE_CDN = "https://cdn.jsdelivr.net/npm/globe.gl@2.34.2/dist/globe.gl.min.js";

// ── Load script once globally ──────────────────────────────────────────────────
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
    s.src = GLOBE_CDN;
    s.async = true;
    s.onload = () => {
      _loaded = true;
      _cbs.forEach(cb => cb());
      _cbs.length = 0;
    };
    s.onerror = () => reject(new Error("Failed to load globe.gl from CDN"));
    document.head.appendChild(s);
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GlobeEngine({ providers, network, accentColor, onProviderClick }: GlobeEngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading"|"ready"|"error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Data builders ────────────────────────────────────────────────────────────
  const getPoints = () => providers
    .filter(p => p.geo?.lat != null && p.geo?.lng != null)
    .map(p => ({
      lat: p.geo!.lat, lng: p.geo!.lng,
      size: p.health === "Healthy" ? 0.55 : 0.3,
      color: p.health === "Healthy" ? accentColor : "#ef4444",
      label: `<div style="font-family:monospace;font-size:11px;line-height:1.6;padding:8px 10px;background:rgba(7,11,16,.95);border:1px solid ${accentColor}55;border-radius:8px;min-width:160px">
        <div style="color:${accentColor};font-weight:600;margin-bottom:2px">${p.addressShort}</div>
        <div style="color:#d1d5db">${p.geo?.city ?? ""}${p.geo?.countryCode ? ", "+p.geo.countryCode : ""}</div>
        <div style="color:${p.health==="Healthy"?"#34d399":"#f87171"}">${p.health}</div>
        ${p.capacityTiB ? `<div style="color:#6b7280">${p.capacityTiB.toFixed(2)} TiB</div>` : ""}
      </div>`,
      provider: p,
    }));

  const getRings = () => providers
    .filter(p => p.geo?.lat != null && p.geo?.lng != null && p.health === "Healthy")
    .map(p => ({
      lat: p.geo!.lat, lng: p.geo!.lng,
      maxR: Math.min(2.5 + (p.capacityTiB ?? 1) * 0.35, 5.5),
      propagationSpeed: 1.0 + Math.random() * 0.8,
      repeatPeriod: 2500 + Math.floor(Math.random() * 1500),
    }));

  const getArcs = () => {
    const arcs: any[] = [];
    const healthy = providers.filter(p => p.geo?.lat != null && p.geo?.lng != null && p.health === "Healthy");
    if (healthy.length < 2) return arcs;

    // Group by AZ for PG replication arcs
    const byZone = new Map<string, StorageProvider[]>();
    healthy.forEach(p => {
      const z = p.availabilityZone ?? "unknown";
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z)!.push(p);
    });
    const zones = Array.from(byZone.values());

    // Cross-zone replication arcs (erasure coding 10+6)
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i][0], b = zones[j][0];
        arcs.push({
          startLat: a.geo!.lat, startLng: a.geo!.lng,
          endLat:   b.geo!.lat, endLng:   b.geo!.lng,
          color: [accentColor+"ee", accentColor+"11"],
          stroke: 0.5, arcAlt: 0.15 + Math.random()*0.1,
          dashAnimTime: 3500,
        });
      }
    }

    // Upload arcs: origin → random SP
    UPLOAD_ORIGINS.slice(0,6).forEach(origin => {
      const sp = healthy[Math.floor(Math.random()*healthy.length)];
      arcs.push({
        startLat: origin.lat, startLng: origin.lng,
        endLat:   sp.geo!.lat, endLng: sp.geo!.lng,
        color: ["#ffffff33", accentColor+"ff"],
        stroke: 0.35, arcAlt: 0.28 + Math.random()*0.18,
        dashAnimTime: 1600,
      });
    });

    return arcs;
  };

  const getSovPoints = () => SOVEREIGNTY.map(s => ({ lat: s.lat, lng: s.lng, label: s.label }));

  // ── Init globe ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;
    let active = true;

    (async () => {
      try {
        await loadGlobe();
        if (!active || !mountRef.current) return;

        const GlobeGL = (window as any).Globe;
        if (typeof GlobeGL !== "function") throw new Error("Globe not found on window after CDN load");

        const el = mountRef.current;
        const [r,g,b] = hexToRgb(accentColor);

        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth || 600)
          .height(el.clientHeight || 480)
          .backgroundColor("rgba(0,0,0,0)")
          .showAtmosphere(true)
          .atmosphereColor(accentColor)
          .atmosphereAltitude(0.22)
          // SP nodes
          .pointsData(getPoints())
          .pointLat("lat").pointLng("lng")
          .pointAltitude(0.008).pointRadius("size").pointColor("color").pointLabel("label")
          .onPointClick((d:any) => { if (onProviderClick && d?.provider) onProviderClick(d.provider); })
          .onPointHover((d:any) => { el.style.cursor = d ? "pointer" : "default"; })
          // Capacity rings
          .ringsData(getRings())
          .ringLat("lat").ringLng("lng")
          .ringMaxRadius("maxR").ringPropagationSpeed("propagationSpeed").ringRepeatPeriod("repeatPeriod")
          .ringColor(() => (t:number) => `rgba(${r},${g},${b},${Math.max(0,(1-t)*0.5).toFixed(3)})`)
          // Arcs
          .arcsData(getArcs())
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color").arcStroke("stroke").arcAltitude("arcAlt")
          .arcDashLength(0.35).arcDashGap(0.15)
          .arcDashAnimateTime("dashAnimTime")
          // Sovereignty HTML
          .htmlElementsData(getSovPoints())
          .htmlLat("lat").htmlLng("lng").htmlAltitude(0.01)
          .htmlElement((d:any) => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap";
            div.innerHTML = `<div style="width:7px;height:7px;border-radius:50%;background:#FFD700;box-shadow:0 0 6px #FFD700;flex-shrink:0"></div><span style="font-size:9px;font-family:monospace;color:#FFD700;text-shadow:0 1px 3px rgba(0,0,0,.9)">${d.label}</span>`;
            return div;
          })
          .pointOfView({ lat: 15, lng: 108, altitude: 2.2 }, 1200);

        // Camera controls
        const ctrl = globe.controls();
        ctrl.autoRotate = true;
        ctrl.autoRotateSpeed = 0.35;
        ctrl.enableDamping = true;
        ctrl.dampingFactor = 0.08;

        globeRef.current = globe;

        // onGlobeReady callback
        globe.onGlobeReady(() => { if (active) setStatus("ready"); });
        // Safety timeout
        setTimeout(() => { if (active) setStatus(s => s === "loading" ? "ready" : s); }, 6000);

        // Resize
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

  // ── Update data on provider change ──────────────────────────────────────────
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointsData(getPoints());
    g.ringsData(getRings());
    g.arcsData(getArcs());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, accentColor]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"relative", width:"100%", height:"100%", background:"#030507", overflow:"hidden" }}>

      <div ref={mountRef}
        style={{ width:"100%", height:"100%", opacity: status==="ready" ? 1 : 0, transition:"opacity .7s" }}
      />

      {/* Loading */}
      {status==="loading" && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, color:"#4b5563", fontFamily:"monospace", fontSize:13 }}>
          <style>{`@keyframes _gs{to{transform:rotate(360deg)}}`}</style>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="#1f2937" strokeWidth="2"/>
            <circle cx="18" cy="18" r="14" stroke={accentColor} strokeWidth="2" strokeDasharray="22 66" strokeLinecap="round" style={{transformOrigin:"18px 18px",animation:"_gs 1.2s linear infinite"}}/>
          </svg>
          Loading globe…
        </div>
      )}

      {/* Error */}
      {status==="error" && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, color:"#9ca3af", fontFamily:"monospace", fontSize:12, textAlign:"center", padding:"0 24px" }}>
          <span style={{fontSize:22}}>⚠</span>
          <span>Globe failed to load</span>
          <span style={{fontSize:10,color:"#6b7280",maxWidth:300}}>{errorMsg}</span>
          <button onClick={()=>window.location.reload()} style={{marginTop:8,padding:"5px 14px",borderRadius:7,border:"1px solid #374151",background:"transparent",color:"#9ca3af",cursor:"pointer",fontFamily:"monospace",fontSize:11}}>
            Retry
          </button>
        </div>
      )}

      {/* Legend */}
      {status==="ready" && (
        <div style={{ position:"absolute", bottom:42, right:16, zIndex:10, pointerEvents:"none", display:"flex", flexDirection:"column", gap:5, alignItems:"flex-end" }}>
          {[
            { label:"PG replication (erasure 10+6)", dashed:true,  color:accentColor },
            { label:"Upload arc (client → SP)",      dashed:false, color:"#ffffff"   },
            { label:"Capacity ring (healthy SP)",    dashed:false, color:accentColor },
          ].map(({label,dashed,color}) => (
            <div key={label} style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:9,color:"#3d5570",fontFamily:"monospace"}}>{label}</span>
              <span style={{display:"inline-block",width:18,height:dashed?0:1.5,borderTop:dashed?`1.5px dashed ${color}`:"none",background:dashed?"transparent":color,borderRadius:2,opacity:.75}}/>
            </div>
          ))}
        </div>
      )}

      {/* Node count */}
      {status==="ready" && providers.length>0 && (
        <div style={{ position:"absolute", top:12, left:16, zIndex:10, fontSize:10, fontFamily:"monospace", background:"rgba(0,0,0,.6)", border:`1px solid ${accentColor}33`, borderRadius:6, padding:"4px 10px", color:accentColor, backdropFilter:"blur(4px)" }}>
          {providers.length} nodes online
        </div>
      )}

      {/* Sovereignty */}
      <div style={{ position:"absolute", top:12, right:16, zIndex:10, fontSize:9, fontFamily:"monospace", background:"rgba(0,0,0,.6)", border:"1px solid rgba(255,215,0,.3)", borderRadius:6, padding:"4px 10px", color:"#ffd700", backdropFilter:"blur(4px)" }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Controls */}
      <div style={{ position:"absolute", bottom:12, right:16, zIndex:10, fontSize:9, fontFamily:"monospace", color:"#3d5570", lineHeight:1.7, textAlign:"right", pointerEvents:"none" }}>
        drag · scroll · click node
      </div>
    </div>
  );
}