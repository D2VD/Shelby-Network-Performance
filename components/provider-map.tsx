"use client";
// components/provider-map.tsx — v10.0
// Changes vs v9:
// - Hover cluster → hiện TOÀN BỘ SP của cụm (không cần click)
// - Click cluster → pin popup (để đọc kỹ)
// - GeoShare panel lớn hơn (width 280)
// - Pure SVG giữ nguyên (CF Pages safe)
// - Theme sync với ThemeContext

import { useState, useRef, useCallback } from "react";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";
import { useTheme } from "./theme-context";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

const W = 1000, H = 520;
function proj(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360 * W;
  const y = H / 2 - (Math.log(Math.tan(Math.PI/4 + lat*Math.PI/180/2)) * W) / (2*Math.PI);
  return [x, y];
}

const ZONES: Record<string,{lng:number;lat:number;label:string;short:string;flag:string}> = {
  dc_us_west:   { lng:-121.89,lat:37.34,  label:"US West (San Jose)", short:"US-W",flag:"🇺🇸" },
  dc_us_east:   { lng:-77.44, lat:39.04,  label:"US East (Virginia)", short:"US-E",flag:"🇺🇸" },
  dc_europe:    { lng:8.68,   lat:50.11,  label:"Europe (Frankfurt)", short:"EU",  flag:"🇩🇪" },
  dc_asia:      { lng:103.82, lat:1.35,   label:"Asia (Singapore)",   short:"SG",  flag:"🇸🇬" },
  dc_australia: { lng:151.21, lat:-33.87, label:"Australia (Sydney)", short:"AU",  flag:"🇦🇺" },
};

function useMapTheme(isDark: boolean) {
  return isDark ? {
    bg:"#0d1526",land:"#132038",border:"#1e3a5f",ocean:"#0d1526",
    node:"#e2e8f0",nodeSub:"#38bdf8",nodeText:"#0d1526",island:"#38bdf8",
    dim:"rgba(255,255,255,0.2)",arc:"rgba(56,189,248,0.12)",arcC:"#38bdf8",
    pb:"rgba(13,21,38,0.97)",pBdr:"rgba(56,189,248,0.25)",pt:"#e2e8f0",pm:"#94a3b8",
  } : {
    bg:"#f0f4f8",land:"#dde6f0",border:"#c5d5e8",ocean:"#c8dbf0",
    node:"#2563eb",nodeSub:"#64748b",nodeText:"#fff",island:"#0369a1",
    dim:"rgba(0,0,0,0.2)",arc:"rgba(37,99,235,0.08)",arcC:"#2563eb",
    pb:"rgba(255,255,255,0.98)",pBdr:"#e2e8f0",pt:"#111827",pm:"#6b7280",
  };
}

