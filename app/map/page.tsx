"use client";
// app/map/page.tsx — v6.0 (Fixed Syntax)

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import type { GlobeMarker, GlobeHandle } from "@/components/ui/globe";

const Globe = dynamic(() => import("@/components/ui/globe"), {
  ssr: false,
  loading: () => <Loader label="Loading globe…" />,
});

const ProviderMap = dynamic(
  () => import("@/components/provider-map").then(m => m.ProviderMap),
  { ssr: false, loading: () => <Loader label="Loading map…" /> }
);

function Loader({ label }: { label: string }) {
  return (
    <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12, background:"#08020e" }}>
      <div style={{ width:32, height:32, borderRadius:"50%", border:"2px solid #2a0a1e", borderTopColor:"#ff77c9", animation:"lspin 1s linear infinite" }}/>
      <style>{`@keyframes lspin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily:"monospace", fontSize:12, color:"#ff77c9" }}>{label}</span>
    </div>
  );
}

function LiveUTCClock() {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const get = () => {
      const d = new Date();
      return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} UTC`;
    };
    setClock(get());
    const id = setInterval(() => setClock(get()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!clock) return null;
  return <span suppressHydrationWarning style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-dim)" }}>{clock}</span>;
}

function providerToMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat, lng = p.geo?.lng;
  if (!lat || !lng) return null;
  const color =
    p.state  === "Leaving"    ? "#f97316" :
    p.state  === "Waitlisted" ? "#a855f7" :
    p.health === "Faulty" || p.health === "Unhealthy" ? "#ef4444" :
    "#ff77c9";
  return { location: [lat, lng], size: p.health === "Healthy" ? 0.07 : 0.05, color, label: p.availabilityZone ?? undefined };
}

type ViewMode = "globe" | "flat";

