"use client";
/**
 * app/dashboard/charts/page.tsx — v10.0
 * Changes:
 * 1. Time range (1h/24h/7d/30d) chuyển vào đầu phần Blob Analytics
 * 2. Mỗi Section có nút Collapse/Expand
 * 3. "Block Overview" → "Network Snapshot" + hiện delta 24h (tăng/giảm)
 * 4. Crosshair fix: hover dot bám sát con trỏ (dùng clientX/rect tính chính xác)
 * 5. Run history: phân trang 10 kết quả/trang, font lớn hơn
 * 6. Full numbers toLocaleString, light theme CSS vars
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { TestnetBanner } from "@/components/testnet-banner";

interface LivePoint { ts:number; blockHeight:number; activeBlobs:number|null; totalStorageBytes:number|null; totalBlobEvents:number|null; pendingOrFailed:number|null; deletedBlobs:number|null; }
interface TsPoint { tsMs:number; activeBlobs:number; totalStorageGB:number; totalBlobEvents:number; pendingOrFailed:number; deletedBlobs:number; blockHeight?:number; }
interface BenchEntry { id:number; score:number; avgUploadKbs:number; avgDownloadKbs:number; latency:{avg:number}; tx:{submitTime:number;confirmTime:number}; mode:string; runAt:string; }
type TimeRange = "1h"|"24h"|"7d"|"30d";

const MAX_LOCAL=120, POLL_MS=30_000, LOCAL_KEY="shelby_bench_history_v3";
const PAGE_SIZE=10;

function fmtFull(v:number|null|undefined):string { if(v==null)return"—"; return Math.round(v).toLocaleString("en-US"); }
function fmtGB(b:number|null|undefined):string { if(b==null)return"—"; return`${b.toFixed(2)} GB`; }
function fmtMs(ms:number):string { return ms>=1000?`${(ms/1000).toFixed(2)}s`:`${ms.toFixed(0)}ms`; }
function fmtKbs(k:number):string { return k>=1024?`${(k/1024).toFixed(2)} MB/s`:`${k.toFixed(1)} KB/s`; }
function tLabel(ts:number,range:TimeRange):string {
  const d=new Date(ts);
  if(range==="1h"||range==="24h") return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return`${d.getMonth()+1}/${d.getDate()}`;
}
function deltaSign(v:number):{color:string;prefix:string}{ return v>0?{color:"#22c55e",prefix:"+"}:v<0?{color:"#ef4444",prefix:""}:{color:"var(--text-muted)",prefix:"±"}; }

// ── Crosshair Chart — fixed: hover dot bám sát con trỏ ──────────────────────
interface ChartSeries { data:number[]; color:string; name:string; fmtVal?:(v:number)=>string; }

function CrosshairChart({
  series, labels, height=160, range, perSeriesScale=false,
}:{
  series:ChartSeries[]; labels:string[]; height?:number; range:TimeRange; perSeriesScale?:boolean;
}) {
  const { isDark } = useTheme();
  const [hover,  setHover]  = useState<{idx:number;svgX:number;svgY:number}|null>(null);
  const [pinned, setPinned] = useState<{idx:number;svgX:number;svgY:number}|null>(null);
  const [inside, setInside] = useState(false);
  const svgRef=useRef<SVGSVGElement>(null);

  // SVG coordinate system constants
  const W=600, pad={t:16,b:24,l:60,r:12};
  const iW=W-pad.l-pad.r, iH=height-pad.t-pad.b;
  const n=Math.max(...series.map(s=>s.data.length),1);
  const allData=series.flatMap(s=>s.data);

  if(allData.filter(v=>v>0).length<2) return(
    <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-dim)",fontSize:12,flexDirection:"column",gap:6}}>
      <div style={{width:20,height:20,border:"2px solid var(--border)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"chart-spin 1s linear infinite"}}/>
      Collecting data…
    </div>
  );

  // Per-series or global domain
  const seriesDomains=series.map(s=>{
    const vals=s.data.filter(v=>v>0);
    if(!vals.length) return{min:0,max:1};
    const mn=Math.min(...vals),mx=Math.max(...vals);
    const p=(mx-mn)*0.08||mn*0.05||1;
    return{min:Math.max(0,mn-p),max:mx+p};
  });
  const globalMin=perSeriesScale?0:Math.min(...allData.filter(v=>v>0))*0.97;
  const globalMax=perSeriesScale?0:Math.max(...allData)*1.03;

  const xs=(i:number)=>pad.l+(i/Math.max(n-1,1))*iW;
  const ys=(v:number,si=0)=>{
    if(perSeriesScale){const{min,max}=seriesDomains[si];return pad.t+iH-((v-min)/(max-min||1))*iH;}
    return pad.t+iH-((v-globalMin)/(globalMax-globalMin||1))*iH;
  };
  const fmtY=(v:number)=>{
    if(v>=1e9) return`${(v/1e9).toFixed(1)}G`;
    if(v>=1e6) return`${(v/1e6).toFixed(1)}M`;
    if(v>=1e3) return`${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };

  // KEY FIX: map clientX → SVG pixel space correctly
  // relX = pixel position trong SVG element width (0..svgEl.clientWidth)
  // Then scale to SVG viewBox width (0..W)
  const onMouseMove=(e:React.MouseEvent<SVGSVGElement>)=>{
    if(!inside) return;
    const rect=svgRef.current?.getBoundingClientRect();
    if(!rect) return;
    // Scale client position to SVG viewBox coordinates
    const svgX=((e.clientX-rect.left)/rect.width)*W;
    if(svgX<pad.l||svgX>W-pad.r){setHover(null);return;}
    // Find nearest data index
    const rawIdx=(svgX-pad.l)/iW*(n-1);
    const idx=Math.max(0,Math.min(n-1,Math.round(rawIdx)));
    // Compute actual svgX at that index (snap to data point)
    const snappedSvgX=xs(idx);
    const svgY=ys(series[0]?.data[idx]??0,0);
    setHover({idx,svgX:snappedSvgX,svgY});
  };
  const onClick=()=>{
    if(hover) setPinned(p=>p?.idx===hover.idx?null:hover);
  };
  const active=pinned??hover;
  const gridColor=isDark?"#1e3a5f":"#e5e7eb";
  const tickColor="var(--text-dim)";

  // Y-axis ticks
  const yTicks=[0,0.25,0.5,0.75,1].map(f=>{
    const v=perSeriesScale
      ?seriesDomains[0].min+f*(seriesDomains[0].max-seriesDomains[0].min)
      :globalMin+f*(globalMax-globalMin);
    return{f,v};
  });

  // Tooltip X position in % of SVG width
  const tipLeftPct=active?(active.svgX/W*100):50;
  const tipOnRight=tipLeftPct<55;

  return(
    <div style={{position:"relative"}}
      onMouseEnter={()=>setInside(true)}
      onMouseLeave={()=>{setInside(false);setHover(null);}}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`}
        style={{width:"100%",height,display:"block",cursor:"crosshair"}}
        onMouseMove={onMouseMove}
        onMouseLeave={()=>setHover(null)}
        onClick={onClick}
      >
        <style>{`@keyframes chart-spin{to{transform:rotate(360deg)}}`}</style>
        {yTicks.map(({f,v})=>{const y=pad.t+iH-f*iH;return(
          <g key={f}>
            <line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={gridColor} strokeWidth={1}/>
            <text x={pad.l-5} y={y+3} textAnchor="end" fontSize={9} fill={tickColor}>{fmtY(v)}</text>
          </g>
        );})}
        <defs>
          {series.map((s,si)=>(
            <linearGradient key={si} id={`cg${si}_${s.color.replace("#","")}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={isDark?0.35:0.2}/>
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02}/>
            </linearGradient>
          ))}
        </defs>
        {series.map((s,si)=>{
          if(s.data.length<2) return null;
          const pts=s.data.map((v,i)=>`${xs(i).toFixed(1)},${ys(v,si).toFixed(1)}`).join(" ");
          const area=`${pad.l},${pad.t+iH} ${pts} ${xs(s.data.length-1).toFixed(1)},${pad.t+iH}`;
          return(<g key={si}>
            <polygon points={area} fill={`url(#cg${si}_${s.color.replace("#","")})`}/>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round"/>
          </g>);
        })}
        {/* Crosshair — bám chính xác vào data point */}
        {active&&inside&&(
          <g>
            <line x1={active.svgX} y1={pad.t} x2={active.svgX} y2={pad.t+iH}
              stroke={isDark?"#64748b":"#94a3b8"} strokeWidth={1} strokeDasharray="3 3"/>
            {series.map((s,si)=>{
              const v=s.data[active.idx];
              if(v==null) return null;
              return<circle key={si} cx={xs(active.idx)} cy={ys(v,si)} r={4.5}
                fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/>;
            })}
          </g>
        )}
        {labels.length>0&&[0,Math.floor(labels.length/2),labels.length-1].map(i=>(
          labels[i]?<text key={i} x={xs(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tickColor}>{labels[i]}</text>:null
        ))}
      </svg>
      {/* Tooltip */}
      {active&&inside&&(
        <div style={{
          position:"absolute",
          left:tipOnRight?`${tipLeftPct+2}%`:"auto",
          right:tipOnRight?"auto":`${100-tipLeftPct+2}%`,
          top:8, background:"var(--bg-card)",
          border:"1px solid var(--border)",
          borderRadius:9,padding:"9px 13px",fontSize:12,
          pointerEvents:"none",zIndex:50,minWidth:140,
          boxShadow:"0 4px 14px var(--shadow-color)",
          whiteSpace:"nowrap",
        }}>
          {pinned&&<div style={{fontSize:9,color:"var(--accent)",marginBottom:3,fontWeight:600}}>📌 Pinned</div>}
          {labels[active.idx]&&<div style={{color:"var(--text-dim)",fontSize:10,marginBottom:5}}>{labels[active.idx]}</div>}
          {series.map((s,si)=>{
            const v=s.data[active.idx];
            if(v==null) return null;
            const fv=s.fmtVal?s.fmtVal(v):fmtFull(v);
            return(<div key={si} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:2}}>
              <span style={{color:"var(--text-muted)"}}>{s.name}</span>
              <span style={{fontWeight:700,fontFamily:"monospace",color:s.color}}>{fv}</span>
            </div>);
          })}
        </div>
      )}
    </div>
  );
}