const LAND = [
  "M82,75 L135,52 L172,44 L225,50 L265,58 L300,70 L328,92 L342,115 L336,138 L315,162 L288,185 L268,202 L240,218 L212,228 L192,242 L168,238 L148,218 L125,198 L108,178 L93,155 L86,128 Z",
  "M198,248 L222,242 L238,262 L233,288 L218,298 L203,282 Z",
  "M232,292 L262,282 L292,292 L318,312 L338,352 L342,392 L328,435 L302,460 L272,455 L252,430 L232,395 L215,352 L212,308 Z",
  "M318,26 L352,20 L382,28 L387,48 L362,60 L332,56 Z",
  "M447,106 L460,98 L470,110 L458,124 L445,116 Z",
  "M460,92 L508,72 L552,66 L592,73 L620,86 L612,108 L586,118 L555,128 L522,138 L496,146 L470,143 L456,128 L453,110 Z",
  "M478,52 L508,38 L532,46 L542,68 L522,80 L496,76 L478,63 Z",
  "M445,130 L470,128 L480,145 L472,162 L452,165 L440,150 Z",
  "M448,172 L488,163 L532,166 L565,178 L580,202 L576,242 L562,282 L545,328 L522,365 L496,385 L470,365 L450,328 L432,282 L425,242 L428,208 Z",
  "M577,143 L622,136 L655,143 L665,165 L645,182 L612,186 L586,176 Z",
  "M540,40 L618,26 L718,23 L802,30 L852,43 L868,63 L838,78 L792,86 L738,90 L680,86 L625,80 L576,76 L546,63 Z",
  "M596,88 L665,80 L725,83 L745,103 L725,123 L685,130 L645,126 L609,116 Z",
  "M645,158 L685,153 L705,166 L708,193 L695,228 L675,250 L652,246 L635,223 L629,193 L635,168 Z",
  "M715,193 L752,186 L779,196 L793,216 L779,235 L755,242 L732,235 L715,215 Z",
  "M690,86 L752,76 L809,83 L837,103 L835,130 L808,150 L775,160 L742,156 L712,146 L692,126 L690,106 Z",
  "M843,116 L856,110 L866,120 L860,133 L846,130 Z",
  "M790,332 L842,312 L889,320 L917,342 L925,375 L912,408 L879,425 L842,422 L809,409 L788,382 L779,355 Z",
  "M752,262 L790,255 L820,262 L832,278 L815,290 L782,285 L755,275 Z",
];

