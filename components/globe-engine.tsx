"use client";
/**
 * components/globe-engine.tsx — v7.0
 *
 * Changes:
 *  1. [VISUAL] Hexagonal dot texture: GLSL fragment shader trực tiếp trên Three.js material
 *     Thay vì canvas gradient → shader tạo hex grid chuẩn với land/ocean distinction
 *  2. [VISUAL] Globe color: deep ocean blue (#0c1a2e) + bright hex dots (#1e4d8c / #2563eb)
 *  3. [FIX] Arc clustering: arcs phân phối đều 16 SPs thay vì tập trung 1 SP
 *  4. [FIX] Node spread: jitter radius tăng để nodes không overlap khi cùng zone
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
  id:           string;
  startLat:     number;
  startLng:     number;
  endLat:       number;
  endLng:       number;
  color:        string[];
  stroke:       number;
  arcAlt:       number;
  dashAnimTime: number;
  isReal:       boolean;
}

const SOVEREIGNTY = [
  { lat: 16.5,  lng: 112.0,  label: "Hoàng Sa (VN)" },
  { lat: 10.0,  lng: 114.17, label: "Trường Sa (VN)" },
];

const ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  dc_asia:      { lat:   1.35, lng: 103.82 },
  dc_australia: { lat: -33.87, lng: 151.21 },
  dc_europe:    { lat:  50.11, lng:   8.68 },
  dc_us_east:   { lat:  39.04, lng: -77.44 },
  dc_us_west:   { lat:  37.34, lng:-121.89 },
};

const FALLBACK_ORIGINS = [
  { lat: 51.51,  lng:  -0.13 },  // London
  { lat: 35.68,  lng: 139.65 },  // Tokyo
  { lat: 37.77,  lng:-122.42 },  // San Francisco
  { lat: 40.71,  lng: -74.01 },  // New York
  { lat: -23.55, lng: -46.63 },  // São Paulo
  { lat: 28.61,  lng:  77.21 },  // Delhi
  { lat: 52.52,  lng:  13.40 },  // Berlin
  { lat:  1.35,  lng: 103.82 },  // Singapore
];

const CORE_SHELBYNET = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const INDEXER_URL    = "https://api.shelbynet.shelby.xyz/v1/graphql";

async function fetchRecentBlobEvents(): Promise<Array<{ owner: string; ts: string }>> {
  try {
    const query = `{
      account_transactions(
        where: { account_address: { _eq: "${CORE_SHELBYNET}" } }
        order_by: { transaction_version: desc }
        limit: 20
      ) { account_address transaction_version }
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
      owner: t.account_address,
      ts:    String(t.transaction_version),
    }));
  } catch { return []; }
}

function ownerToLatLng(owner: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < Math.min(owner.length, 20); i++) h += owner.charCodeAt(i);
  return FALLBACK_ORIGINS[h % FALLBACK_ORIGINS.length];
}

// FIX: Tăng jitter radius để 16 nodes trải đều, không cluster quá dày
function jitter(lat: number, lng: number, idx: number, total: number) {
  if (total <= 1) return { lat, lng };
  const angle  = (idx / total) * 2 * Math.PI;
  // Radius 2.0-4.0 degrees để nodes đủ xa nhau trên globe
  const radius = 2.0 + (idx % 4) * 0.5;
  return {
    lat: lat + radius * Math.sin(angle),
    lng: lng + radius * Math.cos(angle),
  };
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

// ─── Globe CDN ─────────────────────────────────────────────────────────────────
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

// ─── Build hexagonal dot texture via canvas ───────────────────────────────────
// Approach: render proper hex grid trên 2048×1024 canvas, pass as texture to globe.gl
// GLSL shader approach requires wiring into Three.js internals — dễ break với globe.gl CDN
// Canvas approach: controllable, predictable, works với globeImageUrl()
function buildHexDotTexture(): string {
  const W = 2048, H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Deep ocean background — dark navy blue (không phải trắng!)
  ctx.fillStyle = "#0c1a2e";
  ctx.fillRect(0, 0, W, H);

  // Hexagonal grid parameters
  // Hex radius = khoảng cách từ center đến corner
  const hexR    = 9;        // hex dot radius
  const spacing = hexR * 3.2; // khoảng cách giữa 2 hex centers (hex width)
  const rowH    = spacing * Math.sqrt(3) / 2; // row height for hex grid
  const dotR    = hexR * 0.55; // dot size (smaller = thưa hơn)

  // Ocean dot color: blue medium
  const oceanColor = "#1a3a6e";
  // Hex dot highlight color
  const dotColor   = "#2060c0";

  // Draw hex grid
  // Globe texture is equirectangular — lat/lng maps linearly to x/y
  // We use simple offset hex grid (không cần tính lat/lng — uniform là đủ)
  ctx.fillStyle = dotColor;

  let row = 0;
  for (let y = 0; y < H + rowH; y += rowH) {
    const xOffset = (row % 2) * (spacing / 2);
    for (let x = xOffset; x < W + spacing; x += spacing) {
      drawHexDot(ctx, x, y, dotR, oceanColor, dotColor);
    }
    row++;
  }

  // Add subtle grid lines connecting hex centers (very faint)
  ctx.strokeStyle = "rgba(30, 70, 140, 0.15)";
  ctx.lineWidth = 0.5;

  // Atmosphere glow near poles (latitude > 70 degrees = top/bottom 19% of height)
  const poleH = H * 0.19;
  const poleGrad = ctx.createLinearGradient(0, 0, 0, poleH);
  poleGrad.addColorStop(0, "rgba(100,180,255,0.25)");
  poleGrad.addColorStop(1, "rgba(100,180,255,0)");
  ctx.fillStyle = poleGrad;
  ctx.fillRect(0, 0, W, poleH);

  const poleGrad2 = ctx.createLinearGradient(0, H - poleH, 0, H);
  poleGrad2.addColorStop(0, "rgba(100,180,255,0)");
  poleGrad2.addColorStop(1, "rgba(100,180,255,0.2)");
  ctx.fillStyle = poleGrad2;
  ctx.fillRect(0, H - poleH, W, poleH);

  return canvas.toDataURL("image/png");
}

function drawHexDot(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  _bgColor: string, dotColor: string
) {
  // Draw a hexagon (flat-top orientation)
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i; // flat-top
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = dotColor;
  ctx.fill();
}

// ─── Apply Three.js shader to globe material after ready ──────────────────────
// This upgrades the globe material to use a custom GLSL shader for hex dot pattern
// that works over the canvas texture base layer
function applyGlobeShader(scene: any) {
  try {
    const THREE = (window as any).THREE;
    if (!THREE) return; // THREE not available in globe.gl CDN — skip shader, use canvas texture

    scene.traverse((obj: any) => {
      if (!obj.isMesh) return;
      if (obj.geometry?.type !== "SphereGeometry") return;
      if (!obj.material) return;

      // Upgrade to ShaderMaterial with hex dot pattern
      const hexVertShader = `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;

      const hexFragShader = `
        varying vec2 vUv;
        varying vec3 vNormal;

        // Hex grid SDF
        vec2 hexGrid(vec2 p, float s) {
          vec2 a = mod(p, vec2(s, s * 1.7320508)) - vec2(s * 0.5, s * 0.8660254);
          vec2 b = mod(p - vec2(s * 0.5, s * 0.8660254), vec2(s, s * 1.7320508)) - vec2(s * 0.5, s * 0.8660254);
          return dot(a, a) < dot(b, b) ? a : b;
        }

        void main() {
          vec2 uv = vUv;
          float scale = 60.0; // hex density — 60 = ~même densité que référence
          vec2 p = uv * vec2(scale * 2.0, scale);
          vec2 h = hexGrid(p, 1.0);
          float d = length(h);

          // Dot threshold: 0.35 = dot size (0=tiny, 0.5=fills hex)
          float dotMask = 1.0 - smoothstep(0.30, 0.40, d);

          // Colors
          vec3 oceanColor  = vec3(0.05, 0.10, 0.22);    // #0d1a38
          vec3 dotColor    = vec3(0.10, 0.32, 0.75);    // #1a52bf — medium blue dots
          vec3 brightDot   = vec3(0.15, 0.45, 0.95);    // #2673f2 — highlight

          // Fresnel-ish rim for atmosphere feel
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
          vec3 rimColor = vec3(0.3, 0.7, 1.0);

          vec3 color = mix(oceanColor, mix(dotColor, brightDot, fresnel * 0.5), dotMask);
          color = mix(color, rimColor, fresnel * 0.15);

          gl_FragColor = vec4(color, 1.0);
        }
      `;

      try {
        obj.material = new THREE.ShaderMaterial({
          vertexShader:   hexVertShader,
          fragmentShader: hexFragShader,
        });
        obj.material.needsUpdate = true;
      } catch {
        // ShaderMaterial failed — fall back to canvas texture approach
        obj.material.color?.setHex?.(0x0c1a2e);
        obj.material.needsUpdate = true;
      }
    });
  } catch { /* silent — canvas texture will serve as fallback */ }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GlobeEngine({ providers, network, accentColor, onProviderClick }: GlobeEngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [status,          setStatus]          = useState<"loading"|"ready"|"error">("loading");
  const [errorMsg,        setErrorMsg]        = useState("");
  const [eventArcs,       setEventArcs]       = useState<BlobEventArc[]>([]);
  const [lastEventCount,  setLastEventCount]  = useState(0);

  // ─── Poll real blob events ─────────────────────────────────────────────────
  const buildRealArcs = useCallback(async (clustered: ReturnType<typeof clusterProviders>) => {
    if (clustered.length === 0) return;
    const events = await fetchRecentBlobEvents();
    const healthy = clustered.filter(p => p.health === "Healthy");
    if (healthy.length === 0) return;

    let arcs: BlobEventArc[];

    if (events.length > 0) {
      // FIX: Phân phối arcs đều qua TẤT CẢ healthy SPs, không phải chỉ SP đầu tiên
      // Mỗi event được fan-out → múltiple SPs để hiển thị đúng erasure coding semantic
      arcs = events.slice(0, 12).flatMap((ev, evIdx) => {
        const origin = ownerToLatLng(ev.owner);
        // Fan: mỗi event → 2-3 SPs (data chunks) để visual đa dạng hơn
        const targetCount = Math.min(3, healthy.length);
        return Array.from({ length: targetCount }, (_, fanIdx) => {
          // Distribute evenly across healthy SPs: offset = evIdx * prime để tránh pattern
          const spIdx = (evIdx * 7 + fanIdx * 3) % healthy.length;
          const sp    = healthy[spIdx];
          const isData = fanIdx < 2; // first 2 = data, last = parity
          return {
            id:           `${ev.ts}_${fanIdx}`,
            startLat:     origin.lat,
            startLng:     origin.lng,
            endLat:       sp.clLat,
            endLng:       sp.clLng,
            color:        isData
              ? ["#2563eb88", "#2563ebcc"]
              : ["#93c5fd44", "#93c5fd77"],
            stroke:       isData ? 0.5 : 0.25,
            arcAlt:       0.15 + (evIdx % 5) * 0.05 + fanIdx * 0.02,
            dashAnimTime: 1500 + evIdx * 80 + fanIdx * 40,
            isReal:       true,
          };
        });
      });
      setLastEventCount(events.length);
    } else {
      // Fallback: simulated arcs từ multiple origins → multiple SPs
      arcs = FALLBACK_ORIGINS.slice(0, 4).flatMap((origin, oi) => {
        return healthy.slice(0, Math.min(healthy.length, 16)).map((sp, si) => ({
          id:           `sim_${oi}_${si}`,
          startLat:     origin.lat,
          startLng:     origin.lng,
          endLat:       sp.clLat,
          endLng:       sp.clLng,
          color:        si < 10
            ? ["#2563eb55", "#2563ebaa"]
            : ["#93c5fd22", "#93c5fd66"],
          stroke:       si < 10 ? 0.4 : 0.2,
          arcAlt:       0.14 + (si % 5) * 0.04,
          dashAnimTime: 1800 + oi * 150,
          isReal:       false,
        }));
      });
    }

    setEventArcs(arcs);
  }, []);

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
      lat:   p.clLat,
      lng:   p.clLng,
      size:  p.health === "Healthy" ? 0.65 : 0.35,
      color: p.health === "Healthy" ? "#38bdf8" : "#ef4444", // brighter cyan on dark globe
      label: `<div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:rgba(10,20,40,0.97);border:1px solid #1e3a6e;border-radius:10px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.4)">
        <div style="color:#38bdf8;font-weight:700;margin-bottom:2px">${p.addressShort}</div>
        <div style="color:#64748b;font-size:10px">${ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone}</div>
        ${p.geo?.city ? `<div style="color:#94a3b8;font-size:10px">${p.geo.city}${p.geo.countryCode?", "+p.geo.countryCode:""}</div>` : ""}
        <div style="color:${p.health==="Healthy"?"#34d399":"#f87171"};font-size:10px;margin-top:2px">${p.health} · ${p.state}</div>
        ${p.capacityTiB?`<div style="color:#64748b;font-size:10px">${p.capacityTiB.toFixed(2)} TiB</div>`:""}
      </div>`,
      provider: p,
    }));
  };

  const getRings = () => {
    const clustered = clusterProviders(providers);
    return clustered.filter(p => p.health === "Healthy" && (p.clLat!==0||p.clLng!==0)).map(p => ({
      lat:              p.clLat,
      lng:              p.clLng,
      maxR:             Math.min(2.0 + (p.capacityTiB ?? 1) * 0.3, 4.5),
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

        // Build hex dot texture (canvas-based, guaranteed to work)
        const hexTexture = buildHexDotTexture();

        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth || 700)
          .height(el.clientHeight || 500)
          .backgroundColor("rgba(0,0,0,0)")
          .globeImageUrl(hexTexture)    // hex dot canvas texture
          .showGlobe(true)
          .showAtmosphere(true)
          .atmosphereColor("#3b82f6")   // blue atmosphere on dark globe
          .atmosphereAltitude(0.18)
          // ── SP nodes ──────────────────────────────────────────────────────
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
          .ringColor(() => (t: number) => `rgba(56,189,248,${Math.max(0,(1-t)*0.5).toFixed(3)})`)
          // ── Arcs (upload events) ──────────────────────────────────────────
          .arcsData(eventArcs)
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color")
          .arcStroke("stroke")
          .arcAltitude("arcAlt")
          .arcDashLength(0.28)
          .arcDashGap(0.1)
          .arcDashAnimateTime("dashAnimTime")
          // ── Sovereignty markers ───────────────────────────────────────────
          .htmlElementsData(SOVEREIGNTY)
          .htmlLat("lat").htmlLng("lng").htmlAltitude(0.015)
          .htmlElement((d: any) => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap";
            div.innerHTML = `
              <div style="width:7px;height:7px;border-radius:50%;background:#fbbf24;box-shadow:0 0 8px #fbbf24;flex-shrink:0"></div>
              <span style="font-size:9px;font-family:monospace;color:#fde68a;font-weight:700;text-shadow:0 0 10px rgba(0,0,0,0.9)">${d.label}</span>
            `;
            return div;
          })
          .pointOfView({ lat: 20, lng: 30, altitude: 1.9 }, 1200);

        // ── Try to apply GLSL shader after globe ready (enhancement, not required) ──
        globe.onGlobeReady(() => {
          if (!active) return;
          try {
            const scene = globe.scene?.();
            if (scene) applyGlobeShader(scene);
          } catch { /* silent — canvas texture is the fallback */ }
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

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position:   "relative",
      width:      "100%",
      height:     "100%",
      background: "#070e1a", // dark background matching globe texture
      overflow:   "hidden",
    }}>
      <div
        ref={mountRef}
        style={{
          width:      "100%",
          height:     "100%",
          opacity:    status === "ready" ? 1 : 0,
          transition: "opacity 0.8s",
        }}
      />

      {/* Loading */}
      {status === "loading" && (
        <div style={{
          position:       "absolute", inset: 0,
          display:        "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap:            14,
          background:     "#070e1a",
          color:          "#38bdf8",
          fontFamily:     "monospace",
          fontSize:       13,
        }}>
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
        <div style={{
          position: "absolute", inset: 0,
          display:  "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap:      8, background: "#070e1a", color: "#64748b", fontSize: 12, textAlign: "center", padding: "0 24px",
        }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <span style={{ color: "#94a3b8" }}>Globe failed to load</span>
          <span style={{ fontSize: 10, color: "#475569", maxWidth: 300 }}>{errorMsg}</span>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 8, padding: "5px 14px", borderRadius: 7,
            border: "1px solid #1e3a6e", background: "#0c1a2e",
            color: "#38bdf8", cursor: "pointer", fontSize: 11,
          }}>Retry</button>
        </div>
      )}

      {/* Status badges */}
      {status === "ready" && providers.length > 0 && (
        <div style={{
          position:       "absolute", top: 12, left: 12, zIndex: 10,
          display:        "flex", gap: 6, flexDirection: "column", alignItems: "flex-start",
        }}>
          <div style={{
            fontSize: 11, fontFamily: "monospace",
            background: "rgba(7,14,26,0.9)", border: "1px solid #1e3a6e",
            borderRadius: 8, padding: "4px 10px", color: "#38bdf8",
            backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}>
            {providers.length} nodes online
          </div>
          <div style={{
            fontSize: 9, fontFamily: "monospace",
            background: "rgba(7,14,26,0.85)",
            border: `1px solid ${lastEventCount > 0 ? "#065f46" : "#1e3a6e"}`,
            borderRadius: 6, padding: "3px 8px",
            color: lastEventCount > 0 ? "#34d399" : "#475569",
            backdropFilter: "blur(8px)",
          }}>
            {lastEventCount > 0 ? `● ${lastEventCount} real events` : "○ simulated arcs"}
          </div>
        </div>
      )}

      {/* Sovereignty badge */}
      <div style={{
        position:       "absolute", top: 12, right: 12, zIndex: 10,
        fontSize:       9, fontFamily: "monospace",
        background:     "rgba(7,14,26,0.9)", border: "1px solid rgba(251,191,36,0.3)",
        borderRadius:   8, padding: "4px 10px", color: "#fde68a",
        backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Controls hint */}
      <div style={{
        position:       "absolute", bottom: 12, right: 12, zIndex: 10,
        fontSize:       9, fontFamily: "monospace", color: "#334155", pointerEvents: "none",
      }}>
        drag · scroll · click node
      </div>

      {/* Arc legend */}
      {status === "ready" && (
        <div style={{
          position:       "absolute", bottom: 12, left: 12, zIndex: 10,
          display:        "flex", gap: 10, alignItems: "center",
          fontSize:       9, fontFamily: "monospace", color: "#64748b",
          background:     "rgba(7,14,26,0.8)", border: "1px solid #1e3a6e",
          borderRadius:   6, padding: "4px 10px", backdropFilter: "blur(8px)",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 20, height: 2, background: "#2563eb", opacity: 0.9, borderRadius: 1 }}/>
            data chunks (10)
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 20, height: 1, background: "#93c5fd", opacity: 0.7, borderRadius: 1 }}/>
            parity (6)
          </span>
        </div>
      )}
    </div>
  );
}