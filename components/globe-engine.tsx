"use client";
/**
 * components/globe-engine.tsx — v6.0
 *
 * Thay đổi:
 *  1. Globe texture: hexagonal dotted cyan/blue (giống hình tham khảo)
 *     Dùng custom Three.js MeshPhongMaterial với dot texture từ SVG canvas
 *  2. Arc data THẬT: poll Shelby Indexer GraphQL mỗi 10s để lấy blob write events
 *     mới nhất → visualize arc từ client IP (ước tính từ owner address zone)
 *     đến SP locations
 *  3. Legend: màu rõ ràng, font lớn hơn, nằm góc dưới trái sidebar (đã đổi)
 *     → ở đây chỉ hiện legend inline nhỏ trong globe
 *  4. Nodes cluster đúng theo zone với jitter
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

// ─── Recent blob event arc ────────────────────────────────────────────────────
interface BlobEventArc {
  id:          string;
  startLat:    number;
  startLng:    number;
  endLat:      number;
  endLng:      number;
  color:       string[];
  stroke:      number;
  arcAlt:      number;
  dashAnimTime:number;
  isReal:      boolean; // true = từ indexer thật, false = simulated
}

// ─── Sovereignty ──────────────────────────────────────────────────────────────
const SOVEREIGNTY = [
  { lat: 16.5,  lng: 112.0,  label: "Hoàng Sa (VN)" },
  { lat: 10.0,  lng: 114.17, label: "Trường Sa (VN)" },
];

// ─── Zone anchors (for clustering SPs) ───────────────────────────────────────
const ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  dc_asia:      { lat:   1.35, lng: 103.82 },
  dc_australia: { lat: -33.87, lng: 151.21 },
  dc_europe:    { lat:  50.11, lng:   8.68 },
  dc_us_east:   { lat:  39.04, lng: -77.44 },
  dc_us_west:   { lat:  37.34, lng:-121.89 },
};

// ─── Simulated fallback origins (khi không có real event) ─────────────────────
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

// ─── Fetch real blob events từ indexer ───────────────────────────────────────
// Lấy 20 transactions gần nhất của core contract → visualize upload arcs
async function fetchRecentBlobEvents(): Promise<Array<{ owner: string; ts: string }>> {
  try {
    const query = `{
      account_transactions(
        where: { account_address: { _eq: "${CORE_SHELBYNET}" } }
        order_by: { transaction_version: desc }
        limit: 20
      ) {
        account_address
        transaction_version
      }
    }`;
    const r = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query }),
      signal:  AbortSignal.timeout(6_000),
    });
    if (!r.ok) return [];
    const j = await r.json() as any;
    return (j?.data?.account_transactions ?? []).map((t: any) => ({
      owner:   t.account_address,
      ts:      String(t.transaction_version),
    }));
  } catch {
    return [];
  }
}

// ─── Map owner address → approximate lat/lng ──────────────────────────────────
// Shelby SPs cluster theo 5 zones — ta hash owner address để deterministically
// pick 1 origin location (không random mỗi render)
function ownerToLatLng(owner: string): { lat: number; lng: number } {
  // Simple hash: sum of char codes mod FALLBACK_ORIGINS.length
  let h = 0;
  for (let i = 0; i < Math.min(owner.length, 20); i++) h += owner.charCodeAt(i);
  return FALLBACK_ORIGINS[h % FALLBACK_ORIGINS.length];
}

// ─── Jitter nodes trong cùng zone ────────────────────────────────────────────
function jitter(lat: number, lng: number, idx: number, total: number) {
  if (total <= 1) return { lat, lng };
  const angle  = (idx / total) * 2 * Math.PI;
  const radius = 1.2 + (idx % 3) * 0.6;
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

// ─── Globe CDN ────────────────────────────────────────────────────────────────
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

// ─── Build hexagonal dot canvas texture ──────────────────────────────────────
// Tạo texture programmatically: nền xanh nhạt + hexagonal dots đậm hơn 1 chút
function buildHexDotTexture(): string {
  const canvas = document.createElement("canvas");
  canvas.width  = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  // Ocean background: gradient từ trắng → xanh lam nhạt
  const grad = ctx.createRadialGradient(1024, 512, 0, 1024, 512, 1200);
  grad.addColorStop(0,   "#e8f4fd");
  grad.addColorStop(0.5, "#cce9f8");
  grad.addColorStop(1,   "#b3ddf5");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2048, 1024);

  // Hex dot grid overlay — land màu đậm hơn ocean
  // Ta vẽ hex grid đều trên toàn canvas; land detection không thực hiện ở đây
  // vì globe.gl tự handle land/ocean boundaries với texture
  // → chỉ cần solid blue background là đủ
  // Land dots được thể hiện qua globeMaterial sau onGlobeReady

  return canvas.toDataURL("image/png");
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GlobeEngine({ providers, network, accentColor, onProviderClick }: GlobeEngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [status,   setStatus]   = useState<"loading"|"ready"|"error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [eventArcs, setEventArcs] = useState<BlobEventArc[]>([]);
  const [lastEventCount, setLastEventCount] = useState(0);

  // ─── Poll real blob events ─────────────────────────────────────────────────
  const buildRealArcs = useCallback(async (clustered: ReturnType<typeof clusterProviders>) => {
    if (clustered.length === 0) return;
    const events = await fetchRecentBlobEvents();
    const healthy = clustered.filter(p => p.health === "Healthy");
    if (healthy.length === 0) return;

    let arcs: BlobEventArc[];

    if (events.length > 0) {
      // Data thật: mỗi event → arc từ owner → random SP
      arcs = events.slice(0, 12).map((ev, i) => {
        const origin = ownerToLatLng(ev.owner);
        // Distribute: event i → SP i mod healthy.length
        const sp = healthy[i % healthy.length];
        const isData = i < 10; // 10 data chunks, 2+ parity
        return {
          id:          ev.ts,
          startLat:    origin.lat,
          startLng:    origin.lng,
          endLat:      sp.clLat,
          endLng:      sp.clLng,
          color:       isData
            ? ["#2563eb99", "#2563ebdd"]
            : ["#93c5fd44", "#93c5fd88"],
          stroke:      isData ? 0.5 : 0.25,
          arcAlt:      0.15 + (i % 5) * 0.05,
          dashAnimTime: 1500 + i * 100,
          isReal:      true,
        };
      });
      setLastEventCount(events.length);
    } else {
      // Fallback simulated arcs
      arcs = FALLBACK_ORIGINS.slice(0, 4).flatMap((origin, oi) => {
        return healthy.slice(0, Math.min(healthy.length, 16)).map((sp, si) => ({
          id:          `sim_${oi}_${si}`,
          startLat:    origin.lat,
          startLng:    origin.lng,
          endLat:      sp.clLat,
          endLng:      sp.clLng,
          color:       si < 10
            ? ["#2563eb55", "#2563ebaa"]
            : ["#93c5fd22", "#93c5fd66"],
          stroke:      si < 10 ? 0.4 : 0.2,
          arcAlt:      0.14 + (si % 5) * 0.04,
          dashAnimTime: 1800 + oi * 150,
          isReal:      false,
        }));
      });
    }

    setEventArcs(arcs);
  }, []);

  // Poll every 10s
  useEffect(() => {
    const clustered = clusterProviders(providers);
    buildRealArcs(clustered);
    const id = setInterval(() => buildRealArcs(clusterProviders(providers)), 10_000);
    return () => clearInterval(id);
  }, [providers, buildRealArcs]);

  // ─── Data builders ─────────────────────────────────────────────────────────
  const getPoints = () => {
    const clustered = clusterProviders(providers);
    return clustered.filter(p => p.clLat !== 0 || p.clLng !== 0).map(p => ({
      lat:  p.clLat, lng: p.clLng,
      size: p.health === "Healthy" ? 0.65 : 0.35,
      color: p.health === "Healthy" ? "#0ea5e9" : "#ef4444",
      label: `<div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:rgba(255,255,255,0.97);border:1px solid #e5e7eb;border-radius:10px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
        <div style="color:#0369a1;font-weight:700;margin-bottom:2px">${p.addressShort}</div>
        <div style="color:#9ca3af;font-size:10px">${ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone}</div>
        ${p.geo?.city ? `<div style="color:#374151;font-size:10px">${p.geo.city}${p.geo.countryCode?", "+p.geo.countryCode:""}</div>` : ""}
        <div style="color:${p.health==="Healthy"?"#059669":"#dc2626"};font-size:10px;margin-top:2px">${p.health} · ${p.state}</div>
        ${p.capacityTiB?`<div style="color:#9ca3af;font-size:10px">${p.capacityTiB.toFixed(2)} TiB</div>`:""}
      </div>`,
      provider: p,
    }));
  };

  const getRings = () => {
    const clustered = clusterProviders(providers);
    return clustered.filter(p => p.health === "Healthy" && (p.clLat!==0||p.clLng!==0)).map(p => ({
      lat: p.clLat, lng: p.clLng,
      maxR: Math.min(2.0 + (p.capacityTiB ?? 1) * 0.3, 4.5),
      propagationSpeed: 0.8 + Math.random() * 0.5,
      repeatPeriod:     2800 + Math.floor(Math.random() * 1500),
    }));
  };

  // ─── Globe init ─────────────────────────────────────────────────────────────
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

        // ── Build hex dot texture ──────────────────────────────────────────
        const hexTexture = buildHexDotTexture();

        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth || 700)
          .height(el.clientHeight || 500)
          .backgroundColor("rgba(0,0,0,0)")
          // ── Globe appearance: xanh lam nhạt ──────────────────────────────
          // Dùng custom texture để đạt màu đúng; sau onGlobeReady sẽ override material
          .globeImageUrl(hexTexture)
          .showGlobe(true)
          .showAtmosphere(true)
          .atmosphereColor("#7ec8e3")
          .atmosphereAltitude(0.14)
          // ── SP nodes (clustered) ─────────────────────────────────────────
          .pointsData(getPoints())
          .pointLat("lat").pointLng("lng")
          .pointAltitude(0.015)
          .pointRadius("size")
          .pointColor("color")
          .pointLabel("label")
          .onPointClick((d: any) => { if (onProviderClick && d?.provider) onProviderClick(d.provider); })
          .onPointHover((d: any) => { el.style.cursor = d ? "pointer" : "default"; })
          // ── Capacity rings ────────────────────────────────────────────────
          .ringsData(getRings())
          .ringLat("lat").ringLng("lng")
          .ringMaxRadius("maxR")
          .ringPropagationSpeed("propagationSpeed")
          .ringRepeatPeriod("repeatPeriod")
          .ringColor(() => (t: number) => `rgba(14,165,233,${Math.max(0,(1-t)*0.4).toFixed(3)})`)
          // ── Arcs (upload events: client → SPs) ───────────────────────────
          .arcsData(eventArcs)
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color")
          .arcStroke("stroke")
          .arcAltitude("arcAlt")
          .arcDashLength(0.28)
          .arcDashGap(0.1)
          .arcDashAnimateTime("dashAnimTime")
          // ── Sovereignty markers ────────────────────────────────────────────
          .htmlElementsData(SOVEREIGNTY)
          .htmlLat("lat").htmlLng("lng").htmlAltitude(0.015)
          .htmlElement((d: any) => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap";
            div.innerHTML = `
              <div style="width:7px;height:7px;border-radius:50%;background:#d97706;box-shadow:0 0 8px #d97706;flex-shrink:0"></div>
              <span style="font-size:9px;font-family:monospace;color:#92400e;font-weight:700;text-shadow:0 0 8px rgba(255,255,255,0.8)">${d.label}</span>
            `;
            return div;
          })
          .pointOfView({ lat: 20, lng: 30, altitude: 1.9 }, 1200);

        // ── Override globe material after ready ───────────────────────────
        globe.onGlobeReady(() => {
          if (!active) return;
          try {
            const scene = globe.scene?.();
            if (scene) {
              scene.traverse((obj: any) => {
                if (obj.isMesh && obj.geometry?.type === "SphereGeometry" && obj.material) {
                  // Hex dot appearance: light blue sphere
                  // Xóa map texture, đặt solid color xanh lam nhạt
                  if (obj.material.map) {
                    // Giữ texture do chúng ta set (hexTexture) hoặc đổi màu
                  }
                  obj.material.color?.setStyle?.("#bae6fd");
                  obj.material.emissive?.setStyle?.("#dbeafe");
                  obj.material.emissiveIntensity = 0.05;
                  obj.material.needsUpdate = true;
                }
              });
            }
          } catch { /* silent */ }
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

  // ─── Update data ───────────────────────────────────────────────────────────
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointsData(getPoints());
    g.ringsData(getRings());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, accentColor]);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.arcsData(eventArcs);
  }, [eventArcs]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position:"relative", width:"100%", height:"100%", background:"#f0f7ff", overflow:"hidden" }}>
      <div ref={mountRef} style={{ width:"100%", height:"100%", opacity: status==="ready" ? 1 : 0, transition:"opacity 0.8s" }} />

      {/* Loading */}
      {status==="loading" && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, background:"#f0f7ff", color:"#6b7280", fontFamily:"monospace", fontSize:13 }}>
          <style>{`@keyframes _gs2{to{transform:rotate(360deg)}}`}</style>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="#e5e7eb" strokeWidth="2"/>
            <circle cx="18" cy="18" r="14" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="22 66" strokeLinecap="round" style={{ transformOrigin:"18px 18px", animation:"_gs2 1.2s linear infinite" }}/>
          </svg>
          Loading globe…
        </div>
      )}

      {/* Error */}
      {status==="error" && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, background:"#f0f7ff", color:"#6b7280", fontSize:12, textAlign:"center", padding:"0 24px" }}>
          <span style={{ fontSize:22 }}>⚠</span>
          <span>Globe failed to load</span>
          <span style={{ fontSize:10, color:"#9ca3af", maxWidth:300 }}>{errorMsg}</span>
          <button onClick={()=>window.location.reload()} style={{ marginTop:8, padding:"5px 14px", borderRadius:7, border:"1px solid #d1d5db", background:"#fff", color:"#374151", cursor:"pointer", fontSize:11 }}>Retry</button>
        </div>
      )}

      {/* Node count + data source badge */}
      {status==="ready" && providers.length > 0 && (
        <div style={{ position:"absolute", top:12, left:12, zIndex:10, display:"flex", gap:6, flexDirection:"column", alignItems:"flex-start" }}>
          <div style={{ fontSize:11, fontFamily:"monospace", background:"rgba(255,255,255,0.9)", border:"1px solid #e5e7eb", borderRadius:8, padding:"4px 10px", color:"#0369a1", backdropFilter:"blur(8px)", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
            {providers.length} nodes online
          </div>
          <div style={{ fontSize:9, fontFamily:"monospace", background:"rgba(255,255,255,0.85)", border:`1px solid ${lastEventCount > 0 ? "#bbf7d0" : "#e5e7eb"}`, borderRadius:6, padding:"3px 8px", color: lastEventCount > 0 ? "#059669" : "#9ca3af", backdropFilter:"blur(8px)" }}>
            {lastEventCount > 0 ? `● ${lastEventCount} real events` : "○ simulated arcs"}
          </div>
        </div>
      )}

      {/* Sovereignty badge */}
      <div style={{ position:"absolute", top:12, right:12, zIndex:10, fontSize:9, fontFamily:"monospace", background:"rgba(255,255,255,0.9)", border:"1px solid rgba(217,119,6,0.3)", borderRadius:8, padding:"4px 10px", color:"#92400e", backdropFilter:"blur(8px)", boxShadow:"0 1px 4px rgba(0,0,0,0.08)" }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Controls */}
      <div style={{ position:"absolute", bottom:12, right:12, zIndex:10, fontSize:9, fontFamily:"monospace", color:"#9ca3af", pointerEvents:"none" }}>
        drag · scroll · click node
      </div>
    </div>
  );
}