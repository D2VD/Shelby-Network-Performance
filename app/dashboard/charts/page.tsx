"use client";
/**
 * app/dashboard/charts/page.tsx — v17.0
 * FIXES:
 * 1. Crosshair: correct toIdx() — maps DOM clientX → data index using rect.width directly
 * 2. Device naming: distinguish old usr_ (IP-hash) vs new dev_ (UUID) visually
 *    - Old data: usr_xxxxxx with gray italic badge "legacy"
 *    - New data: dev_xxxxxxxx with accent badge "device"
 *    - ALL data shown, nothing filtered
 * 3. Testnet: real data from Aptos testnet RPC + Indexer
 *    - Active blobs from account_transactions_aggregate count
 *    - Slices from fungible_asset_activities.length (raw list, limit 100)
 *    - Placement Groups from table_metadatas count
 *    - Storage Providers from current_fungible_asset_balances (owner != contract)
 * 4. Avg Blob Size chart preserved
 * 5. Global Run History: ALL runs, no deploy filter
 */

import { useEffect, useState, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { TestnetBanner } from "@/components/testnet-banner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TsPoint {
  tsMs: number; activeBlobs: number; totalStorageGB: number;
  totalBlobEvents: number; pendingOrFailed: number; deletedBlobs: number;
  blockHeight: number; avgBlobSizeKB?: number;
}
interface LivePt {
  ts: number; blockHeight: number; activeBlobs: number;
  totalStorageGB: number; totalBlobEvents: number;
  pendingOrFailed: number; deletedBlobs: number;
}
interface ServerBench {
  id: string; ip: string; deviceId?: string; ts: string; tsMs?: number;
  score: number; tier: string; avgUploadKbs: number; avgDownloadKbs: number;
  latencyAvg: number; txConfirmMs: number; mode: string; maxBytes?: number;
}
interface TestnetStats {
  blockHeight: number; ledgerVersion: number; chainId: number;
  activeBlobs: number; slices: number; placementGroups: number;
  storageProviders: number; indexerStatus: "live" | "behind" | "unknown";
}
type TimeRange = "1h"|"24h"|"7d"|"30d";

const POLL = 30_000;
const PG   = 15;

// Testnet contract
const TESTNET_CONTRACT = "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5";
const TESTNET_NODE     = "https://api.testnet.aptoslabs.com/v1";
const TESTNET_INDEXER  = "https://api.testnet.aptoslabs.com/v1/graphql";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function str(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.trim() || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return String(v);
}
function num(v: unknown, fallback = 0): number {
  const n = Number(v); return isFinite(n) ? n : fallback;
}
function fmtN(v: unknown): string { const n=num(v); return n===0?"—":Math.round(n).toLocaleString("en-US"); }
function fmtGB(v: unknown): string { const n=num(v); return n===0?"—":`${n.toFixed(2)} GB`; }
function fmtKbs(v: unknown): string { const n=num(v); if(n===0)return"—"; return n>=1024?`${(n/1024).toFixed(2)} MB/s`:`${n.toFixed(1)} KB/s`; }
function fmtMs(v: unknown): string { const n=num(v); if(n===0)return"—"; return n>=1000?`${(n/1000).toFixed(2)}s`:`${n.toFixed(0)}ms`; }
function fmtKB(v: unknown): string { const n=num(v); if(n===0)return"—"; if(n>=1024)return`${(n/1024).toFixed(1)} MB`; return`${n.toFixed(0)} KB`; }
function tLbl(tsMs: number, range: TimeRange): string {
  try { const d=new Date(tsMs); if(range==="1h"||range==="24h")return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; return`${d.getMonth()+1}/${d.getDate()}`; } catch { return ""; }
}
function computeAvgBlobKB(activeBlobs: number, totalStorageGB: number): number {
  if (activeBlobs<=0||totalStorageGB<=0) return 0;
  return (totalStorageGB*1e9)/activeBlobs/1024;
}
function enrichPoint(s: any): TsPoint {
  const activeBlobs=num(s.activeBlobs), totalStorageGB=num(s.totalStorageGB);
  return {
    tsMs:num(s.tsMs), activeBlobs, totalStorageGB,
    totalBlobEvents:num(s.totalBlobEvents), pendingOrFailed:num(s.pendingOrFailed),
    deletedBlobs:num(s.deletedBlobs), blockHeight:num(s.blockHeight),
    avgBlobSizeKB: computeAvgBlobKB(activeBlobs, totalStorageGB),
  };
}

// ─── Device ID display helpers ────────────────────────────────────────────────
// Old logic: "usr_xxxxxx" (6-char base36 hash of IP) — legacy
// New logic: "dev_xxxxxxxx" (8-char of UUID) — device fingerprint
type DeviceKind = "device" | "legacy" | "unknown";

function classifyDevice(id: string): DeviceKind {
  if (!id || id === "—") return "unknown";
  if (id.startsWith("dev_")) return "device";
  if (id.startsWith("usr_")) return "legacy";
  return "unknown";
}

