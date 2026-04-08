"use client";
/**
 * app/dashboard/charts/page.tsx — v13.0
 * ROOT CAUSE FIX cho React error #310:
 * - Rebuild với simple useEffect pattern (không chain useCallback phức tạp)
 * - Tất cả JSX values đều qua str() / num() helper trước khi render
 * - str() luôn trả string, không bao giờ trả object/undefined/null
 * - num() luôn trả finite number hoặc 0
 */

import { useEffect, useState, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number; blockHeight: number;
}
interface LivePt {
  ts: number; blockHeight: number; activeBlobs: number;
  totalStorageGB: number; totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number;
}
interface ServerBench {
  id: string; ip: string; ts: string; score: number; tier: string;
  avgUploadKbs: number; avgDownloadKbs: number; latencyAvg: number; txConfirmMs: number; mode: string;
}
type TimeRange = "1h"|"24h"|"7d"|"30d";

const POLL   = 30_000;
const PG     = 10;

// ─── SAFE VALUE HELPERS — the key fix ────────────────────────────────────────
// str(): ALWAYS returns a string. Never returns object/undefined/null.
function str(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.trim() || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return String(v);
}
// num(): ALWAYS returns a finite number.
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}
// fmtN: format number with locale commas
function fmtN(v: unknown): string {
  const n = num(v);
  return n === 0 ? "—" : Math.round(n).toLocaleString("en-US");
}
function fmtGB(v: unknown): string {
  const n = num(v);
  return n === 0 ? "—" : `${n.toFixed(2)} GB`;
}
function fmtKbs(v: unknown): string {
  const n = num(v);
  if (n === 0) return "—";
  return n >= 1024 ? `${(n/1024).toFixed(2)} MB/s` : `${n.toFixed(1)} KB/s`;
}
function fmtMs(v: unknown): string {
  const n = num(v);
  if (n === 0) return "—";
  return n >= 1000 ? `${(n/1000).toFixed(2)}s` : `${n.toFixed(0)}ms`;
}
function tLbl(tsMs: number, range: TimeRange): string {
  try {
    const d = new Date(tsMs);
    if (range === "1h" || range === "24h")
      return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    return `${d.getMonth()+1}/${d.getDate()}`;
  } catch { return ""; }
}

// ─── CrosshairChart ───────────────────────────────────────────────────────────
interface Series { data: number[]; color: string; name: string; fmt?: (v:number)=>string; }

