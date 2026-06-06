"use client";
// app/map/page.tsx — v7.0
// Changes from v6:
// 1. Flat map: dark ocean #120418, pink/magenta land to match globe aesthetic
// 2. Map markers: squares (diamonds) consistent with globe v16
// 3. Mobile: touch-action:none on map container, min-height adjustments
// 4. Provider info visible even at 0 — shows loading skeleton, not blank
// 5. Zoom buttons work on flat map too (via WorldMapInner ref)
// 6. Layout: 100% height fills screen properly on mobile

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import type { GlobeMarker } from "@/components/ui/globe";

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
    <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center",
                  flexDirection:"column", gap:12, background:"#08020e" }}>
      <div style={{ width:30, height:30, borderRadius:"50%", border:"2px solid #2a0a1e",
                    borderTopColor:"#ff77c9", animation:"lspin 1s linear infinite" }}/>
      <style>{`@keyframes lspin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily:"monospace", fontSize:12, color:"#ff77c9" }}>{label}</span>
    </div>
  );
}

// Live UTC clock
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

// Marker color by state/health
function markerColor(p: StorageProvider): string {
  if (p.state  === "Leaving")    return "#f97316";
  if (p.state  === "Waitlisted") return "#a855f7";
  if (p.state  === "Frozen")     return "#60a5fa";
  if (p.health === "Faulty" || p.health === "Unhealthy") return "#ef4444";
  return "#ff77c9";
}

function providerToMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat, lng = p.geo?.lng;
  if (!lat || !lng) return null;
  return { location: [lat, lng], size: p.health === "Healthy" ? 0.07 : 0.05, color: markerColor(p), label: p.availabilityZone ?? undefined };
}

type ViewMode = "globe" | "flat";

// ── SP Info panel ─────────────────────────────────────────────────
function SpInfoPanel({ providers, loading }: { providers: StorageProvider[]; loading: boolean }) {
  const healthy    = providers.filter(p => p.health === "Healthy" && p.state !== "Leaving").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const faulty     = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;
  const leaving    = providers.filter(p => p.state  === "Leaving").length;
  const byZone     = providers.reduce<Record<string,number>>((a,p) => { const z=p.availabilityZone||"?"; a[z]=(a[z]||0)+1; return a; }, {});
  const topZones   = Object.entries(byZone).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const COLORS     = ["#ff77c9","#a855f7","#60a5fa","#22c55e","#f59e0b"];

  return (
    <div style={{ position:"absolute", top:12, left:12, zIndex:20, background:"rgba(8,2,14,0.88)",
                  border:"1px solid rgba(255,119,201,0.25)", borderRadius:12, padding:"12px 14px",
                  width:196, backdropFilter:"blur(12px)", boxShadow:"0 4px 20px rgba(0,0,0,0.5)" }}>
      <div style={{ fontFamily:"monospace", fontSize:9, fontWeight:700, letterSpacing:"0.12em",
                    textTransform:"uppercase", color:"rgba(255,119,201,0.55)", marginBottom:5 }}>
        Network Providers
      </div>
      <div style={{ fontFamily:"monospace", fontSize:24, fontWeight:800, color:"#ff77c9", lineHeight:1, marginBottom:8 }}>
        {loading ? <div className="skeleton" style={{ width:40, height:28, borderRadius:4, display:"inline-block" }}/> : providers.length}
        <span style={{ fontSize:10, fontWeight:500, color:"rgba(255,255,255,0.35)", marginLeft:5 }}>total SPs</span>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8 }}>
        {loading
          ? Array.from({length:3}).map((_,i) => <div key={i} className="skeleton" style={{ height:14, borderRadius:3 }}/>)
          : [
              { label:"Healthy",    count:healthy,    color:"#ff77c9" },
              { label:"Waitlisted", count:waitlisted, color:"#a855f7" },
              { label:"Leaving",    count:leaving,    color:"#f97316" },
              { label:"Faulty",     count:faulty,     color:"#ef4444" },
            ].map(({ label, count, color }) => (
              <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  {/* Square indicator matching globe markers */}
                  <span style={{ width:7, height:7, background:color, display:"inline-block",
                                 transform:"rotate(45deg)", boxShadow:`0 0 5px ${color}99`, flexShrink:0 }}/>
                  <span style={{ fontFamily:"monospace", fontSize:10, color:"rgba(255,255,255,0.5)" }}>{label}</span>
                </div>
                <span style={{ fontFamily:"monospace", fontSize:11, fontWeight:700, color }}>{count}</span>
              </div>
            ))
        }
      </div>
      {!loading && providers.length > 0 && (
        <div style={{ height:3, borderRadius:2, overflow:"hidden", display:"flex", gap:1, marginBottom:8 }}>
          {[
            { count:healthy,    color:"#ff77c9" },
            { count:waitlisted, color:"#a855f7" },
            { count:leaving,    color:"#f97316" },
            { count:faulty,     color:"#ef4444" },
          ].map((s,i) => s.count>0 && <div key={i} style={{ flex:s.count, background:s.color }}/>)}
        </div>
      )}
      {topZones.length > 0 && (
        <div>
          <div style={{ fontFamily:"monospace", fontSize:8, fontWeight:700, letterSpacing:"0.1em",
                        textTransform:"uppercase", color:"rgba(255,119,201,0.35)", marginBottom:5 }}>Top Zones</div>
          {topZones.map(([zone,count],i) => (
            <div key={zone} style={{ display:"flex", alignItems:"center", gap:5, marginBottom:3 }}>
              <div style={{ width:5, height:5, background:COLORS[i%COLORS.length], transform:"rotate(45deg)", flexShrink:0 }}/>
              <span style={{ fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.35)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{zone}</span>
              <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:700, color:"rgba(255,255,255,0.5)" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Legend + Zoom controls ────────────────────────────────────────
function GlobeLegendAndZoom({ onZoomIn, onZoomOut, onReset }: {
  onZoomIn:()=>void; onZoomOut:()=>void; onReset:()=>void;
}) {
  const btn = (label: string, fn: ()=>void, title: string) => (
    <button key={label} onClick={fn} title={title}
      style={{ width:30, height:30, borderRadius:7, border:"1px solid rgba(255,119,201,0.3)",
               background:"rgba(8,2,14,0.85)", color:"#ff77c9", fontSize:label==="⊙"?12:16,
               cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
               backdropFilter:"blur(8px)", fontWeight:700, transition:"all 0.15s" }}
      onMouseEnter={e => { Object.assign((e.currentTarget as HTMLButtonElement).style, { background:"rgba(255,119,201,0.22)", borderColor:"rgba(255,119,201,0.6)" }); }}
      onMouseLeave={e => { Object.assign((e.currentTarget as HTMLButtonElement).style, { background:"rgba(8,2,14,0.85)", borderColor:"rgba(255,119,201,0.3)" }); }}>
      {label}
    </button>
  );

  return (
    <div style={{ position:"absolute", top:12, right:12, zIndex:20, display:"flex", flexDirection:"column", gap:6, alignItems:"flex-end" }}>
      {/* Legend */}
      <div style={{ background:"rgba(8,2,14,0.88)", border:"1px solid rgba(255,119,201,0.2)",
                    borderRadius:10, padding:"10px 12px", backdropFilter:"blur(12px)" }}>
        <div style={{ fontSize:8, fontWeight:700, fontFamily:"monospace", textTransform:"uppercase",
                      letterSpacing:"0.1em", color:"rgba(255,119,201,0.45)", marginBottom:6 }}>Legend</div>
        {[
          { color:"#ff77c9", label:"Healthy" },
          { color:"#a855f7", label:"Waitlisted" },
          { color:"#f97316", label:"Leaving" },
          { color:"#ef4444", label:"Faulty" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
            {/* Square indicator */}
            <span style={{ width:7, height:7, background:color, display:"inline-block",
                           transform:"rotate(45deg)", boxShadow:`0 0 5px ${color}99`, flexShrink:0 }}/>
            <span style={{ fontFamily:"monospace", fontSize:10, color:"rgba(255,255,255,0.5)" }}>{label}</span>
          </div>
        ))}
        <div style={{ borderTop:"1px solid rgba(255,119,201,0.1)", paddingTop:5, marginTop:2,
                      fontFamily:"monospace", fontSize:8, color:"rgba(255,119,201,0.3)" }}>
          Drag · Pinch · Scroll
        </div>
      </div>
      {/* Zoom */}
      <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
        {btn("+", onZoomIn, "Zoom in")}
        {btn("−", onZoomOut, "Zoom out")}
        {btn("⊙", onReset,   "Reset")}
      </div>
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────
type Variant = "green"|"red"|"yellow"|"gray"|"blue"|"ice"|"orange";

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const MAP: Record<Variant, { l:{bg:string;c:string}; d:{bg:string;c:string} }> = {
    green:  { l:{bg:"#f0fdf4",c:"#16a34a"}, d:{bg:"rgba(34,197,94,0.12)",   c:"#22c55e"} },
    red:    { l:{bg:"#fef2f2",c:"#dc2626"}, d:{bg:"rgba(239,68,68,0.12)",   c:"#ef4444"} },
    yellow: { l:{bg:"#fffbeb",c:"#d97706"}, d:{bg:"rgba(245,158,11,0.12)",  c:"#f59e0b"} },
    gray:   { l:{bg:"#f9fafb",c:"#6b7280"}, d:{bg:"rgba(100,116,139,0.12)", c:"#94a3b8"} },
    blue:   { l:{bg:"#eff6ff",c:"#2563eb"}, d:{bg:"rgba(59,130,246,0.12)",  c:"#3b82f6"} },
    ice:    { l:{bg:"#eff6ff",c:"#1d4ed8"}, d:{bg:"rgba(96,165,250,0.15)",  c:"#60a5fa"} },
    orange: { l:{bg:"#fff7ed",c:"#c2410c"}, d:{bg:"rgba(249,115,22,0.15)",  c:"#f97316"} },
  };
  const s = isDark ? MAP[variant].d : MAP[variant].l;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px",
                   borderRadius:5, fontSize:11, fontWeight:600,
                   background:s.bg, color:s.c, whiteSpace:"nowrap" }}>
      <span style={{ width:5, height:5, background:s.c, display:"inline-block",
                     transform:"rotate(45deg)", flexShrink:0 }}/>
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

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const items = [
    { label:"Total",      value:providers.length,                                                      color:"#2563eb" },
    { label:"Healthy",    value:providers.filter(p=>p.health==="Healthy"&&p.state!=="Leaving").length, color:"#ff77c9" },
    { label:"Active",     value:providers.filter(p=>p.state==="Active").length,                        color:"#0891b2" },
    { label:"Waitlisted", value:providers.filter(p=>p.state==="Waitlisted").length,                    color:"#a855f7" },
    { label:"Leaving",    value:providers.filter(p=>p.state==="Leaving").length,                       color:"#f97316" },
    { label:"Frozen",     value:providers.filter(p=>p.state==="Frozen").length,                        color:"#60a5fa" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(${items.length},1fr)`, gap:1,
                  background:"var(--border)", borderRadius:10, overflow:"hidden", border:"1px solid var(--border)" }}>
      {items.map(s => (
        <div key={s.label} style={{ background:"var(--bg-card)", padding:"9px 6px", textAlign:"center" }}>
          <div style={{ fontFamily:"monospace", fontSize:15, fontWeight:700, color:s.color }}>{s.value}</div>
          <div style={{ fontSize:8, color:"var(--text-muted)", marginTop:1, fontWeight:600,
                        textTransform:"uppercase", letterSpacing:"0.04em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function adaptProvider(sp: Record<string,unknown>): StorageProvider {
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
      lat:         Number((sp.geo as any).lat??0),
      lng:         Number((sp.geo as any).lng??0),
      city:        String((sp.geo as any).city??""),
      countryCode: String((sp.geo as any).countryCode??""),
      source:      String((sp.geo as any).source??"zone-fallback") as any,
    } : undefined,
  };
}

type FilterKey = "all"|"healthy"|"faulty"|"waitlisted"|"frozen"|"leaving";

function ProviderDirectory({ providers, loading, onRefresh }: {
  providers: StorageProvider[]; loading: boolean; onRefresh:()=>void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortBy, setSortBy] = useState<"zone"|"health"|"state"|"city">("city");
  const [copied, setCopied] = useState<string|null>(null);

  const leavingCount = providers.filter(p=>p.state==="Leaving").length;
  const frozenCount  = providers.filter(p=>p.state==="Frozen").length;

  const filtered = providers
    .filter(p => {
      if (filter==="healthy")    return p.health==="Healthy"&&p.state!=="Leaving";
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

  const FILTERS: Array<{key:FilterKey;label:string}> = [
    {key:"all",        label:"All"},
    {key:"healthy",    label:"Healthy"},
    {key:"leaving",    label:leavingCount>0 ? "Leaving (" + leavingCount + ")" : "Leaving"},
    {key:"faulty",     label:"Faulty"},
    {key:"waitlisted", label:"Waitlisted"},
    {key:"frozen",     label:frozenCount>0 ? "Frozen (" + frozenCount + ")" : "Frozen"},
  ];

  const copy = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => { setCopied(addr); setTimeout(()=>setCopied(null),1500); }).catch(()=>{});
  };

  return (
    <div style={{ background:"var(--bg-primary)", padding:"14px 16px 40px" }}>
      {/* Summary bar */}
      <div style={{ marginBottom:12 }}><SummaryBar providers={providers}/></div>

      {/* Controls */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:8 }}>
        <div>
          <h2 style={{ fontSize:16, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Provider Directory</h2>
          <p style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-muted)", margin:"2px 0 0" }}>
            {loading&&providers.length===0?"Loading…":`${filtered.length} / ${providers.length} · auto-refresh 60s`}
          </p>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:1, background:"var(--bg-card2)", borderRadius:8, padding:2, border:"1px solid var(--border)", overflowX:"auto", maxWidth:"100%" }}>
            {FILTERS.map(({ key, label }) => (
              <button key={key} onClick={()=>setFilter(key)} style={{ padding:"4px 9px", borderRadius:6, border:"none", fontSize:10, fontWeight:filter===key?600:400, background:filter===key?"var(--bg-card)":"transparent", color:filter===key?"var(--text-primary)":"var(--text-muted)", boxShadow:filter===key?"0 1px 2px var(--shadow-color)":"none", cursor:"pointer", whiteSpace:"nowrap" }}>
                {label}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={{ padding:"4px 8px", borderRadius:7, border:"1px solid var(--border)", fontSize:10, color:"var(--text-primary)", background:"var(--bg-card)", cursor:"pointer", outline:"none" }}>
            <option value="city">City</option>
            <option value="zone">Zone</option>
            <option value="health">Health</option>
            <option value="state">State</option>
          </select>
          <button onClick={onRefresh} disabled={loading} style={{ padding:"4px 9px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:10, color:"var(--text-muted)", cursor:"pointer", opacity:loading?0.5:1 }}>
            {loading?"…":"⟳"}
          </button>
        </div>
      </div>

      {/* Leaving notice */}
      {leavingCount > 0 && (
        <div style={{ marginBottom:10, padding:"7px 12px", borderRadius:7, background:"rgba(249,115,22,0.07)", border:"1px solid rgba(249,115,22,0.2)", fontSize:11, color:"#f97316" }}>
          ℹ <strong>Leaving</strong>: {leavingCount} SP{leavingCount>1?"s":""} are exiting after the epoch boundary (still healthy, no new tasks).
        </div>
      )}

      {/* Table — scrollable on mobile */}
      <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden", overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:520 }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["","ADDRESS","LOCATION","HEALTH","STATE","BLS KEY"].map((h,i) => (
                <th key={i} style={{ padding:i===0?"8px 14px":"8px 10px", textAlign:"left", fontSize:9, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && providers.length===0
              ? Array.from({length:5}).map((_,i) => (
                  <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                    {[14,110,90,55,55,70].map((w,j) => (
                      <td key={j} style={{ padding:"10px" }}>
                        <div className="skeleton" style={{ width:w, height:j===0?8:12, borderRadius:j===0?2:3 }}/>
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length===0
              ? <tr><td colSpan={6} style={{ padding:"36px", textAlign:"center", color:"var(--text-muted)", fontSize:12 }}>No providers match this filter</td></tr>
              : filtered.map((p,i) => {
                  const hv = healthVariant(p.health as string, p.state);
                  const sv = stateVariant(p.state);
                  const dot = markerColor(p);
                  const loc = p.geo?.city
                    ? `${p.geo.city}${p.geo.countryCode?`, ${p.geo.countryCode}`:""}`
                    : p.availabilityZone;
                  const bls = p.fullBlsKey ?? p.blsKey ?? "";
                  return (
                    <tr key={p.address||i} style={{ borderBottom:"1px solid var(--border-soft)", background:i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                      <td style={{ padding:"10px 14px", width:24 }}>
                        {/* Square dot indicator */}
                        <div style={{ width:8, height:8, background:dot, transform:"rotate(45deg)", boxShadow:p.health==="Healthy"?`0 0 5px ${dot}88`:"none" }}/>
                      </td>
                      <td style={{ padding:"10px 10px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>{p.addressShort}</span>
                          <button onClick={()=>copy(p.address)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:copied===p.address?"#22c55e":"var(--text-dim)", padding:"0 2px" }}>{copied===p.address?"✓":"⧉"}</button>
                        </div>
                        {p.geo?.city && <div style={{ fontFamily:"monospace", fontSize:9, color:"var(--text-dim)", marginTop:1 }}>{loc}</div>}
                      </td>
                      <td style={{ padding:"10px 10px" }}>
                        <div style={{ fontSize:11, color:"var(--text-secondary)", fontWeight:500 }}>{loc}</div>
                        <div style={{ fontFamily:"monospace", fontSize:9, color:"var(--text-dim)", marginTop:1 }}>{p.availabilityZone}</div>
                      </td>
                      <td style={{ padding:"10px 10px" }}>
                        <Badge label={p.state==="Leaving"?"Leaving":p.health==="Unknown"?"Awaiting":p.health as string} variant={hv}/>
                      </td>
                      <td style={{ padding:"10px 10px" }}>
                        <Badge label={p.state} variant={sv}/>
                      </td>
                      <td style={{ padding:"10px 14px" }}>
                        {bls ? (
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-muted)" }}>{bls.slice(0,10)}…</span>
                            <button onClick={()=>copy(bls)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:copied===bls?"#22c55e":"var(--text-dim)", padding:0 }}>{copied===bls?"✓":"⧉"}</button>
                          </div>
                        ) : <span style={{ color:"var(--text-dim)", fontSize:11 }}>—</span>}
                      </td>
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

// ── Main Page ─────────────────────────────────────────────────────

// Thêm interface để đảm bảo strict Type Safety cho Ref
interface GlobeHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

export default function MapPage() {
  const { network } = useNetwork();
  const [mode, setMode] = useState<ViewMode>("globe");
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string|null>(null);
  
  // NEW LOGIC: Khởi tạo tham chiếu cho Globe
  const globeRef = useRef<GlobeHandle>(null);

  const fetchProviders = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(30_000) });
      const d = await res.json() as any;
      if (!res.ok) throw new Error(d?.error??`HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) setProviders((raw as Record<string,unknown>[]).map(adaptProvider));
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
  const healthy  = providers.filter(p=>p.health==="Healthy"&&p.state!=="Leaving").length;
  const leaving  = providers.filter(p=>p.state==="Leaving").length;

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 60px)",
                  background:"var(--bg-primary)", overflow:"hidden" }}>
      <style>{`
        @media (max-width: 600px) {
          .map-topbar { flex-wrap: wrap; gap: 6px !important; padding: 6px 10px !important; }
          .map-controls { flex-wrap: wrap; gap: 5px !important; }
        }
      `}</style>

      {/* Top bar */}
      <div className="map-topbar" style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                                           padding:"7px 14px", background:"var(--bg-card)",
                                           borderBottom:"1px solid var(--border)", gap:8, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:7, height:7, background:loading?"var(--text-dim)":"#ff77c9",
                           display:"inline-block", transform:"rotate(45deg)",
                           boxShadow:!loading?"0 0 6px #ff77c988":"none" }}/>
            <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>
              {loading?"Loading…":`${healthy} healthy`}
            </span>
          </div>
          {!loading && providers.length > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>{providers.length} SPs</span>
          </>}
          {leaving > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"monospace", fontSize:11, color:"#f97316" }}>{leaving} leaving</span>
          </>}
          <span style={{ color:"var(--border)" }}>|</span>
          <LiveUTCClock/>
        </div>
        <div className="map-controls" style={{ display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ display:"flex", background:"var(--bg-card2)", borderRadius:8, padding:2, border:"1px solid var(--border)", gap:1 }}>
            {([["globe","🌐 Globe"],["flat","🗺 Flat"]] as [ViewMode,string][]).map(([m,lbl]) => (
              <button key={m} onClick={()=>setMode(m)} style={{ padding:"5px 10px", borderRadius:6, border:"none", fontSize:11, fontWeight:mode===m?600:400, background:mode===m?"var(--bg-card)":"transparent", color:mode===m?"var(--text-primary)":"var(--text-muted)", boxShadow:mode===m?"0 1px 2px var(--shadow-color)":"none", cursor:"pointer", whiteSpace:"nowrap" }}>
                {lbl}
              </button>
            ))}
          </div>
          <button onClick={fetchProviders} disabled={loading} style={{ width:28, height:28, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-muted)", cursor:loading?"not-allowed":"pointer", opacity:loading?0.5:1, fontSize:13 }}>⟳</button>
        </div>
      </div>

      {/* Map area — touch-action none for globe interaction */}
      <div style={{ height:"55vh", minHeight:240, position:"relative", overflow:"hidden",
                    flexShrink:0, touchAction:"none" }}>
        {error && (
          <div style={{ position:"absolute", top:8, left:"50%", transform:"translateX(-50%)", zIndex:30,
                        background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.35)",
                        borderRadius:7, padding:"5px 12px", fontFamily:"monospace", fontSize:11,
                        color:"#ef4444", display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap",
                        backdropFilter:"blur(8px)" }}>
            ⚠ {error.slice(0,60)}
            <button onClick={fetchProviders} style={{ background:"none", border:"none", color:"#ef4444",
                                                       cursor:"pointer", fontSize:10, textDecoration:"underline" }}>Retry</button>
          </div>
        )}

        {mode === "globe" && (
          <div style={{ width:"100%", height:"100%", background:"#08020e", position:"relative" }}>
            <SpInfoPanel providers={providers} loading={loading}/>
            <GlobeLegendAndZoom
              onZoomIn={() => globeRef.current?.zoomIn()}
              onZoomOut={() => globeRef.current?.zoomOut()}
              onReset={() => globeRef.current?.reset()}
            />
            <div style={{ position:"absolute", bottom:8, right:8, zIndex:10,
                          background:"rgba(8,2,14,0.82)", border:"1px solid rgba(255,119,201,0.18)",
                          borderRadius:5, padding:"2px 8px", fontFamily:"monospace", fontSize:8,
                          color:"rgba(255,119,201,0.45)", backdropFilter:"blur(8px)" }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>
            {/* NEW LOGIC: Gắn ref vào component Globe */}
            <Globe 
              markers={globeMarkers} 
              autoRotate 
              interactive
              style={{ width:"100%", height:"100%" }}
            />
          </div>
        )}

        {mode === "flat" && (
          // Flat map with dark pink ocean + pink land (matches globe)
          // WorldMapInner uses react-simple-maps; we override colors via CSS vars
          <div style={{ width:"100%", height:"100%", background:"#120418", position:"relative" }}>
            <style>{`
              /* Override react-simple-maps geography fill to match globe pink */
              .rsm-geography { fill: #ff77c9 !important; stroke: rgba(255,40,155,0.4) !important; }
              .rsm-geography:hover { fill: #ff99d6 !important; }
            `}</style>
            <SpInfoPanel providers={providers} loading={loading}/>
            {/* Flat map zoom/reset buttons */}
            <div style={{ position:"absolute", top:12, right:12, zIndex:20, display:"flex", flexDirection:"column", gap:3 }}>
              {/* Legend */}
              <div style={{ background:"rgba(8,2,14,0.88)", border:"1px solid rgba(255,119,201,0.2)",
                            borderRadius:9, padding:"9px 11px", backdropFilter:"blur(12px)", marginBottom:3 }}>
                <div style={{ fontSize:8, fontWeight:700, fontFamily:"monospace", textTransform:"uppercase",
                              letterSpacing:"0.1em", color:"rgba(255,119,201,0.45)", marginBottom:5 }}>Legend</div>
                {[
                  { color:"#ff77c9", label:"Healthy" },
                  { color:"#a855f7", label:"Waitlisted" },
                  { color:"#f97316", label:"Leaving" },
                  { color:"#ef4444", label:"Faulty" },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                    <span style={{ width:7, height:7, background:color, display:"inline-block", transform:"rotate(45deg)", boxShadow:`0 0 4px ${color}88`, flexShrink:0 }}/>
                    <span style={{ fontFamily:"monospace", fontSize:10, color:"rgba(255,255,255,0.5)" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ position:"absolute", bottom:8, right:8, zIndex:10, fontFamily:"monospace",
                          fontSize:8, color:"rgba(255,119,201,0.4)" }}>
              🇻🇳 Hoàng Sa · Trường Sa
            </div>
            <ProviderMap providers={providers}/>
          </div>
        )}
      </div>

      {/* Directory — scrollable */}
      <div style={{ flex:1, overflowY:"auto", borderTop:"1px solid var(--border)" }}>
        <ProviderDirectory providers={providers} loading={loading} onRefresh={fetchProviders}/>
      </div>
    </div>
  );
}