function arcD(x1:number,y1:number,x2:number,y2:number){
  const mx=(x1+x2)/2,my=Math.min(y1,y2)-Math.abs(x2-x1)*0.2-15;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

const ZONE_COLORS=["#3b82f6","#22c55e","#a855f7","#f59e0b","#ef4444"];
const [HS_X,HS_Y]=proj(112.3,16.5);
const [TS_X,TS_Y]=proj(114.1,10.4);

// ── Cluster hover popup — hiện TẤT CẢ SP trong zone ─────────────────────────
function ClusterHoverPopup({ zone, sps, t, x, y, pinned, onPin, onClose }: {
  zone:string; sps:StorageProvider[];
  t:ReturnType<typeof useMapTheme>;
  x:number; y:number;
  pinned:boolean; onPin:()=>void; onClose:()=>void;
}) {
  const [cp,setCp]=useState<string|null>(null);
  const meta=ZONES[zone];
  const copy=async(bls:string,addr:string)=>{await navigator.clipboard.writeText(bls).catch(()=>{});setCp(addr);setTimeout(()=>setCp(null),1500);};

  // Popup position: avoid overflow
  const tipW=340, tipH=Math.min(500,80+sps.length*88);
  const tipX=Math.min(x+18,W-tipW-10);
  const tipY=Math.max(8,Math.min(y-20,H-tipH-8));

  return (
    <div style={{
      position:"absolute", left:tipX, top:tipY, zIndex:90,
      background:t.pb, border:`1px solid ${t.pBdr}`, borderRadius:14,
      padding:"15px 17px", width:tipW, maxHeight:480,
      boxShadow:"0 20px 50px rgba(0,0,0,0.4)",
      display:"flex", flexDirection:"column",
      backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)",
      pointerEvents: pinned ? "auto" : "none",
    }}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:t.pt}}>{meta?.flag} {meta?.label??zone}</div>
          <div style={{fontSize:11,color:t.pm,marginTop:2}}>
            {sps.filter(p=>p.health==="Healthy").length}/{sps.length} healthy
            {!pinned && <span style={{marginLeft:8,opacity:.6}}>· Click to pin</span>}
          </div>
        </div>
        {pinned && (
          <button onClick={onClose} style={{background:"none",border:"none",color:t.pm,cursor:"pointer",fontSize:20,lineHeight:1,pointerEvents:"auto"}}>×</button>
        )}
      </div>
      {/* SP list */}
      <div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:8}}>
        {sps.map((p,i)=>{
          const isH=p.health==="Healthy", bls=p.fullBlsKey||p.blsKey||"";
          return (
            <div key={p.address||i} style={{background:isH?"rgba(34,197,94,0.07)":"rgba(239,68,68,0.07)",border:`1px solid ${isH?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"}`,borderRadius:9,padding:"10px 12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <span style={{fontSize:13,fontWeight:700,color:t.pt,fontFamily:"monospace"}}>{p.addressShort}</span>
                <div style={{display:"flex",gap:4}}>
                  <span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:4,background:isH?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)",color:isH?"#22c55e":"#ef4444"}}>{p.health}</span>
                  <span style={{fontSize:10,fontWeight:700,padding:"1px 7px",borderRadius:4,background:"rgba(245,158,11,0.12)",color:"#f59e0b"}}>{p.state}</span>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 8px",marginBottom:bls?5:0}}>
                {p.capacityTiB!=null&&<div><div style={{fontSize:9,color:t.pm,textTransform:"uppercase"}}>Capacity</div><div style={{fontSize:11,color:t.pt,fontWeight:500}}>{p.capacityTiB.toFixed(1)} TiB</div></div>}
                {p.geo?.city&&<div><div style={{fontSize:9,color:t.pm,textTransform:"uppercase"}}>City</div><div style={{fontSize:11,color:t.pt,fontWeight:500}}>{p.geo.city}, {p.geo.countryCode}</div></div>}
                {p.netAddress&&<div><div style={{fontSize:9,color:t.pm,textTransform:"uppercase"}}>Net IP</div><div style={{fontSize:10,color:t.pt,fontFamily:"monospace"}}>{p.netAddress}</div></div>}
              </div>
              {bls&&(
                <div style={{display:"flex",alignItems:"center",gap:4,background:"rgba(128,128,128,0.07)",borderRadius:4,padding:"3px 6px"}}>
                  <span style={{fontSize:9,color:t.pm,flexShrink:0}}>BLS</span>
                  <span style={{fontSize:9,fontFamily:"monospace",color:t.pt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{bls.slice(0,30)}…</span>
                  {pinned && <button onClick={()=>copy(bls,p.address)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:cp===p.address?"#22c55e":t.pm,pointerEvents:"auto"}}>{cp===p.address?"✓":"⧉"}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── GeoShare — lớn hơn ───────────────────────────────────────────────────────
function GeoShare({ byZone,t }:{ byZone:Map<string,StorageProvider[]>; t:ReturnType<typeof useMapTheme> }) {
  const total=Array.from(byZone.values()).reduce((s,a)=>s+a.length,0);
  const entries=Array.from(byZone.entries()).map(([z,sps],i)=>({
    zone:z, label:ZONES[z]?.label??z, flag:ZONES[z]?.flag??"🌐",
    count:sps.length, healthy:sps.filter(p=>p.health==="Healthy").length,
    pct:total>0?sps.length/total*100:0, color:ZONE_COLORS[i%ZONE_COLORS.length],
  })).sort((a,b)=>b.count-a.count);
  const R=42,cx=54,cy=54,stroke=16,circ=2*Math.PI*R;
  let off=0;
  const allH=Array.from(byZone.values()).flat().filter(p=>p.health==="Healthy").length;
  return (
    <div style={{ background:t.pb,border:`1px solid ${t.pBdr}`,borderRadius:14,padding:"14px 16px",width:280, backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)" }}>
      <div style={{fontSize:11,fontWeight:700,color:t.pt,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:1}}>Geographic & Provider Share</div>
      <div style={{fontSize:10,color:t.pm,marginBottom:12}}>Compare zone distribution</div>
      <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:12}}>
        <svg width={108} height={108} viewBox="0 0 108 108" style={{flexShrink:0}}>
          {entries.map(e=>{
            const pct=e.pct/100,dash=pct*circ,gap=circ-dash;
            const seg=<circle key={e.zone} cx={cx} cy={cy} r={R} fill="none" stroke={e.color} strokeWidth={stroke} strokeDasharray={`${dash} ${gap}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} opacity={0.88}/>;
            off+=dash; return seg;
          })}
          <text x={cx} y={cy-4} textAnchor="middle" fontSize={15} fontWeight={800} fill={t.pt}>{total}</text>
          <text x={cx} y={cy+10} textAnchor="middle" fontSize={9} fill={t.pm}>SPs</text>
        </svg>
        <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>
          {entries.map(e=>(
            <div key={e.zone} style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:2,background:e.color,flexShrink:0}}/>
              <span style={{fontSize:11,color:t.pt,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.flag} {e.label.split("(")[0].trim()}</span>
              <span style={{fontSize:10,fontWeight:700,color:t.pt,fontFamily:"monospace",flexShrink:0}}>{e.count} <span style={{color:t.pm,fontWeight:400}}>· {e.pct.toFixed(0)}%</span></span>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:"flex",paddingTop:9,borderTop:`1px solid ${t.pBdr}`}}>
        {[{label:"ZONES",value:String(entries.length)},{label:"TOTAL",value:String(total)},{label:"HEALTHY",value:String(allH)}].map(({label,value},i)=>(
          <div key={label} style={{flex:1,textAlign:"center",borderRight:i<2?`1px solid ${t.pBdr}`:"none"}}>
            <div style={{fontSize:17,fontWeight:800,color:t.pt,fontFamily:"monospace"}}>{value}</div>
            <div style={{fontSize:9,color:t.pm,letterSpacing:"0.06em"}}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function ProviderMap({ providers }: ProviderMapProps) {
  const { isDark } = useTheme();
  const t = useMapTheme(isDark);
  // hoverZone: khi hover qua cluster → show popup (không cần click)
  const [hoverZone,  setHoverZone]  = useState<string|null>(null);
  const [pinnedZone, setPinnedZone] = useState<string|null>(null);
  const [hoverPos,   setHoverPos]   = useState<{x:number;y:number}>({x:0,y:0});
  const [vb, setVb] = useState({x:0,y:0,w:W,h:H});
  const svgRef  = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{sx:number;sy:number;vbx:number;vby:number}|null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const byZone=new Map<string,StorageProvider[]>();
  providers.forEach(p=>{const z=p.availabilityZone??"unknown";if(!byZone.has(z))byZone.set(z,[]);byZone.get(z)!.push(p);});
  const azones=Array.from(byZone.keys()).filter(z=>ZONES[z]);
  const zXY=Object.fromEntries(Object.entries(ZONES).map(([k,v])=>[k,proj(v.lng,v.lat)]));

  // Convert SVG coords → screen pixels for popup positioning
  const svgToScreen=(svgX:number,svgY:number):[number,number]=>{
    const r=svgRef.current?.getBoundingClientRect();
    if(!r) return [svgX,svgY];
    const sx=(svgX-vb.x)/vb.w*r.width;
    const sy=(svgY-vb.y)/vb.h*r.height;
    return [sx,sy];
  };

  const onWheel=(e:React.WheelEvent<SVGSVGElement>)=>{
    e.preventDefault();
    const zf=e.deltaY>0?1.15:0.87;
    const r=svgRef.current?.getBoundingClientRect();if(!r)return;
    const mx=vb.x+(e.clientX-r.left)/r.width*vb.w;
    const my=vb.y+(e.clientY-r.top)/r.height*vb.h;
    setVb(p=>{
      const nw=Math.max(150,Math.min(W,p.w*zf)),nh=Math.max(80,Math.min(H,p.h*zf));
      return{x:Math.max(0,Math.min(W-nw,mx-(mx-p.x)*(nw/p.w))),y:Math.max(0,Math.min(H-nh,my-(my-p.y)*(nh/p.h))),w:nw,h:nh};
    });
  };
  const onMD=(e:React.MouseEvent<SVGSVGElement>)=>{
    if((e.target as SVGElement).closest("g[data-zone]"))return;
    dragRef.current={sx:e.clientX,sy:e.clientY,vbx:vb.x,vby:vb.y};e.preventDefault();
  };
  const onMM=(e:React.MouseEvent<SVGSVGElement>)=>{
    if(!dragRef.current)return;
    const r=svgRef.current?.getBoundingClientRect();if(!r)return;
    const dx=(e.clientX-dragRef.current.sx)/r.width*vb.w;
    const dy=(e.clientY-dragRef.current.sy)/r.height*vb.h;
    setVb(p=>({...p,x:Math.max(0,Math.min(W-p.w,dragRef.current!.vbx-dx)),y:Math.max(0,Math.min(H-p.h,dragRef.current!.vby-dy))}));
  };
  const onMU=()=>{dragRef.current=null;};

  const handleZoneEnter=(zone:string,svgX:number,svgY:number)=>{
    if(leaveTimer.current){clearTimeout(leaveTimer.current);leaveTimer.current=null;}
    const[sx,sy]=svgToScreen(svgX,svgY);
    setHoverPos({x:sx,y:sy});
    setHoverZone(zone);
  };
  const handleZoneLeave=()=>{
    leaveTimer.current=setTimeout(()=>{
      if(!pinnedZone) setHoverZone(null);
    },200);
  };

  const activeZone=pinnedZone??hoverZone;

  return (
    <div style={{position:"relative",width:"100%",height:"100%",background:t.bg,overflow:"hidden",userSelect:"none"}}>
      <style>{`
        @keyframes sp-ping{0%{opacity:.7}70%{opacity:0;transform:scale(2.2)}100%{opacity:0}}
        .sp-ping{animation:sp-ping 2.5s cubic-bezier(0,0,.2,1) infinite;transform-box:fill-box;transform-origin:center}
        @keyframes arc-flow{to{stroke-dashoffset:-40}}
      `}</style>

      {/* Reset zoom */}
      <div style={{position:"absolute",top:10,right:12,zIndex:30}}>
        <button onClick={()=>setVb({x:0,y:0,w:W,h:H})} style={{padding:"4px 10px",borderRadius:14,fontSize:10,cursor:"pointer",background:"rgba(128,128,128,0.2)",border:"none",color:t.pm}}>⊕ Reset</button>
      </div>

      <div style={{position:"absolute",bottom:10,left:providers.length>0?294:12,zIndex:30,fontSize:9,color:t.dim,fontFamily:"monospace",display:"flex",alignItems:"center",gap:5}}>
        <span style={{width:5,height:5,borderRadius:"50%",background:"#22c55e",display:"inline-block"}}/>
        {providers.filter(p=>p.health==="Healthy").length}/{providers.length} · Scroll=zoom · Drag=pan · Hover=inspect · Click=pin
      </div>
      <div style={{position:"absolute",bottom:10,right:12,zIndex:30,fontSize:9,color:"rgba(217,119,6,0.85)",fontFamily:"monospace"}}>🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam</div>

      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        style={{width:"100%",height:"100%",display:"block",cursor:dragRef.current?"grabbing":"grab"}}
        onWheel={onWheel} onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
        onClick={()=>{if(!dragRef.current){setPinnedZone(null);setHoverZone(null);}}}
      >
        <rect width={W} height={H} fill={t.ocean}/>
        <g fill={t.land} stroke={t.border} strokeWidth={0.5}>
          {LAND.map((d,i)=><path key={i} d={d}/>)}
        </g>
        {(()=>{const[,y]=proj(0,0);return<line x1={0} y1={y} x2={W} y2={y} stroke={t.dim} strokeWidth={0.5} strokeDasharray="4 5"/>;})()}
        <circle cx={HS_X} cy={HS_Y} r={4} fill="none" stroke={t.island} strokeWidth={0.7} opacity={0.9}/>
        <circle cx={TS_X} cy={TS_Y} r={4} fill="none" stroke={t.island} strokeWidth={0.7} opacity={0.9}/>
        {azones.flatMap((z1,i)=>azones.slice(i+1).map(z2=>{
          const[x1,y1]=zXY[z1]??[0,0],[x2,y2]=zXY[z2]??[0,0];
          return(<g key={`${z1}-${z2}`}>
            <path d={arcD(x1,y1,x2,y2)} fill="none" stroke={t.arc} strokeWidth={0.8}/>
            <path d={arcD(x1,y1,x2,y2)} fill="none" stroke={t.arcC} strokeWidth={1} opacity={.4} strokeDasharray="8 22" style={{animation:"arc-flow 3s linear infinite"}}/>
          </g>);
        }))}
        {azones.map(zone=>{
          const xy=zXY[zone];if(!xy)return null;
          const[x,y]=xy,sps=byZone.get(zone)??[];
          const healthy=sps.filter(p=>p.health==="Healthy").length,allOk=healthy===sps.length&&sps.length>0;
          const isMain=allOk&&sps.length>=5;
          const mColor=isMain?t.node:t.nodeSub;
          const rw=Math.max(24,20+sps.length*1.5),rh=20;
          const isActive=activeZone===zone;
          return(
            <g key={zone} data-zone={zone} style={{cursor:"pointer"}}
              onMouseEnter={e=>{e.stopPropagation();handleZoneEnter(zone,x,y);}}
              onMouseLeave={e=>{e.stopPropagation();handleZoneLeave();}}
              onClick={e=>{e.stopPropagation();setPinnedZone(z=>z===zone?null:zone);setHoverZone(zone);}}
            >
              {isMain&&<rect x={x-rw/2-6} y={y-rh/2-6} width={rw+12} height={rh+12} rx={10} fill={mColor} fillOpacity={0.15} className="sp-ping"/>}
              <rect x={x-rw/2} y={y-rh/2} width={rw} height={rh} rx={6}
                fill={isActive?mColor:mColor}
                stroke={isActive?"#22c55e":(allOk?"rgba(34,197,94,0.4)":"#ef4444")}
                strokeWidth={isActive?2:1}
                style={{filter:"drop-shadow(0 3px 6px rgba(0,0,0,0.3))"}}
              />
              <text textAnchor="middle" x={x} y={y+5} style={{fontSize:sps.length>=10?"10px":"12px",fontWeight:800,fill:t.nodeText,fontFamily:"monospace",pointerEvents:"none"}}>{sps.length}</text>
              <text textAnchor="middle" x={x} y={y+rh/2+11} style={{fontSize:"7px",fill:t.dim,fontFamily:"monospace",pointerEvents:"none"}}>{ZONE_META[zone]?.shortLabel??zone.replace("dc_","").toUpperCase()}</text>
              {!allOk&&<circle cx={x+rw/2-2} cy={y-rh/2+2} r={4} fill="#ef4444" stroke={t.bg} strokeWidth={0.8}/>}
            </g>
          );
        })}
      </svg>

      {/* Cluster hover/pin popup — absolute positioned */}
      {activeZone && byZone.has(activeZone) && (
        <ClusterHoverPopup
          zone={activeZone}
          sps={byZone.get(activeZone)!}
          t={t}
          x={hoverPos.x} y={hoverPos.y}
          pinned={pinnedZone===activeZone}
          onPin={()=>setPinnedZone(activeZone)}
          onClose={()=>{setPinnedZone(null);setHoverZone(null);}}
        />
      )}

      {/* GeoShare panel */}
      {providers.length>0 && (
        <div style={{position:"absolute",top:10,left:12,zIndex:25}}>
          <GeoShare byZone={byZone} t={t}/>
        </div>
      )}
    </div>
  );
}