function Chart({ series, labels, height=150, perScale=false }: {
  series: Series[]; labels: string[]; height?: number; perScale?: boolean;
}) {
  const { isDark } = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hIdx, setHIdx] = useState<number|null>(null);
  const [pin,  setPin]  = useState<number|null>(null);
  const [in_,  setIn]   = useState(false);

  const VW=600, PL=60, PR=12, PT=16, PB=24;
  const iW=VW-PL-PR, iH=height-PT-PB;
  const n = Math.max(...series.map(s=>s.data.length), 2);

  const allV = series.flatMap(s => s.data.filter(v => isFinite(v) && v > 0));
  if (allV.length < 2) return (
    <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-dim)",fontSize:12}}>
      Collecting data…
    </div>
  );

  const doms = series.map(s => {
    const vs = s.data.filter(v=>isFinite(v)&&v>0);
    if (!vs.length) return {mn:0,mx:1};
    const mn=Math.min(...vs),mx=Math.max(...vs),p=(mx-mn)*0.08||mn*0.05||1;
    return {mn:Math.max(0,mn-p),mx:mx+p};
  });
  const gMn = perScale ? 0 : Math.min(...allV)*0.97;
  const gMx = perScale ? 0 : Math.max(...allV)*1.03;

  const xp = (i:number) => PL+(i/Math.max(n-1,1))*iW;
  const yp = (v:number,si=0) => {
    if (!isFinite(v)) return PT+iH/2;
    if (perScale) { const {mn,mx}=doms[si]; return PT+iH-((v-mn)/(mx-mn||1))*iH; }
    return PT+iH-((v-gMn)/(gMx-gMn||1))*iH;
  };
  const fY = (v:number) => {
    if (!isFinite(v)||v===0) return "";
    if (v>=1e9) return `${(v/1e9).toFixed(1)}G`;
    if (v>=1e6) return `${(v/1e6).toFixed(1)}M`;
    if (v>=1e3) return `${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };

  const toIdx = (clientX:number):number => {
    const el=svgRef.current; if(!el) return 0;
    const rect=el.getBoundingClientRect();
    const frac=(clientX-rect.left)/rect.width;
    const raw=(frac*VW-PL)/iW*(n-1);
    return Math.max(0,Math.min(n-1,Math.round(raw)));
  };

  const active = pin ?? hIdx;
  const gc = isDark?"#1e3a5f":"#e5e7eb";
  const tc = "var(--text-dim)";
  const ticks = [0,0.25,0.5,0.75,1].map(f=>{
    const v = perScale ? doms[0].mn+f*(doms[0].mx-doms[0].mn) : gMn+f*(gMx-gMn);
    return {f,v};
  });
  const tipR = active!==null ? active<n*0.55 : true;
  const tipX = active!==null ? (xp(active)/VW*100) : 50;

  return (
    <div style={{position:"relative"}} onMouseEnter={()=>setIn(true)} onMouseLeave={()=>{setIn(false);setHIdx(null);}}>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${height}`} style={{width:"100%",height,display:"block",cursor:"crosshair"}}
        onMouseMove={e=>{if(!in_)return;setHIdx(toIdx(e.clientX));}}
        onMouseLeave={()=>setHIdx(null)}
        onClick={e=>{const i=toIdx(e.clientX);setPin(p=>p===i?null:i);}}
      >
        {ticks.map(({f,v})=>{const y=PT+iH-f*iH;return(
          <g key={f}>
            <line x1={PL} x2={VW-PR} y1={y} y2={y} stroke={gc} strokeWidth={1}/>
            <text x={PL-5} y={y+3} textAnchor="end" fontSize={9} fill={tc}>{fY(v)}</text>
          </g>
        );})}
        <defs>
          {series.map((s,si)=>(
            <linearGradient key={si} id={`g${si}${s.color.replace(/[^a-z0-9]/gi,"")}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={isDark?0.35:0.2}/>
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02}/>
            </linearGradient>
          ))}
        </defs>
        {series.map((s,si)=>{
          if(s.data.length<2) return null;
          const pts=s.data.map((v,i)=>`${xp(i).toFixed(1)},${yp(v,si).toFixed(1)}`).join(" ");
          const area=`${xp(0).toFixed(1)},${PT+iH} ${pts} ${xp(s.data.length-1).toFixed(1)},${PT+iH}`;
          return(<g key={si}>
            <polygon points={area} fill={`url(#g${si}${s.color.replace(/[^a-z0-9]/gi,"")})`}/>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"/>
          </g>);
        })}
        {active!==null&&in_&&(()=>{const cx=xp(active);return(
          <g>
            <line x1={cx} y1={PT} x2={cx} y2={PT+iH} stroke={isDark?"#64748b":"#94a3b8"} strokeWidth={1} strokeDasharray="3 3"/>
            {series.map((s,si)=>{const v=s.data[active];if(v==null||!isFinite(v))return null;return(
              <circle key={si} cx={cx} cy={yp(v,si)} r={5} fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/>
            );})}
          </g>
        );})()} 
        {labels.length>0&&[0,Math.floor(labels.length/2),labels.length-1].map(i=>
          labels[i]?<text key={i} x={xp(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tc}>{str(labels[i])}</text>:null
        )}
      </svg>
      {active!==null&&in_&&(
        <div style={{position:"absolute",left:tipR?`${tipX+1}%`:"auto",right:tipR?"auto":`${100-tipX+1}%`,top:4,
          background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:9,
          padding:"9px 13px",fontSize:12,pointerEvents:"none",zIndex:50,minWidth:140,whiteSpace:"nowrap",
          boxShadow:"0 4px 14px var(--shadow-color)"}}>
          {pin!==null&&<div style={{fontSize:9,color:"var(--accent)",marginBottom:3,fontWeight:600}}>📌 Pinned</div>}
          {labels[active]&&<div style={{color:"var(--text-dim)",fontSize:10,marginBottom:4}}>{str(labels[active])}</div>}
          {series.map((s,si)=>{const v=s.data[active];if(v==null||!isFinite(v))return null;
            const fv=str(s.fmt?s.fmt(v):fmtN(v));
            return(<div key={si} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:1}}>
              <span style={{color:"var(--text-muted)"}}>{str(s.name)}</span>
              <span style={{fontWeight:700,fontFamily:"monospace",color:s.color}}>{fv}</span>
            </div>);
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
function Sec({title,sub,children,right}:{title:string;sub?:string;children:React.ReactNode;right?:React.ReactNode}) {
  return(
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <h2 style={{fontSize:19,fontWeight:800,color:"var(--text-primary)",margin:0}}>{str(title)}</h2>
          {sub&&<p style={{fontSize:13,color:"var(--text-muted)",margin:"3px 0 0"}}>{str(sub)}</p>}
        </div>
        {right&&<div>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({title,sub,latest,color,children}:{title:string;sub?:string;latest?:string;color?:string;children:React.ReactNode}) {
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:13,padding:"16px 18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>{str(title)}</div>
          {sub&&<div style={{fontSize:11,color:"var(--text-dim)"}}>{str(sub)}</div>}
        </div>
        {latest&&<div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:str(color)||"var(--text-primary)"}}>{str(latest)}</div>}
      </div>
      {children}
    </div>
  );
}

function RangeSel({range,onChange}:{range:TimeRange;onChange:(r:TimeRange)=>void}) {
  return(
    <div style={{display:"flex",gap:3,background:"var(--bg-card2)",border:"1px solid var(--border)",borderRadius:8,padding:3}}>
      {(["1h","24h","7d","30d"] as TimeRange[]).map(r=>(
        <button key={r} onClick={()=>onChange(r)} style={{padding:"5px 13px",borderRadius:6,fontSize:12,fontWeight:r===range?700:400,
          border:"none",cursor:"pointer",background:r===range?"var(--accent)":"transparent",
          color:r===range?"#fff":"var(--text-muted)",transition:"all 0.1s"}}>
          {r}
        </button>
      ))}
    </div>
  );
}

// ── SnapCard: 24h delta with safe rendering ───────────────────────────────────
function SnapCard({label,value,delta,from,color}:{label:string;value:string;delta:number|null;from:number|null;color?:string}) {
  // ALL values safety-checked before render
  const safeLabel = str(label);
  const safeValue = str(value);
  const safeColor = str(color) || "var(--text-primary)";
  const safeDelta = (delta!==null&&isFinite(delta))?delta:null;
  const pct = safeDelta!==null&&from!==null&&isFinite(from)&&from!==0 ? safeDelta/Math.abs(from)*100 : null;
  const safePct = pct!==null&&isFinite(pct)?pct:null;
  const pos = safeDelta!==null?safeDelta>0:null;
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"var(--text-muted)",textTransform:"uppercase"}}>{safeLabel}</div>
      <div style={{fontSize:21,fontWeight:800,color:safeColor,fontFamily:"monospace",lineHeight:1.1}}>{safeValue}</div>
      {safeDelta!==null&&(
        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:600,padding:"1px 7px",borderRadius:4,
            color:pos?"#22c55e":safeDelta<0?"#ef4444":"var(--text-muted)",
            background:pos?"rgba(34,197,94,0.1)":safeDelta<0?"rgba(239,68,68,0.1)":"rgba(0,0,0,0.04)"}}>
            {/* str() ensures we never render a raw number as React child */}
            {str(safeDelta>0?`+${Math.round(safeDelta).toLocaleString("en-US")}`:Math.round(safeDelta).toLocaleString("en-US"))}
          </span>
          {safePct!==null&&<span style={{fontSize:10,color:pos?"#22c55e":safeDelta<0?"#ef4444":"var(--text-muted)",fontWeight:600}}>{str(`(${safePct>=0?"+":""}${safePct.toFixed(1)}%)`)}</span>}
          <span style={{fontSize:10,color:"var(--text-dim)"}}>vs 24h ago</span>
        </div>
      )}
    </div>
  );
}

