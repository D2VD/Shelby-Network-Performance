"use client";
/**
 * components/globe-engine.tsx — v5.0 (Light Mode Globe)
 *
 * Thay đổi so với v4:
 *  - Background: trắng/xám nhạt thay vì đen #030507
 *  - Globe: màu xanh lam nhạt (#a8d8f0 → #d6eef8) giống hình tham khảo
 *    Dùng globeImageUrl với custom texture SVG hoặc globeMaterial color
 *  - Atmosphere: xanh lam nhạt, altitude thấp hơn
 *  - SP nodes: cluster theo zone (tất cả SP cùng AZ hiển thị quanh 1 điểm anchor)
 *  - Arc semantics đúng cho Storage:
 *    Upload arcs: client origin → SP (1 chiều, không phải peer gossip)
 *    Xóa cross-zone "PG replication" arcs vì SPs không giao tiếp trực tiếp
 *  - Tooltip: light theme
 *  - Loading/Error: light theme
 */

import { useEffect, useRef, useState } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

interface GlobeEngineProps {
  providers:        StorageProvider[];
  network:          "shelbynet" | "testnet";
  accentColor:      string;
  onProviderClick?: (provider: StorageProvider) => void;
}

// ─── Simulated client upload origins (global internet hubs) ──────────────────
// These represent users uploading blobs → Shelby RPC → erasure chunks → SPs
const UPLOAD_ORIGINS = [
  { lat: 51.51,  lng: -0.13,   label: "London"       },
  { lat: 35.68,  lng: 139.65,  label: "Tokyo"         },
  { lat: 37.77,  lng: -122.42, label: "San Francisco" },
  { lat: 40.71,  lng: -74.01,  label: "New York"      },
  { lat: -23.55, lng: -46.63,  label: "São Paulo"     },
  { lat: 28.61,  lng: 77.21,   label: "New Delhi"     },
  { lat: 52.52,  lng: 13.40,   label: "Berlin"        },
  { lat: 1.35,   lng: 103.82,  label: "Singapore"     },
];

// ─── Sovereignty markers ──────────────────────────────────────────────────────
const SOVEREIGNTY = [
  { lat: 16.5,  lng: 112.0,  label: "Hoàng Sa (VN)" },
  { lat: 10.0,  lng: 114.17, label: "Trường Sa (VN)" },
];

// ─── Zone anchor points (for clustering) ────────────────────────────────────
// Khi nhiều SPs cùng 1 zone nhưng không có geo-IP riêng, jitter quanh anchor
const ZONE_ANCHORS: Record<string, { lat: number; lng: number }> = {
  dc_asia:      { lat:   1.35, lng: 103.82 }, // Singapore
  dc_australia: { lat: -33.87, lng: 151.21 }, // Sydney
  dc_europe:    { lat:  50.11, lng:   8.68 }, // Frankfurt
  dc_us_east:   { lat:  39.04, lng: -77.44 }, // Virginia
  dc_us_west:   { lat:  37.34, lng:-121.89 }, // San Jose
};

const GLOBE_CDN = "https://cdn.jsdelivr.net/npm/globe.gl@2.34.2/dist/globe.gl.min.js";

// ─── Script loader ─────────────────────────────────────────────────────────────
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
    s.onload = () => { _loaded = true; _cbs.forEach(cb => cb()); _cbs.length = 0; };
    s.onerror = () => reject(new Error("Failed to load globe.gl CDN"));
    document.head.appendChild(s);
  });
}

// ─── Jitter helper — scatter nodes within same zone ──────────────────────────
// Đảm bảo không có 2 nodes trùng lat/lng chính xác
function jitter(lat: number, lng: number, idx: number, total: number): { lat: number; lng: number } {
  if (total <= 1) return { lat, lng };
  // Spread nodes trong vòng tròn bán kính ~1.5° quanh anchor
  const angle  = (idx / total) * 2 * Math.PI;
  const radius = 1.5 + (idx % 3) * 0.5;
  return {
    lat: lat + radius * Math.sin(angle),
    lng: lng + radius * Math.cos(angle),
  };
}