// ── Collapsible Section ───────────────────────────────────────────────────────
function Section({ title, sub, children, defaultOpen=true, rightSlot }: {
  title:string; sub?:string; children:React.ReactNode; defaultOpen?:boolean; rightSlot?:React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return(
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:open?18:0,cursor:"pointer"}} onClick={()=>setOpen(v=>!v)}>
        <div>
          <h2 style={{fontSize:20,fontWeight:800,color:"var(--text-primary)",margin:0}}>{title}</h2>
          {sub&&!open&&<p style={{fontSize:13,color:"var(--text-muted)",margin:"3px 0 0"}}>{sub}</p>}
          {sub&&open&&<p style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 0"}}>{sub}</p>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {rightSlot&&<div onClick={e=>e.stopPropagation()}>{rightSlot}</div>}
          <button style={{
            display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:7,
            border:"1px solid var(--border)",background:"var(--bg-card)",
            color:"var(--text-muted)",fontSize:12,fontWeight:500,cursor:"pointer",
          }} onClick={e=>{e.stopPropagation();setOpen(v=>!v);}}>
            {open?"⊟ Collapse":"⊞ Expand"}
          </button>
        </div>
      </div>
      {open&&<div>{children}</div>}
    </div>
  );
}

function ChartCard({ children, title, sub, latest, latestColor }:{ children:React.ReactNode; title:string; sub?:string; latest?:string; latestColor?:string; }) {
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:"18px 20px",transition:"background 0.2s"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>{title}</div>
          {sub&&<div style={{fontSize:11,color:"var(--text-dim)"}}>{sub}</div>}
        </div>
        {latest&&<div style={{fontFamily:"monospace",fontSize:16,fontWeight:800,color:latestColor??"var(--text-primary)"}}>{latest}</div>}
      </div>
      {children}
    </div>
  );
}