function Pager({total,page,per,set}:{total:number;page:number;per:number;set:(p:number)=>void}) {
  const pages=Math.ceil(total/per); if(pages<=1)return null;
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:12}}>
      <button onClick={()=>set(page-1)} disabled={page===0} style={{padding:"4px 11px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===0?"not-allowed":"pointer",opacity:page===0?.4:1,fontSize:13}}>←</button>
      {Array.from({length:pages},(_,i)=>i).map(i=>(
        <button key={i} onClick={()=>set(i)} style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--border)",background:i===page?"var(--accent)":"var(--bg-card)",color:i===page?"#fff":"var(--text-muted)",cursor:"pointer",fontWeight:i===page?700:400,fontSize:13,minWidth:32}}>{i+1}</button>
      ))}
      <button onClick={()=>set(page+1)} disabled={page===pages-1} style={{padding:"4px 11px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===pages-1?"not-allowed":"pointer",opacity:page===pages-1?.4:1,fontSize:13}}>→</button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [range,  setRange]  = useState<TimeRange>("24h");
  const [ts,     setTs]     = useState<TsPoint[]>([]);
  const [ts24,   setTs24]   = useState<TsPoint[]>([]);
  const [live,   setLive]   = useState<LivePt[]>([]);
  const [bench,  setBench]  = useState<ServerBench[]>([]);
  const [pg,     setPg]     = useState(0);
  const [last,   setLast]   = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);

  // Simple fetch functions — no useCallback chain
  const fetchLive = async (net: string) => {
    try {
      const r = await fetch(`/api/network/stats/live?network=${net}`);
      if (!r.ok) return;
      const j = await r.json() as any;
      const d = j?.data ?? j ?? {};
      setLive(prev => [...prev, {
        ts: Date.now(),
        blockHeight:      num(d.blockHeight),
        activeBlobs:      num(d.activeBlobs),
        totalStorageGB:   num(d.totalStorageBytes) / 1e9,
        totalBlobEvents:  num(d.totalBlobEvents),
        pendingOrFailed:  num(d.pendingOrFailed),
        deletedBlobs:     num(d.deletedBlobs),
      }].slice(-120));
      setLast(new Date().toLocaleTimeString());
    } catch {}
  };

  const fetchTs = async (net: string, r: TimeRange) => {
    try {
      const res_ = r==="1h"||r==="24h"?"5m":"1h";
      const j = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=${res_}&range=${r}`).then(x=>x.json()) as any;
      const series = (j?.data?.series ?? []) as any[];
      setTs(series.map(s=>({
        tsMs:           num(s.tsMs),
        activeBlobs:    num(s.activeBlobs),
        totalStorageGB: num(s.totalStorageGB),
        totalBlobEvents:num(s.totalBlobEvents),
        pendingOrFailed:num(s.pendingOrFailed),
        deletedBlobs:   num(s.deletedBlobs),
        blockHeight:    num(s.blockHeight),
      })));
    } catch {}
  };

  const fetchTs24 = async (net: string) => {
    try {
      const j = await fetch(`/api/network/stats/timeseries?network=${net}&resolution=5m&range=24h`).then(x=>x.json()) as any;
      const series = (j?.data?.series ?? []) as any[];
      setTs24(series.map(s=>({
        tsMs:           num(s.tsMs),
        activeBlobs:    num(s.activeBlobs),
        totalStorageGB: num(s.totalStorageGB),
        totalBlobEvents:num(s.totalBlobEvents),
        pendingOrFailed:num(s.pendingOrFailed),
        deletedBlobs:   num(s.deletedBlobs),
        blockHeight:    num(s.blockHeight),
      })));
    } catch {}
  };

  const fetchBench = async () => {
    try {
      const j = await fetch("/api/benchmark/results?limit=200").then(x=>x.json()) as any;
      if (Array.isArray(j?.results)) setBench(j.results);
    } catch {}
  };

  useEffect(()=>{
    setLive([]);
    fetchLive(network);
    fetchTs(network, range);
    fetchTs24(network);
    fetchBench();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(()=>{fetchLive(network);fetchTs24(network);fetchBench();}, POLL);
    return ()=>{ if(timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  useEffect(()=>{ fetchTs(network, range); }, [range, network]);

  if (network === "testnet") return <TestnetBanner />;

  // Chart data
  const cd = ts.length > 0 ? ts : live.map(p=>({
    tsMs:p.ts, activeBlobs:p.activeBlobs, totalStorageGB:p.totalStorageGB,
    totalBlobEvents:p.totalBlobEvents, pendingOrFailed:p.pendingOrFailed,
    deletedBlobs:p.deletedBlobs, blockHeight:p.blockHeight,
  }));
  const labels = cd.map(p=>tLbl(p.tsMs,range));
  const latest = live[live.length-1];
  const latestTs = cd[cd.length-1];

  // 24h deltas — all safely computed
  const t24Last  = ts24[ts24.length-1];
  const t24First = ts24[0];
  const d24 = (key: keyof TsPoint): number|null => {
    const a=num(t24Last?.[key]), b=num(t24First?.[key]);
    if (!t24Last||!t24First) return null;
    const d=a-b; return isFinite(d)?d:null;
  };

  const pagedBench = bench.slice(pg*PG,(pg+1)*PG);

  return(
    <div style={{background:"var(--bg-primary)",minHeight:"100vh",padding:"28px 36px 48px"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:28}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"var(--text-primary)",margin:0,letterSpacing:-0.5}}>Network Analytics</h1>
          <p style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 0"}}>{str(config.label)} · {POLL/1000}s poll · {str(last)||"—"}</p>
        </div>
        <button onClick={()=>{fetchLive(network);fetchTs24(network);}} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"var(--bg-card)",border:"1px solid var(--border)",color:"var(--text-muted)",cursor:"pointer"}}>⟳ Refresh</button>
      </div>

      {/* Network Snapshot — fixed 24h */}
      <Sec title="Network Snapshot" sub="Current state · Δ so với 24 giờ trước (không bị ảnh hưởng bộ lọc)">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
          <SnapCard label="Block Height"   value={str(latest?`#${num(latest.blockHeight).toLocaleString("en-US")}`:undefined)}  color="var(--accent)"  delta={null} from={null}/>
          <SnapCard label="Active Blobs"   value={fmtN(latestTs?.activeBlobs)}    color="#22c55e" delta={d24("activeBlobs")}    from={num(t24First?.activeBlobs)}/>
          <SnapCard label="Storage Used"   value={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa" delta={d24("totalStorageGB")} from={num(t24First?.totalStorageGB)}/>
          <SnapCard label="Blob Events"    value={fmtN(latestTs?.totalBlobEvents)} color="#fb923c" delta={d24("totalBlobEvents")} from={num(t24First?.totalBlobEvents)}/>
          <SnapCard label="Pending Blobs"  value={fmtN(latestTs?.pendingOrFailed)} color="#fbbf24" delta={d24("pendingOrFailed")} from={num(t24First?.pendingOrFailed)}/>
          <SnapCard label="Deleted Blobs"  value={fmtN(latestTs?.deletedBlobs)}    color="#f87171" delta={d24("deletedBlobs")}   from={num(t24First?.deletedBlobs)}/>
        </div>
      </Sec>

      {/* Blob Analytics */}
      <Sec title="Blob Analytics" sub="Blob count and activity over time" right={<RangeSel range={range} onChange={r=>{setRange(r);setPg(0);}}/>}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <Card title="Active Blobs" sub={`${range} window`} latest={fmtN(latestTs?.activeBlobs)} color="#22c55e">
            <Chart series={[{data:cd.map(p=>num(p.activeBlobs)),color:"#22c55e",name:"Active",fmt:v=>fmtN(v)}]} labels={labels} height={140}/>
          </Card>
          <Card title="Blob Events" sub="blob_activities_aggregate count" latest={fmtN(latestTs?.totalBlobEvents)} color="#fb923c">
            <Chart series={[{data:cd.map(p=>num(p.totalBlobEvents)),color:"#fb923c",name:"Events",fmt:v=>fmtN(v)}]} labels={labels} height={140}/>
          </Card>
        </div>
        <Card title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series">
          <Chart perScale series={[
            {data:cd.map(p=>num(p.pendingOrFailed)),color:"#fbbf24",name:"Pending",fmt:v=>fmtN(v)},
            {data:cd.map(p=>num(p.deletedBlobs)),   color:"#f87171",name:"Deleted",fmt:v=>fmtN(v)},
          ]} labels={labels} height={120}/>
        </Card>
      </Sec>

      {/* Storage */}
      <Sec title="Storage Analytics" sub="Storage capacity and utilization">
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>
          <Card title="Storage Used (GB)" latest={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa">
            <Chart series={[{data:cd.map(p=>num(p.totalStorageGB)),color:"#a78bfa",name:"GB",fmt:v=>`${v.toFixed(2)} GB`}]} labels={labels} height={150}/>
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              {label:"Total Storage", val:fmtGB(latestTs?.totalStorageGB),      c:"#a78bfa"},
              {label:"Active Blobs",  val:fmtN(latestTs?.activeBlobs),          c:"#22c55e"},
              {label:"Avg Blob Size", val:(()=>{const a=num(latestTs?.activeBlobs),g=num(latestTs?.totalStorageGB);return a>0?`${((g*1e9)/a/1024).toFixed(0)} KB`:"—";})(), c:"var(--accent)"},
            ].map(({label,val,c})=>(
              <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px",flex:1}}>
                <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{str(label)}</div>
                <div style={{fontSize:19,fontWeight:800,color:str(c),fontFamily:"monospace"}}>{str(val)}</div>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      {/* Block Performance */}
      <Sec title="Block Performance" sub="Block height progression">
        <Card title="Block Height" latest={latest?str(`#${num(latest.blockHeight).toLocaleString("en-US")}`):"—"} color="var(--accent)">
          <Chart series={[{data:cd.map(p=>num(p.blockHeight)).filter(v=>v>0),color:"var(--accent)",name:"Block",fmt:v=>str(`#${Math.round(v).toLocaleString("en-US")}`)}]} labels={labels} height={130}/>
        </Card>
      </Sec>

      {/* Benchmark — all users from server */}
      <Sec title="Benchmark Analytics" sub={str(`${bench.length} total runs across all users`)}>
        {bench.length===0?(
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center",color:"var(--text-muted)"}}>
            No benchmark data yet — run a benchmark to populate
          </div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              <Card title="Score History (all users)" latest={str(bench[0]?.score)} color="#818cf8">
                <Chart series={[{data:[...bench].reverse().map(h=>num(h.score)),color:"#818cf8",name:"Score",fmt:v=>str(`${Math.round(v)}/1000`)}]}
                  labels={[...bench].reverse().map(h=>str(h.ts?new Date(h.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""))} height={130}/>
              </Card>
              <Card title="Upload Speed (all users)">
                <Chart series={[{data:[...bench].reverse().map(h=>num(h.avgUploadKbs)),color:"var(--accent)",name:"Upload",fmt:v=>fmtKbs(v)}]}
                  labels={[...bench].reverse().map(h=>str(h.ts?new Date(h.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""))} height={130}/>
              </Card>
            </div>

            {/* Global table */}
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"13px 18px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--text-primary)"}}>Global Run History</div>
                  <div style={{fontSize:12,color:"var(--text-muted)"}}>{bench.length} runs · Page {pg+1}/{Math.max(1,Math.ceil(bench.length/PG))}</div>
                </div>
                <button onClick={fetchBench} style={{padding:"4px 11px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:"pointer",fontSize:12}}>⟳</button>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{background:"var(--bg-card2)"}}>
                      {["User","Time","Score","Tier","Upload","Latency","TX","Mode"].map(h=>(
                        <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:10,fontWeight:600,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBench.map((h,i)=>{
                      const sc=num(h.score);
                      const c=sc>=900?"#22c55e":sc>=600?"#fbbf24":"#f87171";
                      return(
                        <tr key={str(h.id)||i} style={{borderTop:"1px solid var(--border-soft)"}}>
                          <td style={{padding:"8px 13px",fontFamily:"monospace",fontSize:12,color:"var(--text-dim)"}}>{str(h.ip)}</td>
                          <td style={{padding:"8px 13px",fontSize:11,color:"var(--text-dim)",fontFamily:"monospace"}}>{str(h.ts?new Date(h.ts).toLocaleString([],{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—")}</td>
                          <td><span style={{fontFamily:"monospace",fontWeight:800,color:c,fontSize:14}}>{str(sc>0?sc:undefined)}</span></td>
                          <td><span style={{fontSize:11,color:c,fontWeight:600}}>{str(h.tier)}</span></td>
                          <td style={{fontFamily:"monospace",color:"var(--accent)"}}>{fmtKbs(h.avgUploadKbs)}</td>
                          <td style={{fontFamily:"monospace",color:"#c084fc"}}>{fmtMs(h.latencyAvg)}</td>
                          <td style={{fontFamily:"monospace",color:"#fb923c"}}>{fmtMs(h.txConfirmMs)}</td>
                          <td><span style={{fontSize:10,fontWeight:700,color:"#818cf8",textTransform:"uppercase"}}>{str(h.mode)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"8px 18px",borderTop:"1px solid var(--border-soft)"}}>
                <Pager total={bench.length} page={pg} per={PG} set={setPg}/>
              </div>
            </div>
          </>
        )}
      </Sec>
    </div>
  );
}