// ─── Compute clustered positions ──────────────────────────────────────────────
function clusterProviders(providers: StorageProvider[]): Array<StorageProvider & { clLat: number; clLng: number }> {
  // Group by zone
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

      // Nếu nhiều SPs cùng zone và cùng tọa độ (không có geo-IP riêng)
      // → jitter xung quanh zone anchor để hiển thị rõ từng node
      const sameCoord = zProviders.filter(
        other => Math.abs((other.geo?.lat ?? 0) - lat) < 0.01 && Math.abs((other.geo?.lng ?? 0) - lng) < 0.01
      );
      if (sameCoord.length > 1 && anchor) {
        const jittered = jitter(anchor.lat, anchor.lng, idx, zProviders.length);
        lat = jittered.lat;
        lng = jittered.lng;
      }

      result.push({ ...p, clLat: lat, clLng: lng });
    });
  });

  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GlobeEngine({ providers, network, accentColor, onProviderClick }: GlobeEngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<any>(null);
  const [status,   setStatus]   = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Globe light-mode colors
  // Accent color thường là #2563eb (shelbynet cyan) hoặc #9333ea (testnet purple)
  // Chuyển sang palette sáng hơn cho light mode
  const GLOBE_BASE_COLOR  = "#cce8f4"; // xanh lam nhạt (ocean)
  const GLOBE_LAND_COLOR  = "#a0d0e8"; // xanh đậm hơn 1 chút (land dots)
  const ATMO_COLOR        = "#7ec8e3"; // atmosphere cyan nhạt
  const ARC_COLOR_UPLOAD  = "#2563eb"; // upload arc: xanh dương
  const RING_COLOR        = accentColor;
  const NODE_HEALTHY_CLR  = "#0ea5e9"; // xanh lam
  const NODE_FAULTY_CLR   = "#ef4444";
  const SOVER_COLOR       = "#d97706"; // vàng đậm (visible trên nền trắng)

  // ─── Data builders ──────────────────────────────────────────────────────────
  const getClustered = () => clusterProviders(providers);

  const getPoints = () => {
    const clustered = getClustered();
    return clustered
      .filter(p => p.clLat !== 0 || p.clLng !== 0)
      .map(p => ({
        lat:   p.clLat,
        lng:   p.clLng,
        size:  p.health === "Healthy" ? 0.6 : 0.35,
        color: p.health === "Healthy" ? NODE_HEALTHY_CLR : NODE_FAULTY_CLR,
        label: `<div style="font-family:monospace;font-size:11px;line-height:1.7;padding:8px 12px;background:rgba(255,255,255,0.97);border:1px solid #e5e7eb;border-radius:10px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,0.12)">
          <div style="color:${p.health === "Healthy" ? "#0369a1" : "#dc2626"};font-weight:700;margin-bottom:3px">${p.addressShort}</div>
          <div style="color:#6b7280;font-size:10px">${ZONE_META[p.availabilityZone]?.label ?? p.availabilityZone}</div>
          ${p.geo?.city ? `<div style="color:#374151;font-size:10px">${p.geo.city}${p.geo.countryCode ? ", "+p.geo.countryCode : ""}</div>` : ""}
          <div style="color:${p.health === "Healthy" ? "#059669" : "#dc2626"};font-size:10px;margin-top:2px">${p.health} · ${p.state}</div>
          ${p.capacityTiB ? `<div style="color:#9ca3af;font-size:10px">${p.capacityTiB.toFixed(2)} TiB</div>` : ""}
        </div>`,
        provider: p,
      }));
  };

  const getRings = () => {
    const clustered = getClustered();
    return clustered
      .filter(p => p.health === "Healthy" && (p.clLat !== 0 || p.clLng !== 0))
      .map(p => ({
        lat: p.clLat, lng: p.clLng,
        maxR: Math.min(2.0 + (p.capacityTiB ?? 1) * 0.3, 4.5),
        propagationSpeed: 0.8 + Math.random() * 0.5,
        repeatPeriod:     2800 + Math.floor(Math.random() * 1500),
      }));
  };

  const getArcs = () => {
    const arcs: any[] = [];
    const clustered = getClustered();
    const healthy   = clustered.filter(p => p.health === "Healthy" && (p.clLat !== 0 || p.clLng !== 0));
    if (healthy.length === 0) return arcs;

    // ── Storage arc semantics ──────────────────────────────────────────────
    // Shelby write flow: client → RPC → erasure encode → distribute 16 chunks → 16 SPs
    // Arcs show: upload origin → ALL healthy SPs (1 active write event at a time)
    // Không phải peer gossip, không phải cross-SP communication
    //
    // Mỗi "write event": chọn 1 origin, fan-out arc đến tất cả SPs (hoặc 10 cho data chunks)
    UPLOAD_ORIGINS.forEach((origin, oi) => {
      // Mỗi origin trigger 1 "blob write event" → spread to up to 10 SPs (data chunks)
      // 6 SPs còn lại nhận parity chunks (cũng cùng write event)
      const dataChunks   = healthy.slice(0, Math.min(10, healthy.length));
      const parityChunks = healthy.slice(10, Math.min(16, healthy.length));

      // Only show 1 upload event at a time per origin (staggered by oi)
      if (oi >= 4) return; // Giới hạn 4 origins cùng lúc

      dataChunks.forEach(sp => {
        arcs.push({
          startLat: origin.lat, startLng: origin.lng,
          endLat:   sp.clLat,  endLng:   sp.clLng,
          // Data chunk arcs: xanh dương, solid
          color:        [ARC_COLOR_UPLOAD + "88", ARC_COLOR_UPLOAD + "dd"],
          stroke:       0.4,
          arcAlt:       0.18 + Math.random() * 0.12,
          dashAnimTime: 1800 + oi * 200,
        });
      });

      parityChunks.forEach(sp => {
        arcs.push({
          startLat: origin.lat, startLng: origin.lng,
          endLat:   sp.clLat,  endLng:   sp.clLng,
          // Parity chunk arcs: nhạt hơn, dashed
          color:        [ARC_COLOR_UPLOAD + "33", ARC_COLOR_UPLOAD + "55"],
          stroke:       0.25,
          arcAlt:       0.12 + Math.random() * 0.08,
          dashAnimTime: 2200 + oi * 200,
        });
      });
    });

    return arcs;
  };

  const getSovPoints = () => SOVEREIGNTY.map(s => ({ lat: s.lat, lng: s.lng, label: s.label }));

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

        // ── Light mode globe setup ──────────────────────────────────────────
        const globe = GlobeGL({ waitForGlobeReady: true, animateIn: true })(el)
          .width(el.clientWidth || 600)
          .height(el.clientHeight || 480)
          // Light background — transparent để CSS của parent hiển thị qua
          .backgroundColor("rgba(0,0,0,0)")
          // Globe appearance: xanh lam nhạt
          // globe.gl dùng globeMaterial để style bề mặt
          .globeImageUrl("//unpkg.com/three-globe/example/img/earth-blue-marble.jpg") // placeholder
          .showGlobe(true)
          .showAtmosphere(true)
          .atmosphereColor(ATMO_COLOR)
          .atmosphereAltitude(0.12)
          // SP nodes (clustered)
          .pointsData(getPoints())
          .pointLat("lat").pointLng("lng")
          .pointAltitude(0.012)
          .pointRadius("size")
          .pointColor("color")
          .pointLabel("label")
          .onPointClick((d: any) => { if (onProviderClick && d?.provider) onProviderClick(d.provider); })
          .onPointHover((d: any) => { el.style.cursor = d ? "pointer" : "default"; })
          // Capacity rings — light blue
          .ringsData(getRings())
          .ringLat("lat").ringLng("lng")
          .ringMaxRadius("maxR")
          .ringPropagationSpeed("propagationSpeed")
          .ringRepeatPeriod("repeatPeriod")
          .ringColor(() => (t: number) => `rgba(14,165,233,${Math.max(0, (1 - t) * 0.45).toFixed(3)})`)
          // Upload arcs (storage semantics: client → SPs)
          .arcsData(getArcs())
          .arcStartLat("startLat").arcStartLng("startLng")
          .arcEndLat("endLat").arcEndLng("endLng")
          .arcColor("color")
          .arcStroke("stroke")
          .arcAltitude("arcAlt")
          .arcDashLength(0.3)
          .arcDashGap(0.12)
          .arcDashAnimateTime("dashAnimTime")
          // Sovereignty markers
          .htmlElementsData(getSovPoints())
          .htmlLat("lat").htmlLng("lng").htmlAltitude(0.012)
          .htmlElement((d: any) => {
            const div = document.createElement("div");
            div.style.cssText = "display:flex;align-items:center;gap:4px;pointer-events:none;white-space:nowrap;";
            div.innerHTML = `
              <div style="width:7px;height:7px;border-radius:50%;background:${SOVER_COLOR};box-shadow:0 0 6px ${SOVER_COLOR};flex-shrink:0"></div>
              <span style="font-size:9px;font-family:monospace;color:${SOVER_COLOR};font-weight:600;text-shadow:0 1px 2px rgba(255,255,255,0.9),0 0 8px rgba(255,255,255,0.6)">${d.label}</span>
            `;
            return div;
          })
          .pointOfView({ lat: 15, lng: 108, altitude: 2.0 }, 1200);

        // ── Override globe material color (light blue) ──────────────────────
        // globe.gl sau khi ready mới expose scene/renderer
        globe.onGlobeReady(() => {
          if (!active) return;

          // Tìm globe mesh và đặt màu xanh lam nhạt
          try {
            const scene = globe.scene();
            if (scene) {
              scene.traverse((obj: any) => {
                if (obj.isMesh && obj.geometry?.type === "SphereGeometry") {
                  if (obj.material) {
                    // Đặt màu globe: gradient xanh lam nhạt
                    obj.material.color?.setStyle?.(GLOBE_BASE_COLOR);
                    obj.material.opacity  = 1;
                    obj.material.needsUpdate = true;
                  }
                }
              });
            }
          } catch { /* scene traverse có thể fail ở một số versions */ }

          setStatus("ready");
        });

        // Safety timeout
        setTimeout(() => { if (active) setStatus(s => s === "loading" ? "ready" : s); }, 6000);

        // Camera controls
        const ctrl = globe.controls();
        ctrl.autoRotate      = true;
        ctrl.autoRotateSpeed = 0.3;
        ctrl.enableDamping   = true;
        ctrl.dampingFactor   = 0.08;

        globeRef.current = globe;

        // Resize observer
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

  // ─── Update data when providers change ──────────────────────────────────────
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointsData(getPoints());
    g.ringsData(getRings());
    g.arcsData(getArcs());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, accentColor]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position:   "relative",
      width:      "100%",
      height:     "100%",
      background: "#f0f4f8", // light blue-gray background (like Plausible)
      overflow:   "hidden",
    }}>
      <div
        ref={mountRef}
        style={{ width: "100%", height: "100%", opacity: status === "ready" ? 1 : 0, transition: "opacity 0.7s" }}
      />

      {/* Loading — light theme */}
      {status === "loading" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12,
          color: "#6b7280", fontFamily: "monospace", fontSize: 13,
          background: "#f0f4f8",
        }}>
          <style>{`@keyframes _gs_spin{to{transform:rotate(360deg)}}`}</style>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <circle cx="18" cy="18" r="14" stroke="#e5e7eb" strokeWidth="2"/>
            <circle cx="18" cy="18" r="14" stroke="#0ea5e9" strokeWidth="2"
              strokeDasharray="22 66" strokeLinecap="round"
              style={{ transformOrigin: "18px 18px", animation: "_gs_spin 1.2s linear infinite" }}/>
          </svg>
          Loading globe…
        </div>
      )}

      {/* Error — light theme */}
      {status === "error" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
          color: "#6b7280", fontFamily: "monospace", fontSize: 12,
          textAlign: "center", padding: "0 24px", background: "#f0f4f8",
        }}>
          <span style={{ fontSize: 22 }}>⚠</span>
          <span>Globe failed to load</span>
          <span style={{ fontSize: 10, color: "#9ca3af", maxWidth: 300 }}>{errorMsg}</span>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 8, padding: "5px 14px", borderRadius: 7,
            border: "1px solid #d1d5db", background: "#fff",
            color: "#374151", cursor: "pointer", fontFamily: "monospace", fontSize: 11,
          }}>
            Retry
          </button>
        </div>
      )}

      {/* Node count badge — light theme */}
      {status === "ready" && providers.length > 0 && (
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 10,
          fontSize: 11, fontFamily: "monospace",
          background: "rgba(255,255,255,0.85)",
          border: "1px solid #e5e7eb",
          borderRadius: 8, padding: "4px 10px",
          color: "#0369a1",
          backdropFilter: "blur(8px)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}>
          {providers.length} nodes online
        </div>
      )}

      {/* Sovereignty badge — visible on light bg */}
      <div style={{
        position: "absolute", top: 12, right: 12, zIndex: 10,
        fontSize: 9, fontFamily: "monospace",
        background: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(217,119,6,0.3)",
        borderRadius: 8, padding: "4px 10px",
        color: "#92400e",
        backdropFilter: "blur(8px)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Controls hint */}
      <div style={{
        position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 10, fontSize: 9, fontFamily: "monospace",
        color: "#9ca3af", pointerEvents: "none",
      }}>
        drag · scroll · click node
      </div>
    </div>
  );
}