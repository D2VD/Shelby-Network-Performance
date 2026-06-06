"use client";
// components/world-map-inner.tsx — v7.0
//
// CHANGES vs v6.0:
//  1. Cluster markers: circle → square SVG rect (rotated 45° = diamond)
//  2. Hoàng Sa / Trường Sa added as real <Marker> elements with gold diamond + label
//  3. Sovereignty badge in bottom-right corner
//  4. All other behavior preserved (drag, zoom, cluster popup, geo share panel)

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import type { StorageProvider } from "@/lib/types";
import { useTheme } from "./theme-context";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Sovereignty marker definitions ────────────────────────────────────────────
const SOVEREIGNTY_MARKERS = [
  { coords: [112.0,  16.5 ] as [number, number], label: "Hoàng Sa", flag: "🇻🇳" },
  { coords: [114.17, 10.0 ] as [number, number], label: "Trường Sa", flag: "🇻🇳" },
];

// ── Zone display labels ───────────────────────────────────────────────────────
const ZONE_DISPLAY: Record<string, { label: string; flag: string }> = {
  dc_us_west:   { label: "US West (San Jose)",   flag: "🇺🇸" },
  dc_us_east:   { label: "US East (Virginia)",   flag: "🇺🇸" },
  dc_europe:    { label: "Europe (Frankfurt)",   flag: "🇩🇪" },
  dc_asia:      { label: "Asia (Singapore)",     flag: "🇸🇬" },
  dc_australia: { label: "Australia (Sydney)",   flag: "🇦🇺" },
  "Jump-AMS-0": { label: "Amsterdam (Jump)",     flag: "🇳🇱" },
  "Jump-AMS-1": { label: "Amsterdam (Jump)",     flag: "🇳🇱" },
  "Jump-LON-0": { label: "London (Jump)",        flag: "🇬🇧" },
  "Jump-LON-1": { label: "London (Jump)",        flag: "🇬🇧" },
  "Stakely-0":  { label: "Frankfurt (Stakely)",  flag: "🇩🇪" },
  "Duoro-0":    { label: "Lisbon (Duoro)",       flag: "🇵🇹" },
  "Nova-0":     { label: "Madrid (Nova)",        flag: "🇪🇸" },
  "Republic-0": { label: "New York (Republic)",  flag: "🇺🇸" },
  "AR-0":       { label: "AR Zone 0",            flag: "🌐" },
  "AR-1":       { label: "AR Zone 1",            flag: "🌐" },
};

const ZONE_COLORS = [
  "#3b82f6","#22c55e","#a855f7","#f59e0b","#ef4444",
  "#0891b2","#d97706","#8b5cf6","#ec4899","#14b8a6",
];

const DEFAULT_SCALE: number          = 185;
const DEFAULT_CENTER: [number,number] = [15, 5];
const MIN_SCALE = 100, MAX_SCALE = 900;

// ── Cluster builder (group by rounded lat/lng) ────────────────────────────────
interface ClusterEntry {
  key: string; lat: number; lng: number;
  zone: string; providers: StorageProvider[];
}

function buildClusters(providers: StorageProvider[]): ClusterEntry[] {
  const withGeo = providers.filter(p => p.geo?.lat && p.geo?.lng);
  const map = new Map<string, ClusterEntry>();
  for (const p of withGeo) {
    const lat  = p.geo!.lat, lng = p.geo!.lng;
    const clat = Math.round(lat * 2) / 2, clng = Math.round(lng * 2) / 2;
    const key  = `${clat},${clng}`;
    if (!map.has(key)) map.set(key, { key, lat: clat, lng: clng, zone: p.availabilityZone, providers: [] });
    map.get(key)!.providers.push(p);
  }
  return Array.from(map.values());
}

function healthDotColor(p: StorageProvider): string {
  if (p.state === "Frozen")    return "#60a5fa";
  if (p.state === "Waitlisted") return "#f59e0b";
  if (p.health === "Healthy")  return "#22c55e";
  if (p.health === "Faulty" || p.health === "Unhealthy") return "#ef4444";
  return "#9ca3af";
}

