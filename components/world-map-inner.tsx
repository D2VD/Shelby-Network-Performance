"use client";
// components/world-map-inner.tsx — v3.0
// 1. Zoom: react-simple-maps hỗ trợ zoom qua ZoomableGroup (không dùng d3-zoom → không crash)
// 2. Bỏ đường nối arcs → thay bằng Halo/Pulse/Glow effects trên SVG overlay
// 3. GeoShare: position absolute left:12, top: sau badge area (~60px) → không đè

import { useState, useRef, useCallback } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
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
const ZONE_COLORS=["#3b82f6","#22c55e","#a855f7","#f59e0b","#ef4444"];

// ── GeoShare — fixed position below header badges ─────────────────────────────
function GeoShare({byZone,isDark}:{byZone:Map<string,StorageProvider[]>;isDark:boolean}) {
  const total=Array.from(byZone.values()).reduce((s,a)=>s+a.length,0);
  const entries=Array.from(byZone.entries()).map(([z,sps],i)=>({
    zone:z,label:ZONES[z]?.label??z,flag:ZONES[z]?.flag??"🌐",
    count:sps.length,pct:total>0?sps.length/total*100:0,color:ZONE_COLORS[i%ZONE_COLORS.length],
  })).sort((a,b)=>b.count-a.count);
  const R=38,cx=48,cy=48,stroke=13,circ=2*Math.PI*R;
  let off=0;
  const allH=Array.from(byZone.values()).flat().filter(p=>p.health==="Healthy").length;
  const bg =isDark?"rgba(13,21,38,0.97)":"rgba(255,255,255,0.97)";
  const bdr=isDark?"rgba(56,189,248,0.2)":"#e2e8f0";
  const pt =isDark?"#e2e8f0":"#111827";
  const pm =isDark?"#94a3b8":"#6b7280";
  return(
    <div style={{background:bg,border:`1px solid ${bdr}`,borderRadius:13,padding:"12px 14px",width:270,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
      <div style={{fontSize:10,fontWeight:700,color:pt,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:1}}>Geographic & Provider Share</div>
      <div style={{fontSize:9,color:pm,marginBottom:10}}>Compare zone distribution</div>
      <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:10}}>
        <svg width={96} height={96} viewBox="0 0 96 96" style={{flexShrink:0}}>
          {entries.map(e=>{const dash=e.pct/100*circ,gap=circ-dash;const seg=<circle key={e.zone} cx={cx} cy={cy} r={R} fill="none" stroke={e.color} strokeWidth={stroke} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} opacity={0.9}/>;off+=dash;return seg;})}
          <text x={cx} y={cy-3} textAnchor="middle" fontSize={14} fontWeight={800} fill={pt}>{total}</text>
          <text x={cx} y={cy+9} textAnchor="middle" fontSize={8} fill={pm}>SPs</text>
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

// ── Cluster popup ─────────────────────────────────────────────────────────────
function ClusterPopup({zone,sps,pinned,onClose,isDark}:{zone:string;sps:StorageProvider[];pinned:boolean;onClose:()=>void;isDark:boolean}) {
  const [cp,setCp]=useState<string|null>(null);
  const meta=ZONES[zone];
  const bg=isDark?"rgba(13,21,38,0.97)":"rgba(255,255,255,0.98)";
  const bdr=isDark?"rgba(56,189,248,0.25)":"#e2e8f0";
  const pt=isDark?"#e2e8f0":"#111827";
  const pm=isDark?"#94a3b8":"#6b7280";
  return(
    <div style={{position:"absolute",top:"50%",right:12,transform:"translateY(-50%)",zIndex:100,
      width:"min(340px, calc(100vw - 24px))",maxHeight:"80vh",
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
        {sps.map((p,i)=>{const isH=p.health==="Healthy",bls=p.fullBlsKey||p.blsKey||"";return(
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
        );})}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function WorldMapInner({providers}:{providers:StorageProvider[]}) {
  const {isDark}=useTheme();
  const [zoom,setZoom]=useState(1);
  const [center,setCenter]=useState<[number,number]>([15,5]);
  const [hoverZone,setHoverZone]=useState<string|null>(null);
  const [pinnedZone,setPinnedZone]=useState<string|null>(null);
  const leaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

  const byZone=new Map<string,StorageProvider[]>();
  providers.forEach(p=>{const z=p.availabilityZone??"unknown";if(!byZone.has(z))byZone.set(z,[]);byZone.get(z)!.push(p);});
  const azones=Array.from(byZone.keys()).filter(z=>ZONES[z]);
  const ZONE_LIST=azones.map((z,i)=>({key:z,...ZONES[z],color:ZONE_COLORS[i%ZONE_COLORS.length],sps:byZone.get(z)??[]}));

  const oceanColor=isDark?"#0d1526":"#c5d8f0";
  const landColor=isDark?"#1e3a5f":"#d4a574";
  const borderColor=isDark?"#0d1526":"#c5d8f0";

  const handleZoneEnter=useCallback((zone:string)=>{
    if(leaveTimer.current){clearTimeout(leaveTimer.current);leaveTimer.current=null;}
    setHoverZone(zone);
  },[]);
  const handleZoneLeave=useCallback(()=>{
    leaveTimer.current=setTimeout(()=>{if(!pinnedZone)setHoverZone(null);},220);
  },[pinnedZone]);

  // Zoom controls — không dùng d3-zoom, chỉ dùng ZoomableGroup built-in
  const zoomIn=()=>setZoom(z=>Math.min(8,z*1.5));
  const zoomOut=()=>setZoom(z=>Math.max(1,z/1.5));
  const reset=()=>{setZoom(1);setCenter([15,5]);};

  const activeZone=pinnedZone??hoverZone;

  return(
    <div style={{position:"relative",width:"100%",height:"100%",background:oceanColor,overflow:"hidden",userSelect:"none"}}>
      <style>{`
        @keyframes halo-expand {
          0%   { r: 16; opacity: 0.7; }
          100% { r: 38; opacity: 0; }
        }
        @keyframes halo-expand2 {
          0%   { r: 16; opacity: 0.5; }
          100% { r: 52; opacity: 0; }
        }
        @keyframes pulse-scale {
          0%,100% { opacity: 0.9; }
          50%      { opacity: 0.55; }
        }
        .marker-halo1 { animation: halo-expand  2.4s ease-out infinite; }
        .marker-halo2 { animation: halo-expand2 2.4s ease-out 0.8s infinite; }
        .marker-pulse { animation: pulse-scale   2s ease-in-out infinite; }
      `}</style>

      {/* Zoom controls — top right, không che GeoShare */}
      <div style={{position:"absolute",top:12,right:12,zIndex:30,display:"flex",flexDirection:"column",gap:4}}>
        <button onClick={zoomIn} title="Zoom in" style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:isDark?"rgba(13,21,38,0.9)":"rgba(255,255,255,0.9)",color:isDark?"#e2e8f0":"#374151",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>+</button>
        <button onClick={zoomOut} title="Zoom out" style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:isDark?"rgba(13,21,38,0.9)":"rgba(255,255,255,0.9)",color:isDark?"#e2e8f0":"#374151",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>−</button>
        <button onClick={reset} title="Reset view" style={{width:32,height:32,borderRadius:8,border:"1px solid var(--border)",background:isDark?"rgba(13,21,38,0.9)":"rgba(255,255,255,0.9)",color:isDark?"#e2e8f0":"#374151",fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>⊙</button>
      </div>

      {/* Map */}
      <ComposableMap
        projection="geoNaturalEarth1"
        projectionConfig={{scale:185,center:[15,5]}}
        style={{width:"100%",height:"100%"}}
      >
        <ZoomableGroup
          zoom={zoom}
          center={center}
          onMoveEnd={({zoom:z,coordinates})=>{setZoom(z);setCenter(coordinates as [number,number]);}}
          minZoom={1}
          maxZoom={8}
        >
          {/* Land */}
          <Geographies geography={GEO_URL}>
            {({geographies})=>geographies.map(geo=>(
              <Geography key={geo.rsmKey} geography={geo}
                fill={landColor} stroke={borderColor} strokeWidth={0.4}
                style={{default:{outline:"none"},hover:{outline:"none",fill:isDark?"#2d5282":"#c49060"},pressed:{outline:"none"}}}
              />
            ))}
          </Geographies>

          {/* Zone markers — Halo + Pulse + Glow (NO arcs) */}
          {ZONE_LIST.map((zd,zi)=>{
            const sps=zd.sps;
            const healthy=sps.filter(p=>p.health==="Healthy").length;
            const allOk=healthy===sps.length&&sps.length>0;
            const isActive=activeZone===zd.key;
            const c=zd.color;
            const glowColor=allOk?c:"#ef4444";

            return(
              <Marker key={zd.key} coordinates={[zd.lng,zd.lat]}>
                <g style={{cursor:"pointer"}}
                  onMouseEnter={()=>handleZoneEnter(zd.key)}
                  onMouseLeave={handleZoneLeave}
                  onClick={e=>{e.stopPropagation();setPinnedZone(z=>z===zd.key?null:zd.key);setHoverZone(zd.key);}}
                >
                  {/* Halo ring 1 — tỏa ra & mờ dần (Halo/Ripple effect) */}
                  <circle className="marker-halo1" cx={0} cy={0} r={16} fill="none"
                    stroke={glowColor} strokeWidth={2} opacity={0}/>
                  {/* Halo ring 2 — delay để tạo cảm giác ripple liên tục */}
                  <circle className="marker-halo2" cx={0} cy={0} r={16} fill="none"
                    stroke={glowColor} strokeWidth={1.2} opacity={0}/>

                  {/* Glow background — drop shadow bằng SVG filter */}
                  <defs>
                    <filter id={`glow_${zi}`} x="-80%" y="-80%" width="260%" height="260%">
                      <feGaussianBlur stdDeviation={isActive?"6":"3"} result="blur"/>
                      <feFlood floodColor={glowColor} floodOpacity={isActive?"0.7":"0.4"} result="color"/>
                      <feComposite in="color" in2="blur" operator="in" result="glowed"/>
                      <feMerge><feMergeNode in="glowed"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>

                  {/* Main bubble — Pulse effect + Glow filter */}
                  <circle className={allOk?"marker-pulse":undefined} cx={0} cy={0} r={16}
                    fill={allOk?(isDark?"#1e3a5f":"#1e40af"):"#7f1d1d"}
                    stroke={allOk?c:"#ef4444"} strokeWidth={isActive?2.8:2}
                    filter={`url(#glow_${zi})`}
                    fillOpacity={0.93}
                  />

                  {/* SP count */}
                  <text textAnchor="middle" dy="0.35em" fontSize={12} fontWeight={800} fill="#fff" fontFamily="monospace" style={{pointerEvents:"none"}}>
                    {sps.length}
                  </text>
                  {/* Zone label below */}
                  <text textAnchor="middle" dy={26} fontSize={9} fill={isDark?"#94a3b8":"#374151"} fontFamily="monospace" style={{pointerEvents:"none"}}>
                    {zd.short}
                  </text>
                  {/* Unhealthy dot */}
                  {!allOk&&<circle cx={12} cy={-12} r={5} fill="#ef4444" stroke={isDark?"#0d1526":"#fff"} strokeWidth={1.5}/>}
                </g>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {/* Bottom hints */}
      <div style={{position:"absolute",bottom:10,left:285,zIndex:10,fontSize:9,color:isDark?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.3)",fontFamily:"monospace",display:"flex",alignItems:"center",gap:5}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block"}}/>
        {providers.filter(p=>p.health==="Healthy").length}/{providers.length} · Scroll=zoom · Drag=pan · Hover=inspect · Click=pin
      </div>
      <div style={{position:"absolute",bottom:10,right:50,zIndex:10,fontSize:9,color:"rgba(217,119,6,0.85)",fontFamily:"monospace"}}>
        🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
      </div>

      {/* Cluster popup */}
      {activeZone&&byZone.has(activeZone)&&(
        <ClusterPopup zone={activeZone} sps={byZone.get(activeZone)!}
          pinned={pinnedZone===activeZone}
          onClose={()=>{setPinnedZone(null);setHoverZone(null);}}
          isDark={isDark}/>
      )}

      {/* GeoShare — position below header badges area
          top: 12 → dưới badge "16 nodes online" và timestamp ~50px
          FIX: không đè lên badge nữa */}
      {providers.length>0&&(
        <div style={{position:"absolute",top:12,left:12,zIndex:25}}>
          <GeoShare byZone={byZone} isDark={isDark}/>
        </div>
      )}
    </div>
  );
}