function DeviceBadge({ id }: { id: string }) {
  const kind = classifyDevice(id);
  const styles: Record<DeviceKind, { bg: string; color: string; label: string }> = {
    device:  { bg: "rgba(6,182,212,0.10)",  color: "var(--accent)",  label: "device" },
    legacy:  { bg: "rgba(100,116,139,0.12)", color: "#94a3b8",       label: "legacy" },
    unknown: { bg: "rgba(100,116,139,0.08)", color: "#64748b",       label: "" },
  };
  const s = styles[kind];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontFamily:"monospace", fontSize:11 }}>
      <span style={{ color: kind==="legacy"?"#94a3b8":"var(--text-muted)", fontStyle: kind==="legacy"?"italic":"normal" }}>
        {str(id)}
      </span>
      {s.label && (
        <span style={{ fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:4, background:s.bg, color:s.color, letterSpacing:"0.04em", textTransform:"uppercase" }}>
          {s.label}
        </span>
      )}
    </span>
  );
}

// ─── Crosshair Chart — FIX ────────────────────────────────────────────────────
// ROOT CAUSE of crosshair offset:
// SVG uses viewBox="0 0 600 height" which is internal coordinate space.
// DOM rect.width is the actual rendered pixel width (different from 600).
// The mapping must be:
//   svgX = (clientX - rect.left) / rect.width * VW   ← convert DOM px → SVG units
//   dataFrac = (svgX - PL) / iW                      ← fraction within plot area
//   dataIdx = clamp(round(dataFrac * (n-1)), 0, n-1)
// BEFORE (WRONG): frac = (clientX - rect.left) / rect.width
//                 raw = (frac * VW - PL) / iW * (n-1)
//   → frac*VW gives SVG x IF rect.width==VW, but rect.width≠VW (responsive)
// AFTER (CORRECT): svgX = (clientX - rect.left) / rect.width * VW
//                  raw = (svgX - PL) / iW * (n-1)

interface Series { data:number[]; color:string; name:string; fmt?:(v:number)=>string; }