function RangeSelector({ range, onChange }:{ range:TimeRange; onChange:(r:TimeRange)=>void }) {
  return(
    <div style={{display:"flex",gap:4,background:"var(--bg-card2)",border:"1px solid var(--border)",borderRadius:8,padding:3}}>
      {(["1h","24h","7d","30d"] as TimeRange[]).map(r=>(
        <button key={r} onClick={()=>onChange(r)} style={{
          padding:"5px 14px",borderRadius:6,fontSize:12,fontWeight:range===r?700:400,
          border:"none",cursor:"pointer",
          background:range===r?"var(--accent)":"transparent",
          color:range===r?"#fff":"var(--text-muted)",
          transition:"all 0.12s",
        }}>{r}</button>
      ))}
    </div>
  );
}

// ── Delta badge for Network Snapshot ─────────────────────────────────────────
function DeltaBadge({ value, suffix="", invert=false }:{ value:number|null; suffix?:string; invert?:boolean }) {
  if(value==null) return<span style={{color:"var(--text-dim)",fontSize:12}}>—</span>;
  if(value===0)   return<span style={{color:"var(--text-muted)",fontSize:12}}>±0{suffix}</span>;
  const positive=invert?value<0:value>0;
  return(
    <span style={{fontSize:11,fontWeight:600,color:positive?"#22c55e":"#ef4444",background:positive?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",padding:"2px 7px",borderRadius:5}}>
      {value>0?"+":""}{value.toLocaleString("en-US")}{suffix}
    </span>
  );
}

// ── Network Snapshot Card ─────────────────────────────────────────────────────
function SnapshotCard({ label, value, delta, deltaLabel, color, deltaSuffix="" }:{
  label:string; value:string; delta:number|null; deltaLabel?:string; color?:string; deltaSuffix?:string;
}) {
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 20px",display:"flex",flexDirection:"column",gap:5,transition:"background 0.2s"}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"var(--text-muted)",textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,color:color??"var(--text-primary)",fontFamily:"monospace",fontVariantNumeric:"tabular-nums",lineHeight:1.1}}>{value}</div>
      {delta!=null&&(
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <DeltaBadge value={delta} suffix={deltaSuffix}/>
          {deltaLabel&&<span style={{fontSize:10,color:"var(--text-dim)"}}>{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ total,page,perPage,onChange }:{total:number;page:number;perPage:number;onChange:(p:number)=>void}) {
  const pages=Math.ceil(total/perPage);
  if(pages<=1) return null;
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginTop:14}}>
      <button onClick={()=>onChange(page-1)} disabled={page===0} style={{padding:"5px 12px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===0?"not-allowed":"pointer",opacity:page===0?.4:1,fontSize:13}}>←</button>
      {Array.from({length:pages},(_,i)=>i).map(i=>(
        <button key={i} onClick={()=>onChange(i)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid var(--border)",background:i===page?"var(--accent)":"var(--bg-card)",color:i===page?"#fff":"var(--text-muted)",cursor:"pointer",fontWeight:i===page?700:400,fontSize:13,minWidth:34}}>
          {i+1}
        </button>
      ))}
      <button onClick={()=>onChange(page+1)} disabled={page===pages-1} style={{padding:"5px 12px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===pages-1?"not-allowed":"pointer",opacity:page===pages-1?.4:1,fontSize:13}}>→</button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const { isDark } = useTheme();
  const [range,      setRange]     = useState<TimeRange>("24h");
  const [points,     setPoints]    = useState<LivePoint[]>([]);
  const [tsData,     setTsData]    = useState<TsPoint[]>([]);
  const [polling,    setPolling]   = useState(false);
  const [lastFetch,  setLastFetch] = useState<Date|null>(null);
  const [bench,      setBench]     = useState<BenchEntry[]>([]);
  const [benchPage,  setBenchPage] = useState(0);
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);

  const fetchLive=useCallback(async()=>{
    setPolling(true);
    try{
      const res=await fetch(`/api/network/stats/live?network=${network}`);
      const json=await res.json() as any;
      const d=json.data??json;
      setPoints(prev=>[...prev,{
        ts:Date.now(),blockHeight:d.blockHeight??0,
        activeBlobs:d.activeBlobs??null,totalStorageBytes:d.totalStorageBytes??null,
        totalBlobEvents:d.totalBlobEvents??null,pendingOrFailed:d.pendingOrFailed??null,deletedBlobs:d.deletedBlobs??null,
      }].slice(-MAX_LOCAL));
      setLastFetch(new Date());
    }catch{}
    setPolling(false);
  },[network]);

  const fetchTs=useCallback(async(r:TimeRange)=>{
    try{
      const res_=r==="1h"||r==="24h"?"5m":"1h";
      const res=await fetch(`/api/network/stats/timeseries?network=${network}&resolution=${res_}&range=${r}`);
      if(!res.ok)return;
      const j=await res.json() as any;
      setTsData((j.data?.series??[]).map((s:any)=>({
        tsMs:s.tsMs,activeBlobs:s.activeBlobs??0,totalStorageGB:s.totalStorageGB??0,
        totalBlobEvents:s.totalBlobEvents??0,pendingOrFailed:s.pendingOrFailed??0,
        deletedBlobs:s.deletedBlobs??0,blockHeight:s.blockHeight??0,
      })));
    }catch{}
  },[network]);

  useEffect(()=>{
    setPoints([]);fetchLive();
    timerRef.current=setInterval(fetchLive,POLL_MS);
    return()=>{if(timerRef.current)clearInterval(timerRef.current);};
  },[fetchLive]);
  useEffect(()=>{fetchTs(range);},[range,fetchTs]);
  useEffect(()=>{
    try{const s=localStorage.getItem(LOCAL_KEY);if(s)setBench(JSON.parse(s));}catch{}
  },[]);

  const cd=tsData.length>0?tsData:points.map(p=>({
    tsMs:p.ts,activeBlobs:p.activeBlobs??0,
    totalStorageGB:p.totalStorageBytes?p.totalStorageBytes/1e9:0,
    totalBlobEvents:p.totalBlobEvents??0,pendingOrFailed:p.pendingOrFailed??0,
    deletedBlobs:p.deletedBlobs??0,blockHeight:p.blockHeight,
  }));

  const labels=cd.map(p=>tLabel(p.tsMs,range));
  const latest=points[points.length-1];
  const latestTs=cd[cd.length-1];
  const firstTs=cd[0];

  // Deltas: last vs first point in current range
  const deltaActive   = latestTs&&firstTs ? latestTs.activeBlobs     - firstTs.activeBlobs    : null;
  const deltaStorage  = latestTs&&firstTs ? latestTs.totalStorageGB  - firstTs.totalStorageGB  : null;
  const deltaEvents   = latestTs&&firstTs ? latestTs.totalBlobEvents - firstTs.totalBlobEvents : null;
  const deltaPending  = latestTs&&firstTs ? latestTs.pendingOrFailed - firstTs.pendingOrFailed : null;
  const deltaDeleted  = latestTs&&firstTs ? latestTs.deletedBlobs    - firstTs.deletedBlobs    : null;

  // Bench pagination
  const pagedBench=[...bench].reverse().slice(benchPage*PAGE_SIZE,(benchPage+1)*PAGE_SIZE);

  if(network==="testnet") return<TestnetBanner/>;

  return(
    <div style={{background:"var(--bg-primary)",minHeight:"100vh",padding:"28px 36px 48px",transition:"background 0.2s"}}>
      <style>{`@keyframes chart-spin{to{transform:rotate(360deg)}}`}</style>

      {/* Page header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:14,marginBottom:32}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"var(--text-primary)",margin:0,letterSpacing:-0.5}}>Network Analytics</h1>
          <p style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 0"}}>
            {config.label} · {POLL_MS/1000}s polling · {lastFetch?lastFetch.toLocaleTimeString():"—"}
          </p>
        </div>
        <button onClick={fetchLive} disabled={polling} style={{
          padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,
          background:"var(--bg-card)",border:"1px solid var(--border)",color:"var(--text-muted)",cursor:"pointer",
        }}>
          {polling?"⟳ Syncing…":"⟳ Refresh"}
        </button>
      </div>

      {/* ── Network Snapshot (đổi tên từ Block Overview) ── */}
      <Section title="Network Snapshot" sub="Current state · delta vs range start">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(168px,1fr))",gap:12,marginBottom:0}}>
          <SnapshotCard label="Block Height"    value={latest?`#${latest.blockHeight.toLocaleString("en-US")}`:"—"} color="var(--accent)" delta={null}/>
          <SnapshotCard label="Active Blobs"   value={fmtFull(latestTs?.activeBlobs)}    color="#22c55e"  delta={deltaActive}  deltaLabel="vs start"/>
          <SnapshotCard label="Storage Used"   value={fmtGB(latestTs?.totalStorageGB)}    color="#a78bfa"  delta={deltaStorage!=null?Number(deltaStorage.toFixed(2)):null} deltaSuffix=" GB" deltaLabel="vs start"/>
          <SnapshotCard label="Blob Events"    value={fmtFull(latestTs?.totalBlobEvents)} color="#fb923c"  delta={deltaEvents}  deltaLabel="vs start"/>
          <SnapshotCard label="Pending Blobs"  value={fmtFull(latestTs?.pendingOrFailed)} color="#fbbf24"  delta={deltaPending} deltaLabel="vs start"/>
          <SnapshotCard label="Deleted Blobs"  value={fmtFull(latestTs?.deletedBlobs)}    color="#f87171"  delta={deltaDeleted} deltaLabel="vs start"/>
        </div>
      </Section>

      {/* ── Blob Analytics — Range selector ở đây ── */}
      <Section
        title="Blob Analytics"
        sub="Blob count and activity over time"
        rightSlot={<RangeSelector range={range} onChange={r=>{setRange(r);setBenchPage(0);}}/>}
      >
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <ChartCard title="Active Blobs" sub={`${range} window`}
            latest={fmtFull(latestTs?.activeBlobs)} latestColor="#22c55e">
            <CrosshairChart range={range} series={[{data:cd.map(p=>p.activeBlobs),color:"#22c55e",name:"Active",fmtVal:fmtFull}]} labels={labels} height={150}/>
          </ChartCard>
          <ChartCard title="Blob Events" sub="blob_activities_aggregate count"
            latest={fmtFull(latestTs?.totalBlobEvents)} latestColor="#fb923c">
            <CrosshairChart range={range} series={[{data:cd.map(p=>p.totalBlobEvents),color:"#fb923c",name:"Events",fmtVal:fmtFull}]} labels={labels} height={150}/>
          </ChartCard>
        </div>
        <ChartCard title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series">
          <CrosshairChart range={range} height={130} labels={labels} perSeriesScale={true} series={[
            {data:cd.map(p=>p.pendingOrFailed),color:"#fbbf24",name:"Pending",fmtVal:fmtFull},
            {data:cd.map(p=>p.deletedBlobs),   color:"#f87171",name:"Deleted",fmtVal:fmtFull},
          ]}/>
        </ChartCard>
      </Section>

      {/* ── Storage Analytics ── */}
      <Section title="Storage Analytics" sub="Storage capacity and utilization">
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>
          <ChartCard title="Storage Used (GB)" sub="Active blobs sum.size from Shelby Indexer"
            latest={latestTs?`${latestTs.totalStorageGB.toFixed(2)} GB`:"—"} latestColor="#a78bfa">
            <CrosshairChart range={range} height={160} labels={labels} series={[
              {data:cd.map(p=>p.totalStorageGB),color:"#a78bfa",name:"GB",fmtVal:v=>`${v.toFixed(2)} GB`},
            ]}/>
          </ChartCard>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              {label:"Total Storage",val:latestTs?`${latestTs.totalStorageGB.toFixed(2)} GB`:"—",c:"#a78bfa"},
              {label:"Active Blobs", val:fmtFull(latestTs?.activeBlobs),c:"#22c55e"},
              {label:"Avg Blob Size",val:latestTs&&latestTs.activeBlobs>0?`${((latestTs.totalStorageGB*1e9)/latestTs.activeBlobs/1024).toFixed(0)} KB`:"—",c:"var(--accent)"},
            ].map(({label,val,c})=>(
              <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px",flex:1}}>
                <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:5}}>{label}</div>
                <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"monospace"}}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Block Performance ── */}
      <Section title="Block Performance" sub="Block height progression on Shelbynet">
        <ChartCard title="Block Height" sub="Aptos block progression"
          latest={latest?`#${latest.blockHeight.toLocaleString("en-US")}`:"—"} latestColor="var(--accent)">
          <CrosshairChart range={range} height={140} labels={labels} series={[{
            data:cd.map(p=>p.blockHeight??0).some(v=>v>0)?cd.map(p=>p.blockHeight??0):points.map(p=>p.blockHeight).filter(Boolean),
            color:"var(--accent)",name:"Block",fmtVal:v=>`#${Math.round(v).toLocaleString("en-US")}`,
          }]}/>
        </ChartCard>
      </Section>

      {/* ── Benchmark Analytics ── */}
      {bench.length>0&&(
        <Section title="Benchmark Analytics" sub="Historical performance from your benchmark runs">
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
            {(()=>{
              const nb=bench.length;
              const avg=(fn:(h:BenchEntry)=>number)=>Math.round(bench.reduce((s,h)=>s+fn(h),0)/nb);
              return[
                {label:"Total Runs",  val:String(nb),                       c:"var(--text-muted)"},
                {label:"Avg Score",   val:`${avg(h=>h.score)}/1000`,         c:avg(h=>h.score)>=700?"#22c55e":"#fbbf24"},
                {label:"Avg Upload",  val:fmtKbs(avg(h=>h.avgUploadKbs)),   c:"var(--accent)"},
                {label:"Avg Download",val:fmtKbs(avg(h=>h.avgDownloadKbs)), c:"#34d399"},
                {label:"Avg Latency", val:fmtMs(avg(h=>h.latency?.avg??0)), c:"#c084fc"},
                {label:"Avg TX",      val:fmtMs(avg(h=>h.tx?.confirmTime??0)),c:"#fb923c"},
              ].map(({label,val,c})=>(
                <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 18px"}}>
                  <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:"monospace"}}>{val}</div>
                </div>
              ));
            })()}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            <ChartCard title="Score per Run" latest={`${bench[bench.length-1]?.score??0}/1000`} latestColor={bench[bench.length-1]?.score>=700?"#22c55e":"#fbbf24"}>
              <CrosshairChart range={range} height={130} labels={bench.map(h=>h.runAt.split(" ")[1]?.slice(0,5)??"") } series={[{data:bench.map(h=>h.score),color:"#818cf8",name:"Score",fmtVal:v=>`${Math.round(v)}/1000`}]}/>
            </ChartCard>
            <ChartCard title="Upload & Download Speed">
              <CrosshairChart range={range} height={130} labels={bench.map(h=>h.runAt.split(" ")[1]?.slice(0,5)??"") } series={[
                {data:bench.map(h=>h.avgUploadKbs),   color:"var(--accent)",name:"Upload",  fmtVal:fmtKbs},
                {data:bench.map(h=>h.avgDownloadKbs), color:"#34d399",      name:"Download",fmtVal:fmtKbs},
              ]}/>
            </ChartCard>
          </div>

          {/* Run history — phân trang */}
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
            <div style={{padding:"15px 20px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:"var(--text-primary)"}}>Run History</div>
                <div style={{fontSize:12,color:"var(--text-muted)"}}>{bench.length} runs · Page {benchPage+1}/{Math.ceil(bench.length/PAGE_SIZE)}</div>
              </div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"var(--bg-card2)"}}>
                    {["#","Mode","Score","Upload","Download","Latency","TX Submit","TX Confirm","At"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:11,fontWeight:600,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedBench.map((h,i)=>{
                    const c=h.score>=900?"#22c55e":h.score>=600?"#fbbf24":"#f87171";
                    return(
                      <tr key={h.id??i} style={{borderTop:"1px solid var(--border-soft)"}}>
                        <td style={{padding:"10px 14px",color:"var(--text-dim)",fontFamily:"monospace",fontSize:13}}>#{h.id??i}</td>
                        <td><span style={{fontSize:11,fontWeight:700,color:"#818cf8",textTransform:"uppercase"}}>{h.mode}</span></td>
                        <td><span style={{fontFamily:"monospace",fontWeight:800,color:c,fontSize:14}}>{h.score}</span></td>
                        <td style={{fontFamily:"monospace",color:"var(--accent)",fontSize:13}}>{fmtKbs(h.avgUploadKbs)}</td>
                        <td style={{fontFamily:"monospace",color:"#34d399",fontSize:13}}>{h.avgDownloadKbs>0?fmtKbs(h.avgDownloadKbs):<span style={{color:"var(--text-dim)"}}>—</span>}</td>
                        <td style={{fontFamily:"monospace",color:"#c084fc",fontSize:13}}>{fmtMs(h.latency?.avg??0)}</td>
                        <td style={{fontFamily:"monospace",color:"#fb923c",fontSize:13}}>{fmtMs(h.tx?.submitTime??0)}</td>
                        <td style={{fontFamily:"monospace",color:"#f87171",fontSize:13}}>{fmtMs(h.tx?.confirmTime??0)}</td>
                        <td style={{color:"var(--text-dim)",fontFamily:"monospace",fontSize:12}}>{h.runAt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{padding:"10px 20px",borderTop:"1px solid var(--border-soft)"}}>
              <Pagination total={bench.length} page={benchPage} perPage={PAGE_SIZE} onChange={setBenchPage}/>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}