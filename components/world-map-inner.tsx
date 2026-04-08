"use client";
// components/world-map-inner.tsx — v4.0
// FIX: Loại bỏ ZoomableGroup hoàn toàn → không còn d3-zoom dependency → không crash CF Pages
// Zoom thay thế: tăng/giảm projectionConfig.scale + dịch center
// Hiệu ứng Halo/Pulse/Glow giữ nguyên
// react-simple-maps chỉ dùng: ComposableMap, Geographies, Geography, Marker

import { useState, useCallback, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";
import { useTheme } from "./theme-context";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const ZONES: Record<string,{lng:number;lat:number;label:string;short:string;flag:string}> = {
  dc_us_west:   {lng:-121.89,lat:37.34, label:"US West (San Jose)",short:"US-W",flag:"🇺🇸"},
  dc_us_east:   {lng:-77.44, lat:39.04, label:"US East (Virginia)",short:"US-E",flag:"🇺🇸"},
  dc_europe:    {lng:8.68,   lat:50.11, label:"Europe (Frankfurt)",short:"EU",  flag:"🇩🇪"},
  dc_asia:      {lng:103.82, lat:1.35,  label:"Asia (Singapore)",  short:"SG",  flag:"🇸🇬"},
  dc_australia: {lng:151.21, lat:-33.87,label:"Australia (Sydney)",short:"AU",  flag:"🇦🇺"},
};
const ZONE_COLORS = ["#3b82f6","#22c55e","#a855f7","#f59e0b","#ef4444"];

// Default zoom config
const DEFAULT_SCALE  = 185;
const DEFAULT_CENTER: [number,number] = [15, 5];
const MIN_SCALE      = 100;
const MAX_SCALE      = 900;

// GeoShare panel
function GeoShare({byZone,isDark}:{byZone:Map<string,StorageProvider[]>;isDark:boolean}) {
  const total = Array.from(byZone.values()).reduce((s,a)=>s+a.length,0);
  const entries = Array.from(byZone.entries()).map(([z,sps],i)=>({
    zone:z,label:ZONES[z]?.label??z,flag:ZONES[z]?.flag??"🌐",
    count:sps.length,pct:total>0?sps.length/total*100:0,color:ZONE_COLORS[i%ZONE_COLORS.length],
  })).sort((a,b)=>b.count-a.count);
  const R=38,cx=48,cy=48,stroke=13,circ=2*Math.PI*R;
  let off=0;
  const allH = Array.from(byZone.values()).flat().filter(p=>p.health==="Healthy").length;
  const bg  = isDark?"rgba(13,21,38,0.97)":"rgba(255,255,255,0.97)";
  const bdr = isDark?"rgba(56,189,248,0.2)":"#e2e8f0";
  const pt  = isDark?"#e2e8f0":"#111827";
  const pm  = isDark?"#94a3b8":"#6b7280";
  return(
    <div style={{background:bg,border:`1px solid ${bdr}`,borderRadius:13,padding:"12px 14px",width:270,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
      <div style={{fontSize:10,fontWeight:700,color:pt,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:1}}>Geographic & Provider Share</div>
      <div style={{fontSize:9,color:pm,marginBottom:10}}>Compare zone distribution</div>
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
        <svg width={96} height={96} viewBox="0 0 96 96" style={{flexShrink:0}}>
          {entries.map(e=>{const d=e.pct/100*circ,g=circ-d;const seg=<circle key={e.zone} cx={cx} cy={cy} r={R} fill="none" stroke={e.color} strokeWidth={stroke} strokeDasharray={`${d} ${g}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} opacity={0.9}/>;off+=d;return seg;})}
          <text x={cx} y={cx-3} textAnchor="middle" fontSize={14} fontWeight={800} fill={pt}>{total}</text>
          <text x={cx} y={cx+9} textAnchor="middle" fontSize={8} fill={pm}>SPs</text>
        </svg>
        <div style={{display:"flex",flexDirection:"column",gap:5,flex:1,minWidth:0}}>
          {entries.map(e=>(
            <div key={e.zone} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:7,height:7,borderRadius:2,background:e.color,flexShrink:0}}/>
              <span style={{fontSize:10,color:pt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.flag} {e.label.split("(")[0].trim()}</span>
              <span style={{fontSize:9,fontWeight:700,color:pt,fontFamily:"monospace",flexShrink:0}}>{e.count} <span style={{color:pm,fontWeight:400}}>· {e.pct.toFixed(0)}%</span></span>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:"flex",paddingTop:8,borderTop:`1px solid ${bdr}`}}>
        {[{label:"ZONES",value:String(entries.length)},{label:"TOTAL",value:String(total)},{label:"HEALTHY",value:String(allH)}].map(({label,value},i)=>(
          <div key={label} style={{flex:1,textAlign:"center",borderRight:i<2?`1px solid ${bdr}`:"none"}}>
            <div style={{fontSize:16,fontWeight:800,color:pt,fontFamily:"monospace"}}>{value}</div>
            <div style={{fontSize:8,color:pm,letterSpacing:"0.06em"}}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Cluster popup
function ClusterPopup({zone,sps,pinned,onClose,isDark}:{zone:string;sps:StorageProvider[];pinned:boolean;onClose:()=>void;isDark:boolean}) {
  const [cp,setCp] = useState<string|null>(null);
  const meta = ZONES[zone];
  const bg   = isDark?"rgba(13,21,38,0.97)":"rgba(255,255,255,0.98)";
  const bdr  = isDark?"rgba(56,189,248,0.25)":"#e2e8f0";
  const pt   = isDark?"#e2e8f0":"#111827";
  const pm   = isDark?"#94a3b8":"#6b7280";
  return(
    <div style={{position:"absolute",top:"50%",right:12,transform:"translateY(-50%)",zIndex:100,
      width:"min(340px,calc(100vw - 24px))",maxHeight:"80vh",
      background:bg,border:`1px solid ${bdr}`,borderRadius:14,padding:"15px 17px",
      boxShadow:"0 20px 50px rgba(0,0,0,0.35)",display:"flex",flexDirection:"column",
      backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",
      pointerEvents:pinned?"auto":"none"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:pt}}>{meta?.flag} {meta?.label??zone}</div>
          <div style={{fontSize:11,color:pm,marginTop:2}}>{sps.filter(p=>p.health==="Healthy").length}/{sps.length} healthy{!pinned&&<span style={{marginLeft:8,opacity:.6}}>· Click to pin</span>}</div>
        </div>
        {pinned&&<button onClick={onClose} style={{background:"none",border:"none",color:pm,cursor:"pointer",fontSize:22,lineHeight:1,pointerEvents:"auto"}}>×</button>}
      </div>
      <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        {sps.map((p,i)=>{
          const isH=p.health==="Healthy",bls=p.fullBlsKey||p.blsKey||"";
          return(
            <div key={p.address||i} style={{background:isH?"rgba(34,197,94,0.07)":"rgba(239,68,68,0.07)",border:`1px solid ${isH?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"}`,borderRadius:9,padding:"9px 11px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:700,color:pt,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{p.addressShort}</span>
                <div style={{display:"flex",gap:3,flexShrink:0,marginLeft:6}}>
                  <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:isH?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)",color:isH?"#22c55e":"#ef4444"}}>{p.health}</span>
                  <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:"rgba(245,158,11,0.12)",color:"#f59e0b"}}>{p.state}</span>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 8px",marginBottom:bls?5:0}}>
                {p.capacityTiB!=null&&<div><div style={{fontSize:8,color:pm,textTransform:"uppercase"}}>Capacity</div><div style={{fontSize:10,color:pt,fontWeight:500}}>{p.capacityTiB.toFixed(1)} TiB</div></div>}
                {p.geo?.city&&<div><div style={{fontSize:8,color:pm,textTransform:"uppercase"}}>City</div><div style={{fontSize:10,color:pt,fontWeight:500}}>{p.geo.city}, {p.geo.countryCode}</div></div>}
              </div>
              {bls&&(
                <div style={{display:"flex",alignItems:"center",gap:4,background:"rgba(128,128,128,0.07)",borderRadius:4,padding:"3px 6px"}}>
                  <span style={{fontSize:8,color:pm,flexShrink:0}}>BLS</span>
                  <span style={{fontSize:9,fontFamily:"monospace",color:pt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{bls.slice(0,28)}…</span>
                  {pinned&&<button onClick={async()=>{await navigator.clipboard.writeText(bls).catch(()=>{});setCp(p.address);setTimeout(()=>setCp(null),1500);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:cp===p.address?"#22c55e":pm,pointerEvents:"auto"}}>{cp===p.address?"✓":"⧉"}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WorldMapInner({providers}:{providers:StorageProvider[]}) {
  const {isDark} = useTheme();

  // ZOOM: thay ZoomableGroup bằng state scale + center
  // Tăng/giảm projectionConfig.scale trực tiếp → re-render ComposableMap
  // Không dùng d3-zoom → không crash
  const [scale,  setScale]  = useState(DEFAULT_SCALE);
  const [center, setCenter] = useState<[number,number]>(DEFAULT_CENTER);

  const [hoverZone,  setHoverZone]  = useState<string|null>(null);
  const [pinnedZone, setPinnedZone] = useState<string|null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const byZone = new Map<string,StorageProvider[]>();
  providers.forEach(p=>{const z=p.availabilityZone??"unknown";if(!byZone.has(z))byZone.set(z,[]);byZone.get(z)!.push(p);});
  const azones = Array.from(byZone.keys()).filter(z=>ZONES[z]);
  const ZONE_LIST = azones.map((z,i)=>({key:z,...ZONES[z],color:ZONE_COLORS[i%ZONE_COLORS.length],sps:byZone.get(z)??[]}));

  const oceanColor = isDark?"#0d1526":"#c5d8f0";
  const landColor  = isDark?"#1e3a5f":"#d4a574";
  const borderColor = isDark?"#0d1526":"#c5d8f0";

  const handleEnter = useCallback((zone:string)=>{
    if(leaveTimer.current){clearTimeout(leaveTimer.current);leaveTimer.current=null;}
    setHoverZone(zone);
  },[]);
  const handleLeave = useCallback(()=>{
    leaveTimer.current = setTimeout(()=>{if(!pinnedZone)setHoverZone(null);},220);
  },[pinnedZone]);

  // Zoom via scale manipulation (no d3-zoom)
  const zoomIn  = ()=>setScale(s=>Math.min(MAX_SCALE,Math.round(s*1.6)));
  const zoomOut = ()=>setScale(s=>Math.max(MIN_SCALE,Math.round(s/1.6)));
  const reset   = ()=>{setScale(DEFAULT_SCALE);setCenter(DEFAULT_CENTER);};

  // Scroll wheel zoom on container
  const onWheel = useCallback((e:React.WheelEvent<HTMLDivElement>)=>{
    e.preventDefault();
    if(e.deltaY<0) setScale(s=>Math.min(MAX_SCALE,Math.round(s*1.25)));
    else           setScale(s=>Math.max(MIN_SCALE,Math.round(s/1.25)));
  },[]);

  const activeZone = pinnedZone??hoverZone;

  return(
    <div
      style={{position:"relative",width:"100%",height:"100%",background:oceanColor,overflow:"hidden",userSelect:"none"}}
      onWheel={onWheel}
    >
      <style>{`
        @keyframes halo-ring1 {
          0%   { r:18; opacity:0.65; stroke-width:2.5; }
          100% { r:40; opacity:0;   stroke-width:0.8; }
        }
        @keyframes halo-ring2 {
          0%   { r:18; opacity:0.4;  stroke-width:1.5; }
          100% { r:56; opacity:0;   stroke-width:0.5; }
        }
        @keyframes pulse-breath {
          0%,100% { opacity:1; }
          50%     { opacity:0.55; }
        }
        .halo1 { animation: halo-ring1 2.2s ease-out infinite; }
        .halo2 { animation: halo-ring2 2.2s ease-out 0.75s infinite; }
        .pulse { animation: pulse-breath 2.1s ease-in-out infinite; }
      `}</style>

      {/* Zoom buttons — top right, clear of GeoShare */}
      <div style={{position:"absolute",top:12,right:12,zIndex:30,display:"flex",flexDirection:"column",gap:4}}>
        {[{label:"+",fn:zoomIn,title:"Zoom in"},{label:"−",fn:zoomOut,title:"Zoom out"},{label:"⊙",fn:reset,title:"Reset"}].map(({label,fn,title})=>(
          <button key={label} onClick={fn} title={title} style={{
            width:30,height:30,borderRadius:7,border:"1px solid var(--border,#e5e7eb)",
            background:isDark?"rgba(13,21,38,0.92)":"rgba(255,255,255,0.92)",
            color:isDark?"#e2e8f0":"#374151",fontSize:label==="⊙"?12:18,
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            backdropFilter:"blur(8px)",fontWeight:label==="⊙"?400:700,
          }}>
            {label}
          </button>
        ))}
        {/* Zoom level indicator */}
        <div style={{fontSize:9,color:isDark?"rgba(255,255,255,0.3)":"rgba(0,0,0,0.3)",textAlign:"center",fontFamily:"monospace",marginTop:2}}>
          {Math.round(scale/DEFAULT_SCALE*100)}%
        </div>
      </div>

      {/* Map — NO ZoomableGroup, projection scale controlled by state */}
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{ scale, center }}
        style={{width:"100%",height:"100%"}}
      >
        <Geographies geography={GEO_URL}>
          {({geographies})=>geographies.map(geo=>(
            <Geography key={geo.rsmKey} geography={geo}
              fill={landColor} stroke={borderColor} strokeWidth={0.4}
              style={{default:{outline:"none"},hover:{outline:"none",fill:isDark?"#2d5282":"#c49060"},pressed:{outline:"none"}}}
            />
          ))}
        </Geographies>

        {/* Zone markers with Halo + Pulse + Glow — NO arcs */}
        {ZONE_LIST.map((zd,zi)=>{
          const sps    = zd.sps;
          const healthy = sps.filter(p=>p.health==="Healthy").length;
          const allOk  = healthy===sps.length&&sps.length>0;
          const isActive = activeZone===zd.key;
          const c      = zd.color;
          const glowC  = allOk?c:"#ef4444";

          return(
            <Marker key={zd.key} coordinates={[zd.lng,zd.lat]}>
              <g style={{cursor:"pointer"}}
                onMouseEnter={()=>handleEnter(zd.key)}
                onMouseLeave={handleLeave}
                onClick={e=>{e.stopPropagation();setPinnedZone(z=>z===zd.key?null:zd.key);setHoverZone(zd.key);}}
              >
                {/* Halo ring 1 */}
                <circle className="halo1" cx={0} cy={0} r={18} fill="none" stroke={glowC} strokeWidth={2.5} opacity={0}/>
                {/* Halo ring 2 — delayed */}
                <circle className="halo2" cx={0} cy={0} r={18} fill="none" stroke={glowC} strokeWidth={1.5} opacity={0}/>

                {/* SVG glow filter — drop-shadow */}
                <defs>
                  <filter id={`gf${zi}`} x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation={isActive?"7":"3.5"} result="blur"/>
                    <feFlood floodColor={glowC} floodOpacity={isActive?"0.75":"0.45"} result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="glow"/>
                    <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>

                {/* Main bubble: Pulse + Glow */}
                <circle className={allOk?"pulse":undefined} cx={0} cy={0} r={16}
                  fill={allOk?(isDark?"#1e3a5f":"#1e40af"):"#7f1d1d"}
                  stroke={glowC} strokeWidth={isActive?2.8:2}
                  filter={`url(#gf${zi})`}
                  fillOpacity={0.93}
                />

                {/* Count */}
                <text textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={800} fill="#fff" fontFamily="monospace" style={{pointerEvents:"none"}}>
                  {sps.length}
                </text>
                {/* Label */}
                <text textAnchor="middle" dy={26} fontSize={9} fill={isDark?"#94a3b8":"#374151"} fontFamily="monospace" style={{pointerEvents:"none"}}>
                  {zd.short}
                </text>
                {/* Unhealthy dot */}
                {!allOk&&<circle cx={12} cy={-12} r={5} fill="#ef4444" stroke={isDark?"#0d1526":"#fff"} strokeWidth={1.5}/>}
              </g>
            </Marker>
          );
        })}
      </ComposableMap>

      {/* Bottom hints */}
      <div style={{position:"absolute",bottom:10,left:285,zIndex:10,fontSize:9,color:isDark?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.3)",fontFamily:"monospace",display:"flex",alignItems:"center",gap:5}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block"}}/>
        {providers.filter(p=>p.health==="Healthy").length}/{providers.length} · Scroll=zoom · Hover=inspect · Click=pin
      </div>
      <div style={{position:"absolute",bottom:10,right:50,zIndex:10,fontSize:9,color:"rgba(217,119,6,0.85)",fontFamily:"monospace"}}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Cluster popup */}
      {activeZone&&byZone.has(activeZone)&&(
        <ClusterPopup zone={activeZone} sps={byZone.get(activeZone)!}
          pinned={pinnedZone===activeZone}
          onClose={()=>{setPinnedZone(null);setHoverZone(null);}}
          isDark={isDark}
        />
      )}

      {/* GeoShare — top left */}
      {providers.length>0&&(
        <div style={{position:"absolute",top:12,left:12,zIndex:25}}>
          <GeoShare byZone={byZone} isDark={isDark}/>
        </div>
      )}
    </div>
  );
}