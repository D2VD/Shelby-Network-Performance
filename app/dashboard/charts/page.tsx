"use client";
/**
 * app/dashboard/charts/page.tsx — v26.0
 * FIXES:
 * 1. Testnet charts: accumulate live points into a local series array
 *    Each 30s poll adds a point → charts render after a few minutes
 * 2. Stale banner: only show when cur.activeBlobs === 0 (no real data)
 *    Don't show when data IS displaying correctly from cache
 * 3. Testnet charts use timeseries from backend (appendTestnetTimeseries)
 *    if available, otherwise fall back to local live accumulation
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number;
  blockHeight: number; storageProviders?: number; placementGroups?: number;
  avgBlobSizeKB?: number;
}
interface ServerBench {
  id: string; ip?: string; deviceId?: string; ts: string; tsMs?: number;
  score: number; tier: string; avgUploadKbs: number; avgDownloadKbs: number;
  latencyAvg: number; txConfirmMs: number; mode: string; maxBytes?: number;
}
type TimeRange = "1h" | "24h" | "7d" | "30d";

const POLL = 30_000;
const PG   = 15;

function num(v: unknown, fb = 0): number { const n = Number(v); return isFinite(n) ? n : fb; }
function fmtN(v: unknown): string { const n = num(v); return n === 0 ? "0" : Math.round(n).toLocaleString("en-US"); }
function fmtGB(v: unknown): string { const n = num(v); return n === 0 ? "—" : `${n.toFixed(2)} GB`; }
function fmtKbs(v: unknown): string { const n = num(v); if (!n) return "—"; return n >= 1024 ? `${(n/1024).toFixed(2)} MB/s` : `${n.toFixed(1)} KB/s`; }
function fmtMs(v: unknown): string { const n = num(v); if (!n) return "—"; return n >= 1000 ? `${(n/1000).toFixed(2)}s` : `${n.toFixed(0)}ms`; }
function fmtKB(v: unknown): string { const n = num(v); if (!n) return "—"; return n >= 1024 ? `${(n/1024).toFixed(1)} MB` : `${n.toFixed(0)} KB`; }
function tLbl(ts: number, r: TimeRange): string {
  const d = new Date(ts);
  return (r==="1h"||r==="24h") ? `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}` : `${d.getUTCMonth()+1}/${d.getUTCDate()}`;
}

function enrichPoint(s: Record<string, unknown>): TsPoint {
  const ab = num(s.activeBlobs), sg = num(s.totalStorageGB);
  return {
    tsMs: num(s.tsMs), activeBlobs: ab, totalStorageGB: sg,
    totalBlobEvents: num(s.totalBlobEvents), pendingOrFailed: num(s.pendingOrFailed),
    deletedBlobs: num(s.deletedBlobs), blockHeight: num(s.blockHeight),
    storageProviders: num(s.storageProviders), placementGroups: num(s.placementGroups),
    avgBlobSizeKB: (ab > 0 && sg > 0) ? (sg * 1e9) / ab / 1024 : 0,
  };
}

function LiveClock() {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const get = () => { const d = new Date(); return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} UTC`; };
    setClock(get());
    const id = setInterval(() => setClock(get()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!clock) return null;
  return <span suppressHydrationWarning style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-dim)", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 7 }}>🕐 {clock}</span>;
}

type DKind = "device" | "legacy" | "unknown";
function getDisplayId(h: Pick<ServerBench,"ip"|"deviceId">): { id: string; kind: DKind } {
  const dId = (h.deviceId ?? "").trim(), ip = (h.ip ?? "").trim();
  if (dId.startsWith("dev_")) return { id: dId, kind: "device" };
  if (dId.startsWith("usr_")) return { id: dId, kind: "legacy" };
  if (ip.startsWith("dev_"))  return { id: ip,  kind: "device" };
  if (ip.startsWith("usr_"))  return { id: ip,  kind: "legacy" };
  if (dId) return { id: dId, kind: "unknown" }; if (ip) return { id: ip, kind: "unknown" };
  return { id: "—", kind: "unknown" };
}
function DeviceBadge({ h }: { h: Pick<ServerBench,"ip"|"deviceId"> }) {
  const { id, kind } = getDisplayId(h);
  const cfg: Record<DKind, { bg: string; color: string; label: string }> = {
    device:  { bg: "rgba(6,182,212,0.12)",   color: "var(--accent)", label: "device" },
    legacy:  { bg: "rgba(100,116,139,0.14)", color: "#94a3b8",       label: "legacy" },
    unknown: { bg: "rgba(100,116,139,0.08)", color: "#64748b",       label: "" },
  };
  const s = cfg[kind];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "monospace", fontSize: 11 }}><span style={{ color: kind==="legacy"?"#94a3b8":"var(--text-muted)", fontStyle: kind==="legacy"?"italic":"normal" }}>{id}</span>{s.label&&<span style={{ fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:s.bg,color:s.color,textTransform:"uppercase" }}>{s.label}</span>}</span>;
}

interface ChartSeries { data: number[]; color: string; name: string; fmt?: (v: number) => string; }
function Chart({ series, labels, height = 150, perScale = false }: { series: ChartSeries[]; labels: string[]; height?: number; perScale?: boolean; }) {
  const { isDark } = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinIdx, setPinIdx]     = useState<number | null>(null);
  const [inChart, setInChart]   = useState(false);

  const VW=600,PL=56,PR=12,PT=16,PB=24,iW=VW-PL-PR,iH=height-PT-PB;
  const n=Math.max(...series.map(s=>s.data.length),2);
  const toIdx=useCallback((e:React.MouseEvent<SVGSVGElement>)=>{
    const svgEl=svgRef.current;if(!svgEl)return 0;
    try{const pt=svgEl.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const ctm=svgEl.getScreenCTM();if(!ctm)throw new Error("no CTM");const sp=pt.matrixTransform(ctm.inverse());return Math.round(Math.max(0,Math.min(1,(sp.x-PL)/iW))*(n-1));}
    catch{const rect=svgEl.getBoundingClientRect();return Math.round(Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*VW-PL)/iW))*(n-1));}
  },[n,iW]);

  const allV=series.flatMap(s=>s.data.filter(v=>isFinite(v)&&v>0));
  if(allV.length<2)return<div style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-dim)",fontSize:12}}>Collecting data…</div>;

  const doms=series.map(s=>{const vs=s.data.filter(v=>isFinite(v)&&v>0);if(!vs.length)return{mn:0,mx:1};const mn=Math.min(...vs),mx=Math.max(...vs),p=(mx-mn)*0.08||mn*0.05||1;return{mn:Math.max(0,mn-p),mx:mx+p};});
  const gMn=perScale?0:Math.min(...allV)*0.97,gMx=perScale?0:Math.max(...allV)*1.03;
  const xp=(i:number)=>PL+(i/Math.max(n-1,1))*iW;
  const yp=(v:number,si=0)=>{if(!isFinite(v))return PT+iH/2;if(perScale){const{mn,mx}=doms[si];return PT+iH-((v-mn)/(mx-mn||1))*iH;}return PT+iH-((v-gMn)/(gMx-gMn||1))*iH;};
  const fY=(v:number)=>!isFinite(v)||!v?"":v>=1e9?`${(v/1e9).toFixed(1)}G`:v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:String(Math.round(v));
  const active=pinIdx??hoverIdx,gc=isDark?"#1e3a5f":"#e5e7eb",tc="var(--text-dim)";
  const ticks=[0,0.25,0.5,0.75,1].map(f=>({f,v:perScale?doms[0].mn+f*(doms[0].mx-doms[0].mn):gMn+f*(gMx-gMn)}));
  const tipRight=active!==null?active<n*0.5:true;

  return(
    <div style={{position:"relative"}} onMouseEnter={()=>setInChart(true)} onMouseLeave={()=>{setInChart(false);setHoverIdx(null);}}>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${height}`} style={{width:"100%",height,display:"block",cursor:"crosshair"}} onMouseMove={e=>{if(inChart)setHoverIdx(toIdx(e));}} onMouseLeave={()=>setHoverIdx(null)} onClick={e=>{const i=toIdx(e);setPinIdx(p=>p===i?null:i);}}>
        {ticks.map(({f,v})=>{const y=PT+iH-f*iH;return<g key={f}><line x1={PL} x2={VW-PR} y1={y} y2={y} stroke={gc} strokeWidth={1}/><text x={PL-5} y={y+3} textAnchor="end" fontSize={9} fill={tc}>{fY(v)}</text></g>;})}
        <defs>{series.map((s,si)=><linearGradient key={si} id={`cg${si}${s.color.replace(/[^a-z0-9]/gi,"")}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={isDark?0.3:0.18}/><stop offset="100%" stopColor={s.color} stopOpacity={0.02}/></linearGradient>)}</defs>
        {series.map((s,si)=>{if(s.data.length<2)return null;const pts=s.data.map((v,i)=>`${xp(i).toFixed(2)},${yp(v,si).toFixed(2)}`).join(" ");const area=`${xp(0).toFixed(2)},${PT+iH} ${pts} ${xp(s.data.length-1).toFixed(2)},${PT+iH}`;return<g key={si}><polygon points={area} fill={`url(#cg${si}${s.color.replace(/[^a-z0-9]/gi,"")})`}/><polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"/>{s.data.length>0&&<circle cx={xp(s.data.length-1)} cy={yp(s.data[s.data.length-1],si)} r={4} fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/>}</g>;})}
        {active!==null&&inChart&&(()=>{const cx=xp(active);return<g><line x1={cx} y1={PT} x2={cx} y2={PT+iH} stroke={isDark?"rgba(148,163,184,0.6)":"rgba(100,116,139,0.5)"} strokeWidth={1} strokeDasharray="4 3"/>{series.map((s,si)=>{const v=s.data[active];if(!v||!isFinite(v))return null;return<g key={si}><circle cx={cx} cy={yp(v,si)} r={7} fill={s.color} opacity={0.15}/><circle cx={cx} cy={yp(v,si)} r={4.5} fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/></g>;})}</g>;})()}
        {labels.length>0&&[0,Math.floor(labels.length/2),labels.length-1].map(i=>i<labels.length&&labels[i]?<text key={i} x={xp(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tc}>{labels[i]}</text>:null)}
      </svg>
      {active!==null&&inChart&&<div style={{position:"absolute",left:tipRight?`calc(${xp(active)/VW*100}% + 8px)`:"auto",right:tipRight?"auto":`calc(${100-xp(active)/VW*100}% + 8px)`,top:8,zIndex:50,pointerEvents:"none",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"9px 13px",fontSize:12,minWidth:150,whiteSpace:"nowrap",boxShadow:"0 4px 20px var(--shadow-color)"}}>{pinIdx!==null&&<div style={{fontSize:9,color:"var(--accent)",marginBottom:4,fontWeight:600}}>📌 Pinned — click to unpin</div>}{labels[active]&&<div style={{color:"var(--text-dim)",fontSize:10,marginBottom:6,fontWeight:600}}>{labels[active]}</div>}{series.map((s,si)=>{const v=s.data[active];if(!v||!isFinite(v))return null;return<div key={si} style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:2,alignItems:"center"}}><span style={{display:"inline-flex",alignItems:"center",gap:5,color:"var(--text-muted)"}}><span style={{width:8,height:8,borderRadius:"50%",background:s.color,display:"inline-block",flexShrink:0}}/>{s.name}</span><span style={{fontWeight:700,fontFamily:"monospace",color:s.color}}>{s.fmt?s.fmt(v):fmtN(v)}</span></div>;})}</div>}
    </div>
  );
}

function Sec({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return(
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><h2 style={{fontSize:19,fontWeight:800,color:"var(--text-primary)",margin:0}}>{title}</h2>{sub&&<p style={{fontSize:13,color:"var(--text-muted)",margin:"3px 0 0"}}>{sub}</p>}</div>
        {right&&<div>{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Card({ title, sub, latest, color, children }: { title: string; sub?: string; latest?: string; color?: string; children: React.ReactNode }) {
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:13,padding:"16px 18px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div><div style={{fontSize:13,fontWeight:700,color:"var(--text-secondary)"}}>{title}</div>{sub&&<div style={{fontSize:11,color:"var(--text-dim)"}}>{sub}</div>}</div>
        {latest&&<div style={{fontFamily:"monospace",fontSize:15,fontWeight:800,color:color||"var(--text-primary)"}}>{latest}</div>}
      </div>
      {children}
    </div>
  );
}

function RangeSel({ range, onChange }: { range: TimeRange; onChange: (r: TimeRange) => void }) {
  return(
    <div style={{display:"flex",gap:3,background:"var(--bg-card2)",border:"1px solid var(--border)",borderRadius:8,padding:3}}>
      {(["1h","24h","7d","30d"] as TimeRange[]).map(r=><button key={r} onClick={()=>onChange(r)} style={{padding:"5px 13px",borderRadius:6,fontSize:12,fontWeight:r===range?700:400,border:"none",cursor:"pointer",background:r===range?"var(--accent)":"transparent",color:r===range?"#fff":"var(--text-muted)",transition:"all 0.1s"}}>{r}</button>)}
    </div>
  );
}

function SnapCard({ label, value, delta, from, color }: { label: string; value: string; delta: number | null; from: number | null; color?: string }) {
  const c=color||"var(--text-primary)",pos=delta!==null?delta>0:null;
  const pct=(delta!==null&&from!==null&&Math.abs(from)>0)?delta/Math.abs(from)*100:null;
  const safeP=pct!==null&&isFinite(pct)?pct:null;
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"var(--text-muted)",textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:21,fontWeight:800,color:c,fontFamily:"monospace",lineHeight:1.1}}>{value}</div>
      {delta!==null&&<div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}><span style={{fontSize:11,fontWeight:600,padding:"1px 7px",borderRadius:4,color:pos===true?"#22c55e":delta<0?"#ef4444":"var(--text-muted)",background:pos===true?"rgba(34,197,94,0.1)":delta<0?"rgba(239,68,68,0.1)":"rgba(0,0,0,0.04)"}}>{delta>0?"+":""}{Math.round(delta).toLocaleString("en-US")}</span>{safeP!==null&&<span style={{fontSize:10,color:pos===true?"#22c55e":delta<0?"#ef4444":"var(--text-muted)",fontWeight:600}}>({safeP>=0?"+":""}{safeP.toFixed(1)}%)</span>}<span style={{fontSize:10,color:"var(--text-dim)"}}>vs previous 24h</span></div>}
    </div>
  );
}

function Pager({ total, page, per, set }: { total: number; page: number; per: number; set: (p: number) => void }) {
  const pages=Math.ceil(total/per);if(pages<=1)return null;
  return<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:12}}><button onClick={()=>set(page-1)} disabled={page===0} style={{padding:"4px 11px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===0?"not-allowed":"pointer",opacity:page===0?.4:1,fontSize:13}}>←</button>{Array.from({length:Math.min(pages,8)},(_,i)=>i).map(i=><button key={i} onClick={()=>set(i)} style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--border)",background:i===page?"var(--accent)":"var(--bg-card)",color:i===page?"#fff":"var(--text-muted)",cursor:"pointer",fontWeight:i===page?700:400,fontSize:13,minWidth:32}}>{i+1}</button>)}{pages>8&&<span style={{fontSize:12,color:"var(--text-dim)"}}>…{pages}</span>}<button onClick={()=>set(page+1)} disabled={page===pages-1} style={{padding:"4px 11px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===pages-1?"not-allowed":"pointer",opacity:page===pages-1?.4:1,fontSize:13}}>→</button></div>;
}

export default function ChartsPage() {
  const { network, config } = useNetwork();
  const isTestnet  = network === "testnet";
  const accentColor = isTestnet ? "#9333ea" : "var(--accent)";
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [range,        setRange]        = useState<TimeRange>("24h");
  const [ts,           setTs]           = useState<TsPoint[]>([]);
  const [ts48h,        setTs48h]        = useState<TsPoint[]>([]);
  // FIX: liveSnap stores latest live point
  const [liveSnap,     setLiveSnap]     = useState<TsPoint | null>(null);
  // FIX: localSeries accumulates live points for testnet (which has no ts backend)
  const [localSeries,  setLocalSeries]  = useState<TsPoint[]>([]);
  const [bench,        setBench]        = useState<ServerBench[]>([]);
  const [pg,           setPg]           = useState(0);
  const [benchLoading, setBenchLoading] = useState(true);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // FIX: Reset all state when network changes
  useEffect(() => {
    if (alive.current) {
      setLiveSnap(null);
      setTs([]);
      setTs48h([]);
      setLocalSeries([]);
      setFetchError(null);
    }
  }, [network]);

  const fetchLive = useCallback(async (net: string) => {
    try {
      const r = await fetch(`/api/network/stats/live?network=${net}`);
      if (r.status === 404 || r.status === 503) throw new Error(`HTTP ${r.status}`);
      const j = await r.json() as Record<string, unknown>;
      const d = (j?.data ?? j ?? {}) as Record<string, unknown>;
      if (!d.blockHeight && !d.activeBlobs && !d.storageProviders) throw new Error("Empty response");
      if (alive.current) {
        setFetchError(null);
        const pt: TsPoint = {
          tsMs:             Date.now(),
          blockHeight:      num(d.blockHeight),
          activeBlobs:      num(d.activeBlobs),
          totalStorageGB:   num(d.totalStorageBytes) / 1e9,
          totalBlobEvents:  num(d.totalBlobEvents),
          pendingOrFailed:  num(d.pendingOrFailed),
          deletedBlobs:     num(d.deletedBlobs),
          storageProviders: num(d.storageProviders),
          placementGroups:  num(d.placementGroups),
        };
        setLiveSnap(pt);
        // FIX: For testnet, accumulate live points for chart rendering
        if (net === "testnet") {
          setLocalSeries(prev => {
            const next = [...prev, pt];
            return next.length > 120 ? next.slice(-120) : next; // keep 1h of 30s points
          });
        }
      }
    } catch (e) {
      if (alive.current && !ts.length && !localSeries.length) setFetchError(`Live fetch failed — using cached data`);
    }
  }, [ts.length, localSeries.length]);

  const fetchTs = useCallback(async (net: string, r: TimeRange) => {
    try {
      const res_=(r==="1h"||r==="24h")?"5m":"1h";
      const j=await fetch(`/api/network/stats/timeseries?network=${net}&resolution=${res_}&range=${r}`).then(x=>x.json()) as Record<string,unknown>;
      const arr=((j?.data as Record<string,unknown>)?.series??[]) as Record<string,unknown>[];
      if(alive.current)setTs(arr.map(enrichPoint));
    } catch { /* silent */ }
  }, []);

  const fetchTs48h = useCallback(async (net: string) => {
    try {
      const j=await fetch(`/api/network/stats/timeseries?network=${net}&resolution=1h&range=7d`).then(x=>x.json()) as Record<string,unknown>;
      const arr=((j?.data as Record<string,unknown>)?.series??[]) as Record<string,unknown>[];
      if(alive.current)setTs48h(arr.map(enrichPoint).slice(-48));
    } catch { /* silent */ }
  }, []);

  const fetchBench = useCallback(async () => {
    if(alive.current)setBenchLoading(true);
    try{const j=await fetch("/api/benchmark/results?limit=500").then(x=>x.json()) as Record<string,unknown>;if(alive.current)setBench(Array.isArray(j?.results)?j.results as ServerBench[]:[]);}
    catch{if(alive.current)setBench([]);}
    finally{if(alive.current)setBenchLoading(false);}
  }, []);

  useEffect(() => {
    fetchLive(network); fetchTs(network, range); fetchTs48h(network); fetchBench();
    if(timerRef.current)clearInterval(timerRef.current);
    timerRef.current=setInterval(()=>{if(!alive.current)return;fetchLive(network);fetchTs48h(network);fetchBench();},POLL);
    return()=>{if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null;}};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  useEffect(() => { fetchTs(network, range); }, [range, network, fetchTs]);

  // For charts: use backend ts if available, otherwise local accumulated series
  // This means testnet shows local series (grows over page session) OR backend ts if populated
  const cd     = ts.length > 0 ? ts : localSeries;
  const labels = cd.map(p => tLbl(p.tsMs, range));
  const latestTs = cd[cd.length - 1];

  // FIX: Use || for numeric fallbacks
  const cur = {
    blockHeight:      liveSnap?.blockHeight      || latestTs?.blockHeight      || 0,
    activeBlobs:      liveSnap?.activeBlobs      || latestTs?.activeBlobs      || 0,
    totalStorageGB:   liveSnap?.totalStorageGB   || latestTs?.totalStorageGB   || 0,
    totalBlobEvents:  liveSnap?.totalBlobEvents  || latestTs?.totalBlobEvents  || 0,
    pendingOrFailed:  liveSnap?.pendingOrFailed  || latestTs?.pendingOrFailed  || 0,
    deletedBlobs:     liveSnap?.deletedBlobs     || latestTs?.deletedBlobs     || 0,
    storageProviders: liveSnap?.storageProviders || latestTs?.storageProviders || 0,
    placementGroups:  liveSnap?.placementGroups  || latestTs?.placementGroups  || 0,
    avgBlobSizeKB:    latestTs?.avgBlobSizeKB    || 0,
  };

  const mid48=Math.floor(ts48h.length/2);
  const prevLast=ts48h[mid48-1],currLast=ts48h[ts48h.length-1];
  function d48(key: keyof TsPoint) {
    if(!prevLast||!currLast)return{delta:null,from:null};
    const c=num(currLast[key]),p=num(prevLast[key]);
    if(!c&&!p)return{delta:null,from:null};
    return{delta:c-p,from:p};
  }

  // FIX: Only show stale banner when we truly have NO data (not just when from cache)
  const showStale = fetchError !== null && cur.activeBlobs === 0 && cur.blockHeight === 0;

  const allBench=bench,pagedBench=allBench.slice(pg*PG,(pg+1)*PG);
  const benchChron=[...allBench].reverse(),bLabels=benchChron.map(h=>h.ts?new Date(h.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"");
  const avgScore=allBench.length?allBench.reduce((s,h)=>s+num(h.score),0)/allBench.length:0;
  const avgUpload=allBench.length?allBench.reduce((s,h)=>s+num(h.avgUploadKbs),0)/allBench.length:0;
  const avgLatency=allBench.length?allBench.reduce((s,h)=>s+num(h.latencyAvg),0)/allBench.length:0;
  const avgTxConf=allBench.length?allBench.reduce((s,h)=>s+num(h.txConfirmMs),0)/allBench.length:0;

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh", padding: "28px 36px 48px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.5 }}>
            {isTestnet ? "Testnet Analytics" : "Network Analytics"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
            {isTestnet ? "Shelby Testnet · Aptos Testnet RPC" : (config?.label ?? "Shelbynet")} · Refresh every {POLL/1000}s
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LiveClock />
          <button onClick={() => { fetchLive(network); fetchTs48h(network); fetchBench(); }} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}>⟳ Refresh</button>
        </div>
      </div>

      {isTestnet && (
        <div style={{ background: "rgba(147,51,234,0.08)", border: "1px solid rgba(147,51,234,0.25)", borderRadius: 10, padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#c084fc", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚗</span><span>Early Testnet · Data from Aptos Testnet RPC (REST API)</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Auto-refresh every {POLL/1000}s</span>
        </div>
      )}

      {/* FIX: Only show stale banner when truly no data */}
      {showStale && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 9, padding: "8px 14px", marginBottom: 16, fontSize: 12, color: "#d97706", display: "flex", alignItems: "center", gap: 6 }}>
          <span>⏱</span><span>{fetchError}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>Retrying every {POLL/1000}s</span>
        </div>
      )}

      {/* Network Snapshot */}
      <Sec title="Network Snapshot" sub="Current values · % change vs previous 24h window">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
          <SnapCard label="Block Height" value={cur.blockHeight?`#${cur.blockHeight.toLocaleString("en-US")}`:"—"} color={accentColor} delta={null} from={null} />
          {(()=>{const{delta,from}=d48("activeBlobs");return<SnapCard label="Active Blobs" value={fmtN(cur.activeBlobs)} color="#22c55e" delta={delta} from={from}/>;})()}
          {isTestnet
            ? <SnapCard label="Storage Providers" value={fmtN(cur.storageProviders)} color="#0891b2" delta={null} from={null} />
            : (()=>{const{delta,from}=d48("totalStorageGB");return<SnapCard label="Storage Used" value={fmtGB(cur.totalStorageGB)} color="#a78bfa" delta={delta} from={from}/>;})()
          }
          {isTestnet
            ? <SnapCard label="Placement Groups" value={fmtN(cur.placementGroups)} color="#d97706" delta={null} from={null} />
            : (()=>{const{delta,from}=d48("totalBlobEvents");return<SnapCard label="Blob Events" value={fmtN(cur.totalBlobEvents)} color="#fb923c" delta={delta} from={from}/>;})()
          }
          {(()=>{const{delta,from}=d48("pendingOrFailed");return<SnapCard label="Pending Blobs" value={fmtN(cur.pendingOrFailed)} color="#fbbf24" delta={delta} from={from}/>;})()}
          {(()=>{const{delta,from}=d48("deletedBlobs");return<SnapCard label="Deleted Blobs" value={fmtN(cur.deletedBlobs)} color="#f87171" delta={delta} from={from}/>;})()}
        </div>
      </Sec>

      {/* Blob Analytics */}
      <Sec title="Blob Analytics" sub="Blob count and activity over time" right={<RangeSel range={range} onChange={r=>{setRange(r);setPg(0);fetchTs(network,r);}}/>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <Card title="Active Blobs" sub={`${range} window`} latest={fmtN(cur.activeBlobs)} color="#22c55e">
            <Chart series={[{data:cd.map(p=>num(p.activeBlobs)),color:"#22c55e",name:"Active",fmt:fmtN}]} labels={labels} height={140}/>
          </Card>
          {isTestnet
            ? <Card title="Storage Providers" sub="Active on testnet" latest={fmtN(cur.storageProviders)} color="#0891b2">
                <Chart series={[{data:cd.map(p=>num(p.storageProviders??0)),color:"#0891b2",name:"SPs",fmt:fmtN}]} labels={labels} height={140}/>
              </Card>
            : <Card title="Blob Events" sub="blob_activities_aggregate count" latest={fmtN(cur.totalBlobEvents)} color="#fb923c">
                <Chart series={[{data:cd.map(p=>num(p.totalBlobEvents)),color:"#fb923c",name:"Events",fmt:fmtN}]} labels={labels} height={140}/>
              </Card>
          }
        </div>
        <Card title="Pending & Deleted Blobs" sub="Anomaly tracking · auto-scaled per series">
          <Chart perScale series={[
            {data:cd.map(p=>num(p.pendingOrFailed)),color:"#fbbf24",name:"Pending",fmt:fmtN},
            {data:cd.map(p=>num(p.deletedBlobs)),   color:"#f87171",name:"Deleted",fmt:fmtN},
          ]} labels={labels} height={120}/>
        </Card>
      </Sec>

      {/* Storage Analytics */}
      <Sec title="Storage Analytics" sub="Capacity, utilization, and blob size">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
          <Card title="Storage Used (GB)" latest={fmtGB(cur.totalStorageGB)} color="#a78bfa">
            <Chart series={[{data:cd.map(p=>num(p.totalStorageGB)),color:"#a78bfa",name:"GB",fmt:v=>`${v.toFixed(2)} GB`}]} labels={labels} height={150}/>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              {label:"Total Storage",val:fmtGB(cur.totalStorageGB),c:"#a78bfa"},
              {label:"Active Blobs",  val:fmtN(cur.activeBlobs),   c:"#22c55e"},
              {label:"Avg Blob Size", val:fmtKB(cur.avgBlobSizeKB),c:accentColor,hint:"totalStorage / activeBlobs"},
            ].map(({label,val,c,hint}:any)=>(
              <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px",flex:1}}>
                <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
                <div style={{fontSize:18,fontWeight:800,color:c,fontFamily:"monospace"}}>{val}</div>
                {hint&&<div style={{fontSize:9,color:"var(--text-dim)",marginTop:2}}>{hint}</div>}
              </div>
            ))}
          </div>
        </div>
        <Card title="Avg Blob Size over Time" sub="totalStorageBytes / activeBlobs" latest={fmtKB(cur.avgBlobSizeKB)} color={accentColor}>
          <Chart series={[{data:cd.map(p=>num(p.avgBlobSizeKB??0)),color:accentColor,name:"Avg Size",fmt:v=>fmtKB(v)}]} labels={labels} height={130}/>
        </Card>
      </Sec>

      {/* Block Performance */}
      <Sec title="Block Performance" sub="Block height progression">
        <Card title="Block Height" latest={cur.blockHeight?`#${cur.blockHeight.toLocaleString("en-US")}`:"—"} color={accentColor}>
          <Chart series={[{data:cd.map(p=>num(p.blockHeight)).filter(v=>v>0),color:accentColor,name:"Block",fmt:v=>`#${Math.round(v).toLocaleString("en-US")}`}]} labels={labels} height={130}/>
        </Card>
      </Sec>

      {/* Benchmark Analytics */}
      <Sec title="Benchmark Analytics" sub={isTestnet?"Benchmarks run on Shelbynet only":`${allBench.length} total runs · all time`}>
        {isTestnet ? (
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center",color:"var(--text-muted)"}}>
            <div style={{fontSize:24,marginBottom:10}}>🔬</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>Benchmarks run on Shelbynet only</div>
            <div style={{fontSize:13,color:"var(--text-dim)"}}>Switch to Shelbynet to view global run history and performance data</div>
          </div>
        ) : benchLoading ? (
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center"}}>
            <div style={{width:24,height:24,borderRadius:"50%",border:"2px solid var(--border)",borderTopColor:"var(--accent)",animation:"spin 1s linear infinite",margin:"0 auto 12px"}}/>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{color:"var(--text-muted)",fontSize:13}}>Loading…</div>
          </div>
        ) : allBench.length === 0 ? (
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center",color:"var(--text-muted)"}}>
            <div style={{fontSize:28,marginBottom:10}}>📊</div><div style={{fontSize:14}}>No benchmark runs yet</div>
          </div>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
              {[{label:"Avg Score",value:String(Math.round(avgScore)),color:"#818cf8"},{label:"Avg Upload",value:fmtKbs(avgUpload),color:accentColor},{label:"Avg Latency",value:fmtMs(avgLatency),color:"#c084fc"},{label:"Avg TX Confirm",value:fmtMs(avgTxConf),color:"#fb923c"}].map(({label,value,color})=>(
                <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
                  <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:800,color,fontFamily:"monospace"}}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              <Card title="Score History" sub="All users · all time" latest={String(allBench[0]?.score??"")} color="#818cf8"><Chart series={[{data:benchChron.map(h=>num(h.score)),color:"#818cf8",name:"Score",fmt:v=>`${Math.round(v)}/1000`}]} labels={bLabels} height={130}/></Card>
              <Card title="Avg Upload Speed" latest={fmtKbs(avgUpload)} color={accentColor}><Chart series={[{data:benchChron.map(h=>num(h.avgUploadKbs)),color:accentColor,name:"Upload",fmt:v=>fmtKbs(v)}]} labels={bLabels} height={130}/></Card>
              <Card title="Avg Latency" sub="Node ping" latest={fmtMs(avgLatency)} color="#c084fc"><Chart series={[{data:benchChron.map(h=>num(h.latencyAvg)),color:"#c084fc",name:"Latency",fmt:v=>fmtMs(v)}]} labels={bLabels} height={130}/></Card>
              <Card title="TX Confirm Time" sub="Aptos transaction confirmation" latest={fmtMs(avgTxConf)} color="#fb923c"><Chart series={[{data:benchChron.map(h=>num(h.txConfirmMs)),color:"#fb923c",name:"TX Confirm",fmt:v=>fmtMs(v)}]} labels={bLabels} height={130}/></Card>
            </div>
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"13px 18px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div><div style={{fontSize:14,fontWeight:700,color:"var(--text-primary)"}}>Global Run History</div><div style={{fontSize:12,color:"var(--text-muted)"}}>{allBench.length} runs · Page {pg+1}/{Math.max(1,Math.ceil(allBench.length/PG))}</div></div>
                <button onClick={fetchBench} style={{padding:"4px 11px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:"pointer",fontSize:12}}>⟳</button>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{background:"var(--bg-card2)"}}>{["Device","Time","Score","Tier","Upload","Download","Latency","TX Confirm","Mode"].map(h=><th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:10,fontWeight:600,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>)}</tr></thead>
                  <tbody>{pagedBench.map((h,i)=>{const sc=num(h.score),c=sc>=900?"#22c55e":sc>=600?"#fbbf24":"#f87171",ts_=h.ts?new Date(h.ts).toLocaleString([],{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";return<tr key={h.id||String(i)} style={{borderTop:"1px solid var(--border-soft)"}}><td style={{padding:"8px 13px"}}><DeviceBadge h={h}/></td><td style={{padding:"8px 13px",fontSize:11,color:"var(--text-dim)",fontFamily:"monospace",whiteSpace:"nowrap"}}>{ts_}</td><td style={{padding:"8px 13px"}}><span style={{fontFamily:"monospace",fontWeight:800,color:c,fontSize:14}}>{sc||"—"}</span></td><td style={{padding:"8px 13px"}}><span style={{fontSize:11,color:c,fontWeight:600}}>{h.tier}</span></td><td style={{padding:"8px 13px",fontFamily:"monospace",color:accentColor,whiteSpace:"nowrap"}}>{fmtKbs(h.avgUploadKbs)}</td><td style={{padding:"8px 13px",fontFamily:"monospace",color:"#22c55e",whiteSpace:"nowrap"}}>{fmtKbs(h.avgDownloadKbs)}</td><td style={{padding:"8px 13px",fontFamily:"monospace",color:"#c084fc",whiteSpace:"nowrap"}}>{fmtMs(h.latencyAvg)}</td><td style={{padding:"8px 13px",fontFamily:"monospace",color:"#fb923c",whiteSpace:"nowrap"}}>{fmtMs(h.txConfirmMs)}</td><td style={{padding:"8px 13px"}}><span style={{fontSize:10,fontWeight:700,color:"#818cf8",textTransform:"uppercase"}}>{h.mode}</span></td></tr>;})}
                  </tbody>
                </table>
              </div>
              <div style={{padding:"8px 18px",borderTop:"1px solid var(--border-soft)"}}><Pager total={allBench.length} page={pg} per={PG} set={setPg}/></div>
            </div>
          </>
        )}
      </Sec>
    </div>
  );
}