// ── Cluster popup ─────────────────────────────────────────────────────────────
function ClusterPopup({ cluster, pinned, onClose, isDark }: {
  cluster: ClusterEntry; pinned: boolean; onClose: () => void; isDark: boolean;
}) {
  const [cp, setCp] = useState<string | null>(null);
  const { providers } = cluster;
  const repP     = providers[0];
  const city     = repP?.geo?.city ?? cluster.zone;
  const country  = repP?.geo?.countryCode ?? "";
  const flag     = ZONE_DISPLAY[cluster.zone]?.flag ?? "🌐";
  const healthy  = providers.filter(p => p.health === "Healthy").length;

  const bg  = isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.98)";
  const bdr = isDark ? "rgba(56,189,248,0.25)" : "#e2e8f0";
  const pt  = isDark ? "#e2e8f0" : "#111827";
  const pm  = isDark ? "#94a3b8" : "#6b7280";

  return (
    <div style={{ position:"absolute",top:"50%",right:12,transform:"translateY(-50%)",zIndex:100, width:"min(340px,calc(100vw - 24px))",maxHeight:"80vh", background:bg,border:`1px solid ${bdr}`,borderRadius:14,padding:"15px 17px", boxShadow:"0 20px 50px rgba(0,0,0,0.35)",display:"flex",flexDirection:"column", backdropFilter:"blur(16px)",pointerEvents:pinned?"auto":"none" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0 }}>
        <div>
          <div style={{ fontSize:15,fontWeight:700,color:pt }}>{flag} {city}{country?`, ${country}`:""}</div>
          <div style={{ fontSize:11,color:pm,marginTop:2 }}>{healthy}/{providers.length} healthy{!pinned&&<span style={{ marginLeft:8,opacity:0.6 }}>· Click to pin</span>}</div>
        </div>
        {pinned && <button onClick={onClose} style={{ background:"none",border:"none",color:pm,cursor:"pointer",fontSize:22,lineHeight:1 }}>×</button>}
      </div>
      <div style={{ overflowY:"auto",display:"flex",flexDirection:"column",gap:8 }}>
        {providers.map((p, i) => {
          const dotColor = healthDotColor(p);
          const bls      = p.fullBlsKey || p.blsKey || "";
          return (
            <div key={p.address || i} style={{ background:`${dotColor}10`,border:`1px solid ${dotColor}30`,borderRadius:9,padding:"9px 11px" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4 }}>
                <span style={{ fontFamily:"monospace",fontSize:12,fontWeight:700,color:pt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1 }}>{p.addressShort}</span>
                <div style={{ display:"flex",gap:3,flexShrink:0,marginLeft:6 }}>
                  <span style={{ fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:`${dotColor}20`,color:dotColor }}>{p.health==="Unknown"?"Awaiting":p.health}</span>
                  <span style={{ fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:p.state==="Frozen"?"rgba(96,165,250,0.2)":p.state==="Waitlisted"?"rgba(245,158,11,0.2)":"rgba(34,197,94,0.12)",color:p.state==="Frozen"?"#60a5fa":p.state==="Waitlisted"?"#f59e0b":"#22c55e" }}>{p.state}</span>
                </div>
              </div>
              <div style={{ fontSize:10,color:pm }}>{p.availabilityZone}</div>
              {p.netAddress&&<div style={{ fontSize:9,color:pm,fontFamily:"monospace",marginTop:2 }}>{p.netAddress}</div>}
              {bls&&(
                <div style={{ display:"flex",alignItems:"center",gap:4,background:"rgba(128,128,128,0.07)",borderRadius:4,padding:"3px 6px",marginTop:4 }}>
                  <span style={{ fontSize:8,color:pm,flexShrink:0 }}>BLS</span>
                  <span style={{ fontSize:9,fontFamily:"monospace",color:pt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{bls.slice(0,28)}…</span>
                  {pinned&&(
                    <button onClick={async()=>{ await navigator.clipboard.writeText(bls).catch(()=>{}); setCp(p.address); setTimeout(()=>setCp(null),1500); }} style={{ background:"none",border:"none",cursor:"pointer",fontSize:11,color:cp===p.address?"#22c55e":pm }}>
                      {cp===p.address?"✓":"⧉"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Geo share panel ───────────────────────────────────────────────────────────
function GeoShare({ clusters, isDark }: { clusters: ClusterEntry[]; isDark: boolean }) {
  const total = clusters.reduce((s, c) => s + c.providers.length, 0);
  const allH  = clusters.flatMap(c => c.providers).filter(p => p.health === "Healthy").length;

  const byCountry = new Map<string, { label: string; count: number; color: string }>();
  clusters.forEach((c, i) => {
    const cc    = c.providers[0]?.geo?.countryCode ?? "??";
    const city  = c.providers[0]?.geo?.city ?? c.zone;
    const label = `${city} (${cc})`;
    if (!byCountry.has(cc)) byCountry.set(cc, { label, count: 0, color: ZONE_COLORS[i % ZONE_COLORS.length] });
    byCountry.get(cc)!.count += c.providers.length;
  });
  const entries = Array.from(byCountry.values()).sort((a, b) => b.count - a.count);

  const R = 38, cx = 48, cy = 48, stroke = 13, circ = 2 * Math.PI * R;
  let off = 0;
  const bg  = isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.97)";
  const bdr = isDark ? "rgba(56,189,248,0.2)"  : "#e2e8f0";
  const pt  = isDark ? "#e2e8f0" : "#111827";
  const pm  = isDark ? "#94a3b8" : "#6b7280";

  return (
    <div style={{ background:bg,border:`1px solid ${bdr}`,borderRadius:13,padding:"12px 14px",width:270,backdropFilter:"blur(12px)" }}>
      <div style={{ fontSize:10,fontWeight:700,color:pt,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:1 }}>Geographic Distribution</div>
      <div style={{ fontSize:9,color:pm,marginBottom:10 }}>Based on real IP geolocation</div>
      <div style={{ display:"flex",gap:12,alignItems:"center",marginBottom:10 }}>
        <svg width={96} height={96} viewBox="0 0 96 96" style={{ flexShrink:0 }}>
          {entries.map(e => {
            const pct=e.count/total, d=pct*circ, g=circ-d;
            const seg=<circle key={e.label} cx={cx} cy={cy} r={R} fill="none" stroke={e.color} strokeWidth={stroke} strokeDasharray={`${d} ${g}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} opacity={0.9}/>;
            off+=d; return seg;
          })}
          <text x={cx} y={cx-3} textAnchor="middle" fontSize={14} fontWeight={800} fill={pt}>{total}</text>
          <text x={cx} y={cx+9} textAnchor="middle" fontSize={8} fill={pm}>SPs</text>
        </svg>
        <div style={{ display:"flex",flexDirection:"column",gap:5,flex:1 }}>
          {entries.slice(0,8).map(e=>(
            <div key={e.label} style={{ display:"flex",alignItems:"center",gap:5 }}>
              <div style={{ width:7,height:7,borderRadius:2,background:e.color,flexShrink:0 }}/>
              <span style={{ fontSize:10,color:pt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{e.label}</span>
              <span style={{ fontSize:9,fontWeight:700,color:pt,fontFamily:"monospace",flexShrink:0 }}>{e.count}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display:"flex",paddingTop:8,borderTop:`1px solid ${bdr}` }}>
        {[{ label:"CITIES",value:String(clusters.length) },{ label:"TOTAL",value:String(total) },{ label:"HEALTHY",value:String(allH) }].map(({ label,value },i)=>(
          <div key={label} style={{ flex:1,textAlign:"center",borderRight:i<2?`1px solid ${bdr}`:"none" }}>
            <div style={{ fontSize:16,fontWeight:800,color:pt,fontFamily:"monospace" }}>{value}</div>
            <div style={{ fontSize:8,color:pm,letterSpacing:"0.06em" }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function WorldMapInner({ providers }: { providers: StorageProvider[] }) {
  const { isDark } = useTheme();

  const [scale,  setScale]  = useState(DEFAULT_SCALE);
  const [center, setCenter] = useState<[number,number]>(DEFAULT_CENTER);

  const isDragging      = useRef(false);
  const didDrag         = useRef(false);
  const dragStart       = useRef({ x:0, y:0 });
  const centerOnDown    = useRef<[number,number]>(DEFAULT_CENTER);
  const containerRef    = useRef<HTMLDivElement>(null);
  const isMouseInside   = useRef(false);
  const lastTouchDist   = useRef<number | null>(null);

  const [hoverKey,  setHoverKey]  = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noGeoCount = providers.filter(p => !p.geo?.lat).length;
  const clusters   = buildClusters(providers);

  const oceanColor = isDark ? "#0d1526" : "#c5d8f0";
  const landColor  = isDark ? "#1e3a5f" : "#d4a574";
  const borderColor = isDark ? "#0d1526" : "#c5d8f0";

  const handleEnter = useCallback((key: string) => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    setHoverKey(key);
  }, []);
  const handleLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => { if (!pinnedKey) setHoverKey(null); }, 220);
  }, [pinnedKey]);

  const zoomIn  = useCallback(() => setScale(s => Math.min(MAX_SCALE, Math.round(s * 1.6))), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(MIN_SCALE, Math.round(s / 1.6))), []);
  const reset   = useCallback(() => { setScale(DEFAULT_SCALE); setCenter(DEFAULT_CENTER); }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - dragStart.current.x, dy = e.clientY - dragStart.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
      const pxPerDeg = scale / 60;
      setCenter([
        centerOnDown.current[0] - dx / pxPerDeg,
        Math.max(-80, Math.min(80, centerOnDown.current[1] + dy / pxPerDeg)),
      ]);
    };
    const onUp = () => { isDragging.current = false; if (containerRef.current) containerRef.current.style.cursor = "grab"; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [scale]);

  const onContainerMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-nopan]")) return;
    e.preventDefault();
    isDragging.current = true; didDrag.current = false;
    dragStart.current  = { x: e.clientX, y: e.clientY };
    centerOnDown.current = [...center] as [number,number];
    if (containerRef.current) containerRef.current.style.cursor = "grabbing";
  }, [center]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!isMouseInside.current) return;
      e.preventDefault(); e.stopPropagation();
      setScale(s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(s * (e.deltaY < 0 ? 1.18 : 1/1.18)))));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const getTouchDist = (a: React.Touch, b: React.Touch) => Math.hypot(b.clientX-a.clientX, b.clientY-a.clientY);
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!e.touches?.length) return;
    if (e.touches.length === 1) {
      isDragging.current = true; didDrag.current = false;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      centerOnDown.current = [...center] as [number,number];
      lastTouchDist.current = null;
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      lastTouchDist.current = getTouchDist(e.touches[0], e.touches[1]);
    }
  }, [center]);
  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.cancelable) e.preventDefault();
    if (!e.touches?.length) return;
    if (e.touches.length === 1 && isDragging.current) {
      const dx = e.touches[0].clientX - dragStart.current.x, dy = e.touches[0].clientY - dragStart.current.y;
      if (Math.abs(dx)>3||Math.abs(dy)>3) didDrag.current=true;
      const pxPerDeg = scale/60;
      setCenter([centerOnDown.current[0]-dx/pxPerDeg, Math.max(-80,Math.min(80,centerOnDown.current[1]+dy/pxPerDeg))]);
    } else if (e.touches.length===2 && lastTouchDist.current!==null) {
      const nd=getTouchDist(e.touches[0],e.touches[1]);
      setScale(s=>Math.max(MIN_SCALE,Math.min(MAX_SCALE,Math.round(s*nd/lastTouchDist.current!))));
      lastTouchDist.current=nd;
    }
  }, [scale]);
  const onTouchEnd = useCallback(() => { isDragging.current=false; lastTouchDist.current=null; }, []);

  const activeKey     = pinnedKey ?? hoverKey;
  const activeCluster = clusters.find(c => c.key === activeKey) ?? null;

  return (
    <div
      ref={containerRef}
      style={{ position:"relative",width:"100%",height:"100%",background:oceanColor,overflow:"hidden",userSelect:"none",cursor:"grab",touchAction:"none" }}
      onMouseDown={onContainerMouseDown}
      onMouseEnter={() => { isMouseInside.current=true; }}
      onMouseLeave={() => {
        isMouseInside.current=false;
        if (isDragging.current) { isDragging.current=false; if(containerRef.current) containerRef.current.style.cursor="grab"; }
      }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      {/* Zoom controls */}
      <div data-nopan="true" style={{ position:"absolute",top:12,right:12,zIndex:30,display:"flex",flexDirection:"column",gap:4 }}>
        {[{label:"+",fn:zoomIn,title:"Zoom in"},{label:"−",fn:zoomOut,title:"Zoom out"},{label:"⊙",fn:reset,title:"Reset view"}].map(({label,fn,title})=>(
          <button key={label} onClick={fn} title={title} style={{ width:30,height:30,borderRadius:7,border:"1px solid var(--border,#e5e7eb)", background:isDark?"rgba(13,21,38,0.92)":"rgba(255,255,255,0.92)", color:isDark?"#e2e8f0":"#374151",fontSize:label==="⊙"?12:18, cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",fontWeight:label==="⊙"?400:700 }}>{label}</button>
        ))}
        <div style={{ fontSize:9,color:isDark?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.3)",textAlign:"center",fontFamily:"monospace",marginTop:2 }}>
          {Math.round(scale/DEFAULT_SCALE*100)}%
        </div>
      </div>

      {/* Map */}
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale, center }}
        style={{ width:"100%",height:"100%" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) => geographies.map(geo => (
            <Geography key={geo.rsmKey} geography={geo} fill={landColor} stroke={borderColor} strokeWidth={0.4}
              style={{ default:{outline:"none"},hover:{outline:"none"},pressed:{outline:"none"} }}/>
          ))}
        </Geographies>

        {/* ── Sovereignty markers — gold square diamonds ── */}
        {SOVEREIGNTY_MARKERS.map(sov => (
          <Marker key={sov.label} coordinates={sov.coords}>
            <g style={{ pointerEvents:"none" }}>
              {/* Gold diamond */}
              <rect
                x={-6} y={-6} width={12} height={12}
                fill="#fbbf24"
                stroke="rgba(0,0,0,0.3)"
                strokeWidth={0.8}
                style={{ transform:"rotate(45deg)", transformOrigin:"center" }}
              />
              <text
                textAnchor="middle"
                dy={18}
                style={{ fontSize:8,fontFamily:"monospace",fill:isDark?"#fde68a":"#92400e",fontWeight:700,textShadow:"0 0 8px rgba(0,0,0,0.8)" }}
              >
                {sov.flag} {sov.label}
              </text>
            </g>
          </Marker>
        ))}

        {/* ── Cluster markers — square diamonds ── */}
        {clusters.map((cluster, ci) => {
          const healthy   = cluster.providers.filter(p => p.health === "Healthy").length;
          const frozen    = cluster.providers.filter(p => p.state  === "Frozen").length;
          const allOk     = healthy === cluster.providers.length && cluster.providers.length > 0;
          const isActive  = activeKey === cluster.key;
          const repP      = cluster.providers[0];
          const glowC     = frozen > 0 ? "#60a5fa" : allOk ? ZONE_COLORS[ci % ZONE_COLORS.length] : "#f59e0b";
          const markerSize = isActive ? 18 : 14;

          return (
            <Marker key={cluster.key} coordinates={[cluster.lng, cluster.lat]}>
              <g
                style={{ cursor:"pointer" }}
                onMouseEnter={e => { e.stopPropagation(); handleEnter(cluster.key); }}
                onMouseLeave={e => { e.stopPropagation(); handleLeave(); }}
                onMouseDown={e => { e.stopPropagation(); isDragging.current = false; }}
                onClick={e => {
                  e.stopPropagation();
                  if (!didDrag.current) setPinnedKey(k => k === cluster.key ? null : cluster.key);
                }}
              >
                {/* Glow ring */}
                <rect
                  x={-markerSize * 1.6} y={-markerSize * 1.6}
                  width={markerSize * 3.2} height={markerSize * 3.2}
                  fill={glowC} fillOpacity={0.08}
                  style={{ transform:"rotate(45deg)", transformOrigin:"center" }}
                />

                {/* Square diamond background */}
                <rect
                  x={-markerSize} y={-markerSize}
                  width={markerSize * 2} height={markerSize * 2}
                  fill={isDark ? "#1e3a5f" : "#1e40af"}
                  stroke={glowC}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  style={{ transform:"rotate(45deg)", transformOrigin:"center", filter:`drop-shadow(0 0 ${isActive?8:4}px ${glowC}88)` }}
                />

                {/* Count */}
                <text
                  textAnchor="middle" dominantBaseline="central"
                  style={{ fontSize: markerSize < 16 ? 10 : 12, fontWeight:800, fill:"#fff", fontFamily:"monospace", pointerEvents:"none" }}
                >
                  {cluster.providers.length}
                </text>

                {/* City label */}
                <text
                  textAnchor="middle"
                  dy={markerSize + 12}
                  style={{ fontSize:9,fill:isDark?"#94a3b8":"#374151",fontFamily:"monospace",pointerEvents:"none" }}
                >
                  {repP?.geo?.city ?? cluster.zone}
                </text>

                {/* Frozen indicator dot */}
                {frozen > 0 && (
                  <circle cx={markerSize * 0.9} cy={-markerSize * 0.9} r={5} fill="#60a5fa" stroke={isDark?"#0d1526":"#fff"} strokeWidth={1.5}/>
                )}
              </g>
            </Marker>
          );
        })}
      </ComposableMap>

      {/* Pending geo warning */}
      {noGeoCount > 0 && (
        <div data-nopan="true" style={{ position:"absolute",bottom:36,left:285,zIndex:10,fontSize:9,color:isDark?"rgba(255,255,255,0.35)":"rgba(0,0,0,0.4)",fontFamily:"monospace",background:isDark?"rgba(13,21,38,0.7)":"rgba(255,255,255,0.7)",padding:"3px 8px",borderRadius:5 }}>
          {noGeoCount} SP{noGeoCount>1?"s":""} pending IP geolocation
        </div>
      )}

      {/* Bottom hints */}
      <div data-nopan="true" style={{ position:"absolute",bottom:10,left:285,zIndex:10,fontSize:9,color:isDark?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.3)",fontFamily:"monospace",display:"flex",alignItems:"center",gap:5,pointerEvents:"none" }}>
        <span style={{ width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block" }}/>
        {providers.filter(p=>p.health==="Healthy").length}/{providers.length} · Scroll=zoom · Drag=pan · Click=pin
      </div>

      {/* Sovereignty badge */}
      <div data-nopan="true" style={{ position:"absolute",bottom:10,right:50,zIndex:10,fontSize:9,color:"rgba(217,119,6,0.85)",fontFamily:"monospace",pointerEvents:"none" }}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Cluster popup */}
      {activeCluster && (
        <div data-nopan="true">
          <ClusterPopup
            cluster={activeCluster}
            pinned={pinnedKey === activeCluster.key}
            onClose={() => { setPinnedKey(null); setHoverKey(null); }}
            isDark={isDark}
          />
        </div>
      )}

      {/* Geo share panel */}
      {clusters.length > 0 && (
        <div data-nopan="true" style={{ position:"absolute",top:12,left:12,zIndex:25 }}>
          <GeoShare clusters={clusters} isDark={isDark}/>
        </div>
      )}
    </div>
  );
}