function SpInfoPanel({ providers, loading }: { providers: StorageProvider[]; loading: boolean }) {
  const healthy    = providers.filter(p => p.health === "Healthy" && p.state !== "Leaving").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const faulty     = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;
  const leaving    = providers.filter(p => p.state  === "Leaving").length;
  const byZone = providers.reduce<Record<string,number>>((acc,p) => { const z=p.availabilityZone||"unknown"; acc[z]=(acc[z]||0)+1; return acc; }, {});
  const topZones = Object.entries(byZone).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const COLORS = ["#ff77c9","#a855f7","#60a5fa","#22c55e","#f59e0b"];

  return (
    <div style={{ position:"absolute", top:16, left:16, zIndex:20, background:"rgba(8,2,14,0.88)", border:"1px solid rgba(255,119,201,0.25)", borderRadius:14, padding:"14px 16px", width:210, backdropFilter:"blur(12px)", boxShadow:"0 4px 24px rgba(0,0,0,0.5)" }}>
      <div style={{ fontFamily:"monospace", fontSize:9, fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,119,201,0.6)", marginBottom:6 }}>Network Providers</div>
      <div style={{ fontFamily:"monospace", fontSize:26, fontWeight:800, color:"#ff77c9", lineHeight:1, marginBottom:10 }}>
        {loading ? "…" : providers.length}
        <span style={{ fontSize:11, fontWeight:500, color:"rgba(255,255,255,0.4)", marginLeft:6 }}>total SPs</span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:10 }}>
        {[
          { label:"Healthy",    count:healthy,    color:"#ff77c9" },
          { label:"Waitlisted", count:waitlisted, color:"#a855f7" },
          { label:"Leaving",    count:leaving,    color:"#f97316" },
          { label:"Faulty",     count:faulty,     color:"#ef4444" },
        ].map(({ label, count, color }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:color, display:"inline-block", boxShadow:`0 0 5px ${color}88` }}/>
              <span style={{ fontFamily:"monospace", fontSize:11, color:"rgba(255,255,255,0.55)" }}>{label}</span>
            </div>
            <span style={{ fontFamily:"monospace", fontSize:12, fontWeight:700, color }}>{loading?"…":count}</span>
          </div>
        ))}
      </div>
      {!loading && providers.length > 0 && (
        <div style={{ height:4, borderRadius:3, overflow:"hidden", display:"flex", gap:1, marginBottom:10 }}>
          <div style={{ flex:healthy,    background:"#ff77c9", minWidth:healthy>0?2:0 }}/>
          <div style={{ flex:waitlisted, background:"#a855f7", minWidth:waitlisted>0?2:0 }}/>
          <div style={{ flex:leaving,    background:"#f97316", minWidth:leaving>0?2:0 }}/>
          <div style={{ flex:faulty,     background:"#ef4444", minWidth:faulty>0?2:0 }}/>
        </div>
      )}
      {topZones.length > 0 && (
        <div>
          <div style={{ fontFamily:"monospace", fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"rgba(255,119,201,0.4)", marginBottom:6 }}>Top Zones</div>
          {topZones.map(([zone,count],i) => (
            <div key={zone} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
              <div style={{ width:6, height:6, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }}/>
              <span style={{ fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.4)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{zone}</span>
              <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.6)" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobeLegendAndZoom({ onZoomIn, onZoomOut, onReset }: {
  onZoomIn: () => void; onZoomOut: () => void; onReset: () => void;
}) {
  const btnStyle = (hover?: boolean): React.CSSProperties => ({
    width:32, height:32, borderRadius:8,
    border:"1px solid rgba(255,119,201,0.3)",
    background: hover ? "rgba(255,119,201,0.18)" : "rgba(8,2,14,0.85)",
    color:"#ff77c9", fontSize:16, cursor:"pointer",
    display:"flex", alignItems:"center", justifyContent:"center",
    backdropFilter:"blur(8px)", transition:"all 0.15s", fontWeight:700,
  });

  return (
    <div style={{ position:"absolute", top:16, right:16, zIndex:20, display:"flex", flexDirection:"column", gap:8, alignItems:"flex-end" }}>
      <div style={{ background:"rgba(8,2,14,0.88)", border:"1px solid rgba(255,119,201,0.2)", borderRadius:10, padding:"10px 14px", backdropFilter:"blur(12px)" }}>
        <div style={{ fontSize:9, fontWeight:700, fontFamily:"monospace", textTransform:"uppercase", letterSpacing:"0.1em", color:"rgba(255,119,201,0.5)", marginBottom:8 }}>Legend</div>
        {[
          { color:"#ff77c9", label:"Healthy" },
          { color:"#a855f7", label:"Waitlisted" },
          { color:"#f97316", label:"Leaving" },
          { color:"#ef4444", label:"Faulty" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:color, display:"inline-block", boxShadow:`0 0 6px ${color}99` }}/>
            <span style={{ fontFamily:"monospace", fontSize:11, color:"rgba(255,255,255,0.55)" }}>{label}</span>
          </div>
        ))}
        <div style={{ borderTop:"1px solid rgba(255,119,201,0.12)", paddingTop:6, marginTop:2, fontFamily:"monospace", fontSize:9, color:"rgba(255,119,201,0.35)" }}>
          Drag · Scroll = zoom
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {[
          { label:"+", fn:onZoomIn,  title:"Zoom in" },
          { label:"−", fn:onZoomOut, title:"Zoom out" },
          { label:"⊙", fn:onReset,   title:"Reset view" },
        ].map(({ label, fn, title }) => (
          <button key={label} onClick={fn} title={title} style={btnStyle()}
            onMouseEnter={e => { Object.assign((e.currentTarget as HTMLButtonElement).style, { background:"rgba(255,119,201,0.22)", borderColor:"rgba(255,119,201,0.6)" }); }}
            onMouseLeave={e => { Object.assign((e.currentTarget as HTMLButtonElement).style, { background:"rgba(8,2,14,0.85)", borderColor:"rgba(255,119,201,0.3)" }); }}>
            <span style={{ fontSize: label === "⊙" ? 13 : 18, lineHeight:1 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type Variant = "green"|"red"|"yellow"|"gray"|"blue"|"ice"|"orange";
function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const MAP: Record<Variant, { light: { bg:string; color:string }; dark: { bg:string; color:string } }> = {
    green:  { light:{bg:"#f0fdf4",color:"#16a34a"}, dark:{bg:"rgba(34,197,94,0.12)",   color:"#22c55e"} },
    red:    { light:{bg:"#fef2f2",color:"#dc2626"}, dark:{bg:"rgba(239,68,68,0.12)",   color:"#ef4444"} },
    yellow: { light:{bg:"#fffbeb",color:"#d97706"}, dark:{bg:"rgba(245,158,11,0.12)",  color:"#f59e0b"} },
    gray:   { light:{bg:"#f9fafb",color:"#6b7280"}, dark:{bg:"rgba(100,116,139,0.12)", color:"#94a3b8"} },
    blue:   { light:{bg:"#eff6ff",color:"#2563eb"}, dark:{bg:"rgba(59,130,246,0.12)",  color:"#3b82f6"} },
    ice:    { light:{bg:"#eff6ff",color:"#1d4ed8"}, dark:{bg:"rgba(96,165,250,0.15)",  color:"#60a5fa"} },
    orange: { light:{bg:"#fff7ed",color:"#c2410c"}, dark:{bg:"rgba(249,115,22,0.15)",  color:"#f97316"} },
  };
  const s = isDark ? MAP[variant].dark : MAP[variant].light;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:6, fontSize:12, fontWeight:600, background:s.bg, color:s.color, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:s.color, display:"inline-block", flexShrink:0 }}/>
      {label}
    </span>
  );
}

function healthVariant(h: string, state: string): Variant {
  if (state === "Leaving")    return "orange";
  if (h === "Healthy")        return "green";
  if (h === "Faulty" || h === "Unhealthy") return "red";
  if (h === "Awaiting Activation") return "yellow";
  return "gray";
}
function stateVariant(s: string): Variant {
  if (s === "Active")     return "green";
  if (s === "Waitlisted") return "yellow";
  if (s === "Frozen")     return "ice";
  if (s === "Leaving")    return "orange";
  return "gray";
}

function healthDotColor(h: string, state: string): string {
  if (state === "Leaving")   return "#f97316";
  if (state === "Frozen")    return "#60a5fa";
  if (state === "Waitlisted") return "#a855f7";
  if (h === "Healthy")       return "#ff77c9";
  if (h === "Faulty" || h === "Unhealthy") return "#ef4444";
  return "#9ca3af";
}

function AddrCell({ p }: { p: StorageProvider }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        <span style={{ fontFamily:"monospace", fontSize:13, color:"var(--text-primary)", fontWeight:600 }}>{p.addressShort}</span>
        <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(p.address).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500)}).catch(()=>{});}}
          style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:copied?"#22c55e":"var(--text-dim)", padding:"0 2px" }} title="Copy full address">
          {copied?"✓":"⧉"}
        </button>
      </div>
      {p.geo?.city && <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:1 }}>{p.geo.city}{p.geo.countryCode?`, ${p.geo.countryCode}`:""}</div>}
    </div>
  );
}

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  if (!full) return <span style={{ color:"var(--text-dim)" }}>—</span>;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }} title={full}>{full.slice(0,10)}…</span>
      <button onClick={async e=>{e.stopPropagation();await navigator.clipboard.writeText(full).catch(()=>{});setCopied(true);setTimeout(()=>setCopied(false),1500);}}
        style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:copied?"#22c55e":"var(--text-dim)", padding:"0 2px" }}>{copied?"✓":"⧉"}</button>
    </div>
  );
}

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const items = [
    { label:"Total SPs",  value:providers.length,                                                  color:"#2563eb" },
    { label:"Healthy",    value:providers.filter(p=>p.health==="Healthy"&&p.state!=="Leaving").length, color:"#ff77c9" },
    { label:"Active",     value:providers.filter(p=>p.state==="Active").length,                    color:"#0891b2" },
    { label:"Waitlisted", value:providers.filter(p=>p.state==="Waitlisted").length,                color:"#a855f7" },
    { label:"Leaving",    value:providers.filter(p=>p.state==="Leaving").length,                   color:"#f97316" },
    { label:"Frozen",     value:providers.filter(p=>p.state==="Frozen").length,                    color:"#60a5fa" },
    { label:"Cities",     value:new Set(providers.map(p=>p.geo?.city??p.availabilityZone)).size,   color:"#8b5cf6" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(${items.length},1fr)`, gap:1, background:"var(--border)", borderRadius:12, overflow:"hidden", border:"1px solid var(--border)" }}>
      {items.map(s=>(
        <div key={s.label} style={{ background:"var(--bg-card)", padding:"11px 8px", textAlign:"center" }}>
          <div style={{ fontFamily:"monospace", fontSize:17, fontWeight:700, color:s.color, letterSpacing:-0.5 }}>{s.value}</div>
          <div style={{ fontSize:9, color:"var(--text-muted)", marginTop:2, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function adaptToStorageProvider(sp: Record<string,unknown>): StorageProvider {
  return {
    address:          String(sp.address??""),
    addressShort:     String(sp.addressShort??""),
    availabilityZone: String(sp.availabilityZone??"unknown"),
    state:            String(sp.state??"Active") as StorageProvider["state"],
    health:           String(sp.health??"Unknown") as StorageProvider["health"],
    blsKey:           String(sp.blsKey??""),
    fullBlsKey:       String(sp.blsKey??""),
    capacityTiB:      sp.capacityTiB!=null?Number(sp.capacityTiB):undefined,
    netAddress:       sp.netAddress?String(sp.netAddress):undefined,
    geo: sp.geo ? {
      lat:         Number((sp.geo as Record<string,unknown>).lat??0),
      lng:         Number((sp.geo as Record<string,unknown>).lng??0),
      city:        String((sp.geo as Record<string,unknown>).city??""),
      countryCode: String((sp.geo as Record<string,unknown>).countryCode??""),
      source:      String((sp.geo as Record<string,unknown>).source??"zone-fallback") as "geo-ip"|"zone-fallback"|"manual",
    } : undefined,
  };
}

type FilterKey = "all"|"healthy"|"faulty"|"waitlisted"|"frozen"|"leaving";

function ProviderDirectory({ providers, loading, onRefresh }: {
  providers: StorageProvider[]; loading: boolean; onRefresh: ()=>void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<"zone"|"health"|"state"|"city">("city");
  const leavingCount = providers.filter(p => p.state === "Leaving").length;
  const frozenCount  = providers.filter(p => p.state === "Frozen").length;
  const faultyCount  = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;

  const filtered = providers
    .filter(p => {
      if (filter==="healthy")    return p.health==="Healthy" && p.state!=="Leaving";
      if (filter==="faulty")     return p.health==="Faulty"||p.health==="Unhealthy";
      if (filter==="waitlisted") return p.state==="Waitlisted";
      if (filter==="frozen")     return p.state==="Frozen";
      if (filter==="leaving")    return p.state==="Leaving";
      return true;
    })
    .sort((a,b) => {
      if (sortBy==="city")   return (a.geo?.city??a.availabilityZone).localeCompare(b.geo?.city??b.availabilityZone);
      if (sortBy==="zone")   return a.availabilityZone.localeCompare(b.availabilityZone);
      if (sortBy==="health") return a.health.localeCompare(b.health);
      return a.state.localeCompare(b.state);
    });

  /* NEW LOGIC: Fixed template literal expressions */
  const FILTERS: Array<{key:FilterKey;label:string}> = [
    {key:"all",        label:"All"},
    {key:"healthy",    label:"Healthy"},
    {key:"leaving",    label: leavingCount > 0 ? `Leaving (${leavingCount})` : "Leaving"},
    {key:"faulty",     label: faultyCount > 0 ? `Faulty (${faultyCount})` : "Faulty"},
    {key:"waitlisted", label:"Waitlisted"},
    {key:"frozen",     label: frozenCount > 0 ? `Frozen (${frozenCount})` : "Frozen"},
  ];
  /* END NEW LOGIC */

  return (
    <div style={{ background:"var(--bg-primary)", padding:"18px 22px 40px" }}>
      <div style={{ marginBottom:14 }}><SummaryBar providers={providers}/></div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ fontFamily:"var(--font-display)", fontSize:18, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Provider Directory</h2>
          <p style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)", margin:"3px 0 0" }}>
            {loading?"Loading…":`${filtered.length} of ${providers.length} providers · Auto-refresh 60s`}
          </p>
        </div>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:1, background:"var(--bg-card2)", borderRadius:9, padding:2, border:"1px solid var(--border)" }}>
            {FILTERS.map(({ key, label }) => (
              <button key={key} onClick={()=>setFilter(key)} style={{ padding:"4px 10px", borderRadius:7, border:"none", fontSize:11, fontWeight:filter===key?600:400, background:filter===key?"var(--bg-card)":"transparent", color:filter===key?"var(--text-primary)":"var(--text-muted)", boxShadow:filter===key?"0 1px 3px var(--shadow-color)":"none", cursor:"pointer" }}>
                {label}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)} style={{ padding:"4px 10px", borderRadius:8, border:"1px solid var(--border)", fontSize:11, color:"var(--text-primary)", background:"var(--bg-card)", cursor:"pointer", outline:"none" }}>
            <option value="city">Sort: City</option>
            <option value="zone">Sort: Zone</option>
            <option value="health">Sort: Health</option>
            <option value="state">Sort: State</option>
          </select>
          <button onClick={onRefresh} disabled={loading} style={{ padding:"4px 10px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:11, color:"var(--text-muted)", cursor:"pointer", opacity:loading?0.6:1 }}>
            {loading?"…":"⟳ Refresh"}
          </button>
        </div>
      </div>

      {leavingCount > 0 && (
        <div style={{ marginBottom:12, padding:"8px 14px", borderRadius:8, background:"rgba(249,115,22,0.08)", border:"1px solid rgba(249,115,22,0.25)", fontSize:11, color:"#f97316", display:"flex", alignItems:"flex-start", gap:8 }}>
          <span>ℹ</span>
          <span><strong>Leaving</strong>: This provider is leaving after the epoch boundary and is no longer task-eligible. {leavingCount} SP{leavingCount>1?"s":""} in this state.</span>
        </div>
      )}

      <div style={{ borderRadius:11, border:"1px solid var(--border)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["","ADDRESS","LOCATION","AZ ZONE","HEALTH","STATE","BLS KEY"].map((h,i)=>(
                <th key={i} style={{ padding:i===0?"9px 16px":"9px 12px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && providers.length===0
              ? Array.from({length:5}).map((_,i)=>(
                  <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                    {[16,110,90,70,55,55,70].map((w,j)=>(
                      <td key={j} style={{ padding:j===0?"10px 16px":"10px 12px" }}>
                        <div className="skeleton" style={{ width:w, height:j===0?8:13, borderRadius:j===0?"50%":4 }}/>
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length===0
              ? <tr><td colSpan={7} style={{ padding:"44px 16px", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>No providers match this filter</td></tr>
              : filtered.map((p,i)=>{
                  const hv = healthVariant(p.health as string, p.state);
                  const sv = stateVariant(p.state);
                  const dotColor = healthDotColor(p.health as string, p.state);
                  const isLeaving = p.state === "Leaving";
                  
                  /* NEW LOGIC: Clean string interpolation for location label */
                  const loc = p.geo?.city 
                    ? `${p.geo.city}${p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}` 
                    : p.availabilityZone;
                  /* END NEW LOGIC */

                  return (
                    <tr key={p.address||i} style={{ borderBottom:"1px solid var(--border-soft)", background:isLeaving?"rgba(249,115,22,0.04)":i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                      <td style={{ padding:"10px 16px", width:26 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:dotColor, boxShadow:p.health==="Healthy"&&!isLeaving?`0 0 6px ${dotColor}88`:"none" }}/>
                      </td>
                      <td style={{ padding:"10px 12px" }}><AddrCell p={p}/></td>
                      <td style={{ padding:"10px 12px" }}>
                        <div style={{ fontSize:12, color:"var(--text-secondary)", fontWeight:500 }}>{loc}</div>
                        {p.geo?.source==="geo-ip"&&<div style={{ fontSize:9, color:"var(--text-dim)", marginTop:1 }}>📍 IP geo</div>}
                      </td>
                      <td style={{ padding:"10px 12px" }}><span style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"monospace" }}>{p.availabilityZone}</span></td>
                      <td style={{ padding:"10px 12px" }}>
                        <Badge label={isLeaving?"Leaving":p.health==="Unknown"?"Awaiting":p.health as string} variant={hv}/>
                      </td>
                      <td style={{ padding:"10px 12px" }}><Badge label={p.state} variant={sv}/></td>
                      <td style={{ padding:"10px 16px" }}><BlsKey full={p.fullBlsKey??p.blsKey??""}/></td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MapPage() {
  const { network }     = useNetwork();
  const [mode, setMode] = useState<ViewMode>("globe");
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string|null>(null);
  const globeRef = useRef<GlobeHandle>(null);

  const fetchProviders = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(30_000) });
      const d   = await res.json() as any;
      if (!res.ok) throw new Error(d?.error??`HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) setProviders((raw as Record<string,unknown>[]).map(adaptToStorageProvider));
    } catch (e: any) { setError(e.message??"Failed to load providers"); }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    setProviders([]); setLoading(true); setError(null);
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  const globeMarkers: GlobeMarker[] = providers.map(providerToMarker).filter((m): m is GlobeMarker => m!==null);
  const healthy    = providers.filter(p=>p.health==="Healthy"&&p.state!=="Leaving").length;
  const leaving    = providers.filter(p=>p.state==="Leaving").length;
  const isGlobe    = mode==="globe";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 60px)", background:"var(--bg-primary)", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 16px", background:"var(--bg-card)", borderBottom:"1px solid var(--border)", gap:10, flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:loading?"var(--text-dim)":"#ff77c9", display:"inline-block", boxShadow:!loading?"0 0 6px #ff77c988":"none" }}/>
            <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-muted)" }}>
              {loading?"Loading…":`${healthy} healthy`}
            </span>
          </div>
          {!loading && providers.length>0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-muted)" }}>{providers.length} total SPs</span>
          </>}
          {leaving>0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"monospace", fontSize:12, color:"#f97316" }}>{leaving} leaving</span>
          </>}
          <span style={{ color:"var(--border)" }}>|</span>
          <LiveUTCClock/>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <div style={{ display:"flex", background:"var(--bg-card2)", borderRadius:9, padding:2, border:"1px solid var(--border)", gap:2 }}>
            {([["globe","🌐 Globe"],["flat","🗺 Flat Map"]] as [ViewMode,string][]).map(([m,lbl])=>(
              <button key={m} onClick={()=>setMode(m)} style={{ padding:"5px 12px", borderRadius:7, border:"none", fontSize:12, fontWeight:mode===m?600:400, background:mode===m?"var(--bg-card)":"transparent", color:mode===m?"var(--text-primary)":"var(--text-muted)", boxShadow:mode===m?"0 1px 3px var(--shadow-color)":"none", cursor:"pointer" }}>
                {lbl}
              </button>
            ))}
          </div>
          <button onClick={fetchProviders} disabled={loading} style={{ width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-muted)", cursor:loading?"not-allowed":"pointer", opacity:loading?0.5:1, fontSize:13 }}>⟳</button>
        </div>
      </div>

      <div style={{ height:"56vh", minHeight:280, position:"relative", overflow:"hidden", flexShrink:0 }}>
        {error && (
          <div style={{ position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", zIndex:30, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.35)", borderRadius:8, padding:"7px 14px", fontFamily:"monospace", fontSize:11, color:"#ef4444", display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap" }}>
            ⚠ {error}
            <button onClick={fetchProviders} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:10, textDecoration:"underline" }}>Retry</button>
          </div>
        )}

        {isGlobe && (
          <div style={{ width:"100%", height:"100%", background:"#08020e", position:"relative" }}>
            <SpInfoPanel providers={providers} loading={loading}/>
            <GlobeLegendAndZoom
              onZoomIn={() => globeRef.current?.zoomIn()}
              onZoomOut={() => globeRef.current?.zoomOut()}
              onReset={() => globeRef.current?.reset()}
            />
            <div style={{ position:"absolute", bottom:10, right:10, zIndex:10, background:"rgba(8,2,14,0.85)", border:"1px solid rgba(255,119,201,0.2)", borderRadius:6, padding:"3px 10px", fontFamily:"monospace", fontSize:9, color:"rgba(255,119,201,0.5)", backdropFilter:"blur(8px)" }}>
              🇲🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>
            <Globe
              ref={globeRef}
              markers={globeMarkers}
              autoRotate
              interactive
              style={{ width:"100%", height:"100%" }}
            />
          </div>
        )}

        {!isGlobe && (
          <div style={{ width:"100%", height:"100%" }}>
            <ProviderMap providers={providers}/>
          </div>
        )}
      </div>

      <div style={{ flex:1, overflowY:"auto", borderTop:"1px solid var(--border)" }}>
        <ProviderDirectory providers={providers} loading={loading} onRefresh={fetchProviders}/>
      </div>
    </div>
  );
}