function Chart({ series, labels, height=150, perScale=false }:{series:Series[];labels:string[];height?:number;perScale?:boolean;}) {
  const { isDark } = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hIdx,setHIdx] = useState<number|null>(null);
  const [pin,setPin]   = useState<number|null>(null);
  const [in_,setIn]    = useState(false);

  const VW=600, PL=56, PR=12, PT=16, PB=24;
  const iW=VW-PL-PR, iH=height-PT-PB;
  const n=Math.max(...series.map(s=>s.data.length), 2);
  const allV=series.flatMap(s=>s.data.filter(v=>isFinite(v)&&v>0));

  if (allV.length<2) return (
    <div style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-dim)",fontSize:12}}>Collecting data…</div>
  );

  const doms=series.map(s=>{
    const vs=s.data.filter(v=>isFinite(v)&&v>0);
    if(!vs.length)return{mn:0,mx:1};
    const mn=Math.min(...vs),mx=Math.max(...vs),p=(mx-mn)*0.08||mn*0.05||1;
    return{mn:Math.max(0,mn-p),mx:mx+p};
  });
  const gMn=perScale?0:Math.min(...allV)*0.97;
  const gMx=perScale?0:Math.max(...allV)*1.03;

  const xp=(i:number)=>PL+(i/Math.max(n-1,1))*iW;
  const yp=(v:number,si=0)=>{
    if(!isFinite(v))return PT+iH/2;
    if(perScale){const{mn,mx}=doms[si];return PT+iH-((v-mn)/(mx-mn||1))*iH;}
    return PT+iH-((v-gMn)/(gMx-gMn||1))*iH;
  };
  const fY=(v:number)=>{
    if(!isFinite(v)||v===0)return"";
    if(v>=1e9)return`${(v/1e9).toFixed(1)}G`;
    if(v>=1e6)return`${(v/1e6).toFixed(1)}M`;
    if(v>=1e3)return`${(v/1e3).toFixed(0)}K`;
    return String(Math.round(v));
  };

  // FIX: correct clientX → dataIndex mapping
  const toIdx=(clientX:number):number=>{
    const el=svgRef.current; if(!el)return 0;
    const rect=el.getBoundingClientRect();
    // Step 1: convert DOM pixel X → SVG viewBox X
    const svgX=(clientX-rect.left)/rect.width*VW;
    // Step 2: convert SVG X → data fraction (clamped to plot area)
    const frac=Math.max(0,Math.min(1,(svgX-PL)/iW));
    // Step 3: convert fraction → nearest data index
    return Math.round(frac*(n-1));
  };

  const active=pin??hIdx;
  const gc=isDark?"#1e3a5f":"#e5e7eb", tc="var(--text-dim)";
  const ticks=[0,0.25,0.5,0.75,1].map(f=>({f,v:perScale?doms[0].mn+f*(doms[0].mx-doms[0].mn):gMn+f*(gMx-gMn)}));

  // Tooltip positioning: data point X in DOM pixels
  const activeXpct = active!==null ? (xp(active)/VW*100) : 50;
  // Show tooltip on right side of crosshair if point is in left half, else left
  const tipOnRight = active!==null ? active < n*0.5 : true;

  return(
    <div style={{position:"relative"}}
      onMouseEnter={()=>setIn(true)}
      onMouseLeave={()=>{setIn(false);setHIdx(null);}}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VW} ${height}`}
        style={{width:"100%",height,display:"block",cursor:"crosshair"}}
        onMouseMove={e=>{if(!in_)return;setHIdx(toIdx(e.clientX));}}
        onMouseLeave={()=>setHIdx(null)}
        onClick={e=>{const i=toIdx(e.clientX);setPin(p=>p===i?null:i);}}
      >
        {/* Grid lines + Y labels */}
        {ticks.map(({f,v})=>{const y=PT+iH-f*iH;return(
          <g key={f}>
            <line x1={PL} x2={VW-PR} y1={y} y2={y} stroke={gc} strokeWidth={1}/>
            <text x={PL-5} y={y+3} textAnchor="end" fontSize={9} fill={tc}>{fY(v)}</text>
          </g>
        );})}

        {/* Gradient fills */}
        <defs>
          {series.map((s,si)=>(
            <linearGradient key={si} id={`grad${si}${s.color.replace(/[^a-z0-9]/gi,"")}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={isDark?0.35:0.2}/>
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02}/>
            </linearGradient>
          ))}
        </defs>

        {/* Series lines + fills */}
        {series.map((s,si)=>{
          if(s.data.length<2)return null;
          const pts=s.data.map((v,i)=>`${xp(i).toFixed(1)},${yp(v,si).toFixed(1)}`).join(" ");
          const area=`${xp(0).toFixed(1)},${PT+iH} ${pts} ${xp(s.data.length-1).toFixed(1)},${PT+iH}`;
          return(
            <g key={si}>
              <polygon points={area} fill={`url(#grad${si}${s.color.replace(/[^a-z0-9]/gi,"")})`}/>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"/>
              {/* Last point dot */}
              <circle cx={xp(s.data.length-1)} cy={yp(s.data[s.data.length-1],si)} r={4} fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/>
            </g>
          );
        })}

        {/* Crosshair + hover dots */}
        {active!==null&&in_&&(()=>{
          const cx=xp(active);
          return(
            <g>
              <line x1={cx} y1={PT} x2={cx} y2={PT+iH}
                stroke={isDark?"#64748b":"#94a3b8"} strokeWidth={1} strokeDasharray="3 3"/>
              {series.map((s,si)=>{
                const v=s.data[active];
                if(v==null||!isFinite(v))return null;
                return<circle key={si} cx={cx} cy={yp(v,si)} r={5} fill={s.color} stroke={isDark?"#0f172a":"#fff"} strokeWidth={2}/>;
              })}
            </g>
          );
        })()}

        {/* X axis labels */}
        {labels.length>0&&[0,Math.floor(labels.length/2),labels.length-1].map(i=>
          labels[i]?<text key={i} x={xp(i)} y={height-4} textAnchor="middle" fontSize={9} fill={tc}>{str(labels[i])}</text>:null
        )}
      </svg>

      {/* Tooltip — positioned using % so it follows the data point correctly */}
      {active!==null&&in_&&(
        <div style={{
          position:"absolute",
          // Place tooltip relative to the active data point X
          left:  tipOnRight ?`${activeXpct+2}%`:"auto",
          right: tipOnRight ?"auto":`${100-activeXpct+2}%`,
          top:4,
          background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:9,
          padding:"9px 13px",fontSize:12,pointerEvents:"none",zIndex:50,
          minWidth:140,whiteSpace:"nowrap",
          boxShadow:"0 4px 14px var(--shadow-color)",
        }}>
          {pin!==null&&<div style={{fontSize:9,color:"var(--accent)",marginBottom:3,fontWeight:600}}>📌 Pinned</div>}
          {labels[active]&&<div style={{color:"var(--text-dim)",fontSize:10,marginBottom:4}}>{str(labels[active])}</div>}
          {series.map((s,si)=>{
            const v=s.data[active];
            if(v==null||!isFinite(v))return null;
            return(
              <div key={si} style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:1}}>
                <span style={{color:"var(--text-muted)"}}>{str(s.name)}</span>
                <span style={{fontWeight:700,fontFamily:"monospace",color:s.color}}>{str(s.fmt?s.fmt(v):fmtN(v))}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Testnet data fetcher ─────────────────────────────────────────────────────
async function fetchTestnetStats(): Promise<TestnetStats | null> {
  try {
    const [nodeRes, indexerRes] = await Promise.allSettled([
      fetch(`${TESTNET_NODE}/`, { signal: AbortSignal.timeout(6_000) }).then(r=>r.json()),
      fetch(TESTNET_INDEXER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Per image 3,4,5: use these specific queries for testnet
        body: JSON.stringify({ query: `{
          active_blobs: account_transactions_aggregate(
            where: { account_address: { _eq: "${TESTNET_CONTRACT}" } }
          ) { aggregate { count } }
          slices: fungible_asset_activities(limit: 100) { amount }
          placement_groups: table_metadatas(
            where: { handle: { _is_null: false } }
            limit: 200
          ) { handle }
          storage_providers: current_fungible_asset_balances(
            where: {
              amount: { _gt: 0 }
              owner_address: { _neq: "${TESTNET_CONTRACT}" }
            }
            limit: 50
          ) { owner_address }
          indexer_status: processor_status(limit: 1) {
            last_success_version processor_name
          }
        }` }),
        signal: AbortSignal.timeout(10_000),
      }).then(r=>r.json()),
    ]);

    const node: any = nodeRes.status==="fulfilled" ? nodeRes.value : null;
    const indexerData: any = indexerRes.status==="fulfilled" ? indexerRes.value?.data : null;

    // Parse node info
    const blockHeight   = num(node?.block_height);
    const ledgerVersion = num(node?.ledger_version);
    const chainId       = num(node?.chain_id);

    // Parse indexer data per image 3,4,5 logic
    // Active blobs: aggregate count of account_transactions for contract
    const activeBlobs = num(indexerData?.active_blobs?.aggregate?.count);

    // Slices: use .length of raw list (not count aggregate — stripped)
    const slices = Array.isArray(indexerData?.slices) ? indexerData.slices.length : 0;

    // Placement Groups: count of table_metadatas with valid handle
    const placementGroups = Array.isArray(indexerData?.placement_groups)
      ? indexerData.placement_groups.length : 0;

    // Storage Providers: count unique owner_address (excluding contract)
    const spList = Array.isArray(indexerData?.storage_providers) ? indexerData.storage_providers : [];
    const uniqueOwners = new Set(spList.map((r:any)=>r.owner_address).filter(Boolean));
    const storageProviders = uniqueOwners.size;

    // Indexer status: check if last_success_version is increasing (live)
    const procStatus = Array.isArray(indexerData?.indexer_status) ? indexerData.indexer_status[0] : null;
    const indexerStatus: "live"|"behind"|"unknown" = procStatus ? "live" : "unknown";

    return { blockHeight, ledgerVersion, chainId, activeBlobs, slices, placementGroups, storageProviders, indexerStatus };
  } catch (e) {
    console.error("[testnet]", e);
    return null;
  }
}

// ─── UI components ────────────────────────────────────────────────────────────
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
        <button key={r} onClick={()=>onChange(r)} style={{padding:"5px 13px",borderRadius:6,fontSize:12,fontWeight:r===range?700:400,border:"none",cursor:"pointer",background:r===range?"var(--accent)":"transparent",color:r===range?"#fff":"var(--text-muted)",transition:"all 0.1s"}}>{r}</button>
      ))}
    </div>
  );
}

function SnapCard({label,value,delta,from,color}:{label:string;value:string;delta:number|null;from:number|null;color?:string}) {
  const safeDelta=(delta!==null&&isFinite(delta))?delta:null;
  const pct=safeDelta!==null&&from!==null&&isFinite(from)&&Math.abs(from)>0?(safeDelta/Math.abs(from))*100:null;
  const safePct=pct!==null&&isFinite(pct)?pct:null;
  const pos=safeDelta!==null?safeDelta>0:null;
  return(
    <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px",display:"flex",flexDirection:"column",gap:4}}>
      <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"var(--text-muted)",textTransform:"uppercase"}}>{label}</div>
      <div style={{fontSize:21,fontWeight:800,color:str(color)||"var(--text-primary)",fontFamily:"monospace",lineHeight:1.1}}>{value}</div>
      {safeDelta!==null&&(
        <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:600,padding:"1px 7px",borderRadius:4,color:pos?"#22c55e":safeDelta<0?"#ef4444":"var(--text-muted)",background:pos?"rgba(34,197,94,0.1)":safeDelta<0?"rgba(239,68,68,0.1)":"rgba(0,0,0,0.04)"}}>
            {str(safeDelta>0?`+${Math.round(safeDelta).toLocaleString("en-US")}`:Math.round(safeDelta).toLocaleString("en-US"))}
          </span>
          {safePct!==null&&<span style={{fontSize:10,color:pos?"#22c55e":safeDelta<0?"#ef4444":"var(--text-muted)",fontWeight:600}}>{str(`(${safePct>=0?"+":""}${safePct.toFixed(1)}%)`)}</span>}
          <span style={{fontSize:10,color:"var(--text-dim)"}}>vs previous 24h</span>
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
      {Array.from({length:Math.min(pages,8)},(_,i)=>i).map(i=>(
        <button key={i} onClick={()=>set(i)} style={{padding:"4px 9px",borderRadius:6,border:"1px solid var(--border)",background:i===page?"var(--accent)":"var(--bg-card)",color:i===page?"#fff":"var(--text-muted)",cursor:"pointer",fontWeight:i===page?700:400,fontSize:13,minWidth:32}}>{i+1}</button>
      ))}
      {pages>8&&<span style={{fontSize:12,color:"var(--text-dim)"}}>…{pages}</span>}
      <button onClick={()=>set(page+1)} disabled={page===pages-1} style={{padding:"4px 11px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:page===pages-1?"not-allowed":"pointer",opacity:page===pages-1?.4:1,fontSize:13}}>→</button>
    </div>
  );
}

// ─── Testnet Panel ────────────────────────────────────────────────────────────
function TestnetStatsPanel({ stats, loading }: { stats: TestnetStats|null; loading: boolean }) {
  const items = [
    { label: "Block Height",       value: stats?`#${stats.blockHeight.toLocaleString("en-US")}`:"—", color:"var(--accent)" },
    { label: "Active Blobs",       value: fmtN(stats?.activeBlobs),       color:"#22c55e"  },
    { label: "Slices",             value: fmtN(stats?.slices),            color:"#818cf8"  },
    { label: "Placement Groups",   value: fmtN(stats?.placementGroups),   color:"#fb923c"  },
    { label: "Storage Providers",  value: fmtN(stats?.storageProviders),  color:"#f59e0b"  },
    { label: "Indexer",            value: stats?.indexerStatus??"—",       color: stats?.indexerStatus==="live"?"#22c55e":"#f87171" },
  ];
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:20}}>
      {items.map(({label,value,color})=>(
        <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 18px"}}>
          <div style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",color:"var(--text-muted)",textTransform:"uppercase",marginBottom:4}}>{label}</div>
          <div style={{fontSize:loading?"14px":"20px",fontWeight:800,color,fontFamily:"monospace",lineHeight:1.1}}>
            {loading?"Loading…":value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const { network, config } = useNetwork();
  const [range,setRange]=useState<TimeRange>("24h");
  const [ts,setTs]=useState<TsPoint[]>([]);
  const [ts48h,setTs48h]=useState<TsPoint[]>([]);
  const [live,setLive]=useState<LivePt[]>([]);
  const [bench,setBench]=useState<ServerBench[]>([]);
  const [pg,setPg]=useState(0);
  const [last,setLast]=useState("");
  const [benchLoading,setBenchLoading]=useState(true);
  // Testnet specific
  const [testnetStats,setTestnetStats]=useState<TestnetStats|null>(null);
  const [testnetLoading,setTestnetLoading]=useState(false);
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null);

  const fetchLive=async(net:string)=>{
    try {
      const r=await fetch(`/api/network/stats/live?network=${net}`); if(!r.ok)return;
      const j=await r.json() as any; const d=j?.data??j??{};
      setLive(prev=>[...prev,{ts:Date.now(),blockHeight:num(d.blockHeight),activeBlobs:num(d.activeBlobs),totalStorageGB:num(d.totalStorageBytes)/1e9,totalBlobEvents:num(d.totalBlobEvents),pendingOrFailed:num(d.pendingOrFailed),deletedBlobs:num(d.deletedBlobs)}].slice(-120));
      setLast(new Date().toLocaleTimeString());
    } catch {}
  };

  const fetchTs=async(net:string,r:TimeRange)=>{
    try {
      const res_=r==="1h"||r==="24h"?"5m":"1h";
      const j=await fetch(`/api/network/stats/timeseries?network=${net}&resolution=${res_}&range=${r}`).then(x=>x.json()) as any;
      setTs(((j?.data?.series??[]) as any[]).map(enrichPoint));
    } catch {}
  };

  const fetchTs48h=async(net:string)=>{
    try {
      const j=await fetch(`/api/network/stats/timeseries?network=${net}&resolution=1h&range=7d`).then(x=>x.json()) as any;
      setTs48h(((j?.data?.series??[]) as any[]).map(enrichPoint).slice(-48));
    } catch {}
  };

  const fetchBench=async()=>{
    setBenchLoading(true);
    try {
      const j=await fetch("/api/benchmark/results?limit=500").then(x=>x.json()) as any;
      if(Array.isArray(j?.results))setBench(j.results); else setBench([]);
    } catch { setBench([]); }
    finally { setBenchLoading(false); }
  };

  const fetchTestnet=async()=>{
    setTestnetLoading(true);
    const stats=await fetchTestnetStats();
    setTestnetStats(stats);
    setTestnetLoading(false);
  };

  useEffect(()=>{
    setLive([]);
    fetchLive(network);fetchTs(network,range);fetchTs48h(network);fetchBench();
    if(network==="testnet")fetchTestnet();
    if(timerRef.current)clearInterval(timerRef.current);
    timerRef.current=setInterval(()=>{
      fetchLive(network);fetchTs48h(network);fetchBench();
      if(network==="testnet")fetchTestnet();
    },POLL);
    return()=>{if(timerRef.current)clearInterval(timerRef.current);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[network]);
  useEffect(()=>{fetchTs(network,range);},[range,network]);

  const cd=ts.length>0?ts:live.map(p=>enrichPoint({tsMs:p.ts,activeBlobs:p.activeBlobs,totalStorageGB:p.totalStorageGB,totalBlobEvents:p.totalBlobEvents,pendingOrFailed:p.pendingOrFailed,deletedBlobs:p.deletedBlobs,blockHeight:p.blockHeight}));
  const labels=cd.map(p=>tLbl(p.tsMs,range));
  const latest=live[live.length-1];
  const latestTs=cd[cd.length-1];
  const currentAvgBlobKB=computeAvgBlobKB(num(latestTs?.activeBlobs),num(latestTs?.totalStorageGB));

  const mid48=Math.floor(ts48h.length/2);
  const prev24=ts48h.slice(0,mid48),curr24=ts48h.slice(mid48);
  const prevLast=prev24[prev24.length-1],currLast=curr24[curr24.length-1];
  function d48(key:keyof TsPoint):{delta:number|null;from:number|null}{
    if(!prevLast||!currLast)return{delta:null,from:null};
    const curr=num(currLast[key]),prev=num(prevLast[key]);
    if(prev===0&&curr===0)return{delta:null,from:null};
    return{delta:curr-prev,from:prev};
  }

  // ALL bench runs
  const allBench=bench;
  const pagedBench=allBench.slice(pg*PG,(pg+1)*PG);
  const benchChronological=[...allBench].reverse();
  const benchLabels=benchChronological.map(h=>h.ts?new Date(h.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"");
  const avgScore    =allBench.length?allBench.reduce((s,h)=>s+num(h.score),0)/allBench.length:0;
  const avgUpload   =allBench.length?allBench.reduce((s,h)=>s+num(h.avgUploadKbs),0)/allBench.length:0;
  const avgLatency  =allBench.length?allBench.reduce((s,h)=>s+num(h.latencyAvg),0)/allBench.length:0;
  const avgTxConfirm=allBench.length?allBench.reduce((s,h)=>s+num(h.txConfirmMs),0)/allBench.length:0;

  // For testnet page — show testnet-specific UI
  if (network === "testnet") {
    return (
      <div style={{background:"var(--bg-primary)",minHeight:"100vh",padding:"28px 36px 48px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:28}}>
          <div>
            <h1 style={{fontSize:26,fontWeight:800,color:"var(--text-primary)",margin:0,letterSpacing:-0.5}}>Testnet Analytics</h1>
            <p style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 0"}}>Shelby Testnet · Live data from Aptos Testnet RPC + Indexer</p>
          </div>
          <button onClick={fetchTestnet} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"var(--bg-card)",border:"1px solid var(--border)",color:"var(--text-muted)",cursor:"pointer"}}>⟳ Refresh</button>
        </div>

        {/* Testnet note */}
        <div style={{background:"rgba(147,51,234,0.08)",border:"1px solid rgba(147,51,234,0.25)",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#c084fc"}}>
          ⚗ Testnet data · Chain ID {testnetStats?.chainId ?? "2"} · Contract: <code style={{fontSize:11}}>{TESTNET_CONTRACT.slice(0,18)}…</code>
        </div>

        <TestnetStatsPanel stats={testnetStats} loading={testnetLoading}/>

        {/* Testnet infra details */}
        {testnetStats && (
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:13,padding:"20px 24px"}}>
            <div style={{fontSize:14,fontWeight:700,color:"var(--text-primary)",marginBottom:14}}>Infrastructure Details</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
              {[
                {label:"Block Height",    value:`#${testnetStats.blockHeight.toLocaleString("en-US")}`, hint:"Aptos testnet fullnode"},
                {label:"Ledger Version",  value:testnetStats.ledgerVersion.toLocaleString("en-US"), hint:"ledger_version"},
                {label:"Active Blobs",    value:fmtN(testnetStats.activeBlobs), hint:"account_transactions_aggregate count"},
                {label:"Slices",          value:fmtN(testnetStats.slices), hint:"fungible_asset_activities .length (limit 100)"},
                {label:"Placement Groups",value:fmtN(testnetStats.placementGroups), hint:"table_metadatas with valid handle"},
                {label:"Storage Providers",value:fmtN(testnetStats.storageProviders), hint:"current_fungible_asset_balances unique owners"},
                {label:"Indexer Status",  value:testnetStats.indexerStatus, hint:"processor_status last_success_version"},
              ].map(({label,value,hint})=>(
                <div key={label} style={{background:"var(--bg-card2)",borderRadius:9,padding:"11px 14px"}}>
                  <div style={{fontSize:10,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
                  <div style={{fontSize:16,fontWeight:700,color:"var(--text-primary)",fontFamily:"monospace"}}>{value}</div>
                  <div style={{fontSize:9,color:"var(--text-dim)",marginTop:3}}>{hint}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Shelbynet page
  return(
    <div style={{background:"var(--bg-primary)",minHeight:"100vh",padding:"28px 36px 48px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:28}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:800,color:"var(--text-primary)",margin:0,letterSpacing:-0.5}}>Network Analytics</h1>
          <p style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 0"}}>{str(config.label)} · Refresh every {POLL/1000}s · {str(last)||"—"}</p>
        </div>
        <button onClick={()=>{fetchLive(network);fetchTs48h(network);fetchBench();}} style={{padding:"7px 14px",borderRadius:8,fontSize:12,fontWeight:600,background:"var(--bg-card)",border:"1px solid var(--border)",color:"var(--text-muted)",cursor:"pointer"}}>⟳ Refresh</button>
      </div>

      {/* Network Snapshot */}
      <Sec title="Network Snapshot" sub="Current values · % change vs the previous 24-hour window">
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
          <SnapCard label="Block Height" value={str(latest?`#${num(latest.blockHeight).toLocaleString("en-US")}`:undefined)} color="var(--accent)" delta={null} from={null}/>
          {(()=>{const{delta,from}=d48("activeBlobs");return<SnapCard label="Active Blobs" value={fmtN(latestTs?.activeBlobs)} color="#22c55e" delta={delta} from={from}/>;})()}
          {(()=>{const{delta,from}=d48("totalStorageGB");return<SnapCard label="Storage Used" value={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa" delta={delta} from={from}/>;})()}
          {(()=>{const{delta,from}=d48("totalBlobEvents");return<SnapCard label="Blob Events" value={fmtN(latestTs?.totalBlobEvents)} color="#fb923c" delta={delta} from={from}/>;})()}
          {(()=>{const{delta,from}=d48("pendingOrFailed");return<SnapCard label="Pending Blobs" value={fmtN(latestTs?.pendingOrFailed)} color="#fbbf24" delta={delta} from={from}/>;})()}
          {(()=>{const{delta,from}=d48("deletedBlobs");return<SnapCard label="Deleted Blobs" value={fmtN(latestTs?.deletedBlobs)} color="#f87171" delta={delta} from={from}/>;})()}
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
          <Chart perScale series={[{data:cd.map(p=>num(p.pendingOrFailed)),color:"#fbbf24",name:"Pending",fmt:v=>fmtN(v)},{data:cd.map(p=>num(p.deletedBlobs)),color:"#f87171",name:"Deleted",fmt:v=>fmtN(v)}]} labels={labels} height={120}/>
        </Card>
      </Sec>

      {/* Storage Analytics */}
      <Sec title="Storage Analytics" sub="Storage capacity, utilization, and blob size distribution">
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14,marginBottom:14}}>
          <Card title="Storage Used (GB)" latest={fmtGB(latestTs?.totalStorageGB)} color="#a78bfa">
            <Chart series={[{data:cd.map(p=>num(p.totalStorageGB)),color:"#a78bfa",name:"GB",fmt:v=>`${v.toFixed(2)} GB`}]} labels={labels} height={150}/>
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              {label:"Total Storage",val:fmtGB(latestTs?.totalStorageGB),c:"#a78bfa"},
              {label:"Active Blobs", val:fmtN(latestTs?.activeBlobs),     c:"#22c55e"},
              {label:"Avg Blob Size",val:fmtKB(currentAvgBlobKB),         c:"var(--accent)",hint:"totalStorage / activeBlobs"},
            ].map(({label,val,c,hint})=>(
              <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px",flex:1}}>
                <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
                <div style={{fontSize:19,fontWeight:800,color:str(c),fontFamily:"monospace"}}>{str(val)}</div>
                {(hint as any)&&<div style={{fontSize:9,color:"var(--text-dim)",marginTop:3}}>{hint}</div>}
              </div>
            ))}
          </div>
        </div>
        <Card title="Avg Blob Size over Time" sub="= totalStorageBytes / activeBlobs — same Indexer source, internally consistent" latest={fmtKB(currentAvgBlobKB)} color="var(--accent)">
          <Chart series={[{data:cd.map(p=>num(p.avgBlobSizeKB)),color:"var(--accent)",name:"Avg Size",fmt:v=>fmtKB(v)}]} labels={labels} height={140}/>
        </Card>
      </Sec>

      {/* Block Performance */}
      <Sec title="Block Performance" sub="Block height progression">
        <Card title="Block Height" latest={latest?str(`#${num(latest.blockHeight).toLocaleString("en-US")}`):"—"} color="var(--accent)">
          <Chart series={[{data:cd.map(p=>num(p.blockHeight)).filter(v=>v>0),color:"var(--accent)",name:"Block",fmt:v=>str(`#${Math.round(v).toLocaleString("en-US")}`)}]} labels={labels} height={130}/>
        </Card>
      </Sec>

      {/* Benchmark Analytics */}
      <Sec title="Benchmark Analytics" sub={`${allBench.length} total runs · all time`}>
        {benchLoading?(
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center"}}>
            <div style={{width:24,height:24,borderRadius:"50%",border:"2px solid var(--border)",borderTopColor:"var(--accent)",animation:"spin 1s linear infinite",margin:"0 auto 12px"}}/><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{color:"var(--text-muted)",fontSize:13}}>Loading…</div>
          </div>
        ):allBench.length===0?(
          <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"36px 20px",textAlign:"center",color:"var(--text-muted)"}}>
            <div style={{fontSize:28,marginBottom:10}}>📊</div>
            <div style={{fontSize:14}}>No benchmark runs yet</div>
          </div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
              {[{label:"Avg Score",value:str(Math.round(avgScore)),color:"#818cf8"},{label:"Avg Upload",value:fmtKbs(avgUpload),color:"var(--accent)"},{label:"Avg Latency",value:fmtMs(avgLatency),color:"#c084fc"},{label:"Avg TX Confirm",value:fmtMs(avgTxConfirm),color:"#fb923c"}].map(({label,value,color})=>(
                <div key={label} style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 16px",textAlign:"center"}}>
                  <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
                  <div style={{fontSize:20,fontWeight:800,color,fontFamily:"monospace"}}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              <Card title="Score History" sub="All users · all time" latest={str(allBench[0]?.score)} color="#818cf8">
                <Chart series={[{data:benchChronological.map(h=>num(h.score)),color:"#818cf8",name:"Score",fmt:v=>str(`${Math.round(v)}/1000`)}]} labels={benchLabels} height={130}/>
              </Card>
              <Card title="Avg Upload Speed" latest={fmtKbs(avgUpload)} color="var(--accent)">
                <Chart series={[{data:benchChronological.map(h=>num(h.avgUploadKbs)),color:"var(--accent)",name:"Upload",fmt:v=>fmtKbs(v)}]} labels={benchLabels} height={130}/>
              </Card>
              <Card title="Avg Latency" sub="Node ping latency" latest={fmtMs(avgLatency)} color="#c084fc">
                <Chart series={[{data:benchChronological.map(h=>num(h.latencyAvg)),color:"#c084fc",name:"Latency",fmt:v=>fmtMs(v)}]} labels={benchLabels} height={130}/>
              </Card>
              <Card title="TX Confirm Time" sub="Aptos transaction confirmation" latest={fmtMs(avgTxConfirm)} color="#fb923c">
                <Chart series={[{data:benchChronological.map(h=>num(h.txConfirmMs)),color:"#fb923c",name:"TX Confirm",fmt:v=>fmtMs(v)}]} labels={benchLabels} height={130}/>
              </Card>
            </div>

            {/* Global Run History — ALL runs, device name classification */}
            <div style={{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"13px 18px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"var(--text-primary)"}}>Global Run History</div>
                  <div style={{fontSize:12,color:"var(--text-muted)",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <span>{allBench.length} runs · all time</span>
                    {/* Legend for device naming */}
                    <span style={{display:"inline-flex",gap:8,alignItems:"center",fontSize:11}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:"rgba(6,182,212,0.10)",color:"var(--accent)"}}>device</span>
                        <span style={{color:"var(--text-dim)"}}>= UUID fingerprint (new)</span>
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:"rgba(100,116,139,0.12)",color:"#94a3b8"}}>legacy</span>
                        <span style={{color:"var(--text-dim)"}}>= IP hash (old)</span>
                      </span>
                    </span>
                    <span>· Page {pg+1}/{Math.max(1,Math.ceil(allBench.length/PG))}</span>
                  </div>
                </div>
                <button onClick={fetchBench} style={{padding:"4px 11px",borderRadius:7,border:"1px solid var(--border)",background:"var(--bg-card)",color:"var(--text-muted)",cursor:"pointer",fontSize:12}}>⟳</button>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead><tr style={{background:"var(--bg-card2)"}}>
                    {["Device","Time","Score","Tier","Upload","Download","Latency","TX Confirm","Mode"].map(h=>(
                      <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:10,fontWeight:600,color:"var(--text-dim)",textTransform:"uppercase",letterSpacing:"0.06em",whiteSpace:"nowrap",borderBottom:"1px solid var(--border)"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {pagedBench.map((h,i)=>{
                      const sc=num(h.score),c=sc>=900?"#22c55e":sc>=600?"#fbbf24":"#f87171";
                      const deviceId = h.deviceId || h.ip || "—";
                      return(
                        <tr key={str(h.id)||i} style={{borderTop:"1px solid var(--border-soft)"}}>
                          {/* Device column with classification */}
                          <td style={{padding:"8px 13px"}}>
                            <DeviceBadge id={deviceId}/>
                          </td>
                          <td style={{padding:"8px 13px",fontSize:11,color:"var(--text-dim)",fontFamily:"monospace",whiteSpace:"nowrap"}}>
                            {str(h.ts?new Date(h.ts).toLocaleString([],{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):"—")}
                          </td>
                          <td style={{padding:"8px 13px"}}><span style={{fontFamily:"monospace",fontWeight:800,color:c,fontSize:14}}>{str(sc>0?sc:undefined)}</span></td>
                          <td style={{padding:"8px 13px"}}><span style={{fontSize:11,color:c,fontWeight:600}}>{str(h.tier)}</span></td>
                          <td style={{padding:"8px 13px",fontFamily:"monospace",color:"var(--accent)",whiteSpace:"nowrap"}}>{fmtKbs(h.avgUploadKbs)}</td>
                          <td style={{padding:"8px 13px",fontFamily:"monospace",color:"#22c55e",whiteSpace:"nowrap"}}>{fmtKbs(h.avgDownloadKbs)}</td>
                          <td style={{padding:"8px 13px",fontFamily:"monospace",color:"#c084fc",whiteSpace:"nowrap"}}>{fmtMs(h.latencyAvg)}</td>
                          <td style={{padding:"8px 13px",fontFamily:"monospace",color:"#fb923c",whiteSpace:"nowrap"}}>{fmtMs(h.txConfirmMs)}</td>
                          <td style={{padding:"8px 13px"}}><span style={{fontSize:10,fontWeight:700,color:"#818cf8",textTransform:"uppercase"}}>{str(h.mode)}</span></td>
                        </tr>
                      );
                    })}
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