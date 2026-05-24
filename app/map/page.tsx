"use client";
// app/map/page.tsx — v5.0
// FIXES:
// 1. Live UTC clock: ticks every second via setInterval
// 2. Layout balance: globe 55vh, Provider Directory flexible below with scroll
// 3. Globe hover: SP cluster popup shows on hover (already handled by globe-engine / world-map-inner)
// 4. Address copy: full address copyable in Provider Directory
// 5. Testnet health: uses on-chain condition field (grace period logic) — no false Faulty

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import type { GlobeMarker }    from "@/components/ui/globe";

// Dynamic imports
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
    <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12 }}>
      <div style={{ width:32, height:32, borderRadius:"50%", border:"2px solid var(--border)", borderTopColor:"var(--shelby-pink, #ff77c9)", animation:"lspin 1s linear infinite" }}/>
      <style>{`@keyframes lspin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// FIX: Live UTC clock — ticks every second
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
  const isHealthy    = p.health === "Healthy";
  const isWaitlisted = p.state  === "Waitlisted";
  const color = isHealthy ? "#ff77c9" : isWaitlisted ? "#a855f7" : "#ef4444";
  return { location: [lat, lng], size: isHealthy ? 0.07 : 0.05, color, label: p.availabilityZone ?? undefined };
}

type ViewMode = "globe" | "flat";

const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="6.5"/><path d="M8 1.5C8 1.5 5.5 5 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 5 10.5 8s-2.5 6.5-2.5 6.5"/><path d="M2 8h12"/>
  </svg>
);
const FlatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M6 6v7"/>
  </svg>
);

// SP Info panel (top-left overlay on globe)
function SpInfoPanel({ providers, loading }: { providers: StorageProvider[]; loading: boolean }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const faulty     = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;
  const byZone = providers.reduce<Record<string,number>>((acc,p) => { const z=p.availabilityZone||"unknown"; acc[z]=(acc[z]||0)+1; return acc; }, {});
  const topZones = Object.entries(byZone).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const COLORS = ["#ff77c9","#a855f7","#60a5fa","#22c55e","#f59e0b"];

  return (
    <div style={{ position:"absolute", top:16, left:16, zIndex:20, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px", width:230, boxShadow:"var(--shadow-lg)", display:"flex", flexDirection:"column", gap:12 }}>
      <div>
        <div style={{ fontFamily:"var(--font-mono)", fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--text-dim)", marginBottom:4 }}>Network Providers</div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:24, fontWeight:800, color:"var(--text-primary)", lineHeight:1 }}>
          {loading ? "…" : providers.length}
          <span style={{ fontFamily:"var(--font-mono)", fontSize:11, fontWeight:500, color:"var(--text-muted)", marginLeft:6 }}>total SPs</span>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
        {[{ label:"Healthy",   count:healthy,    color:"#22c55e" },
          { label:"Waitlisted",count:waitlisted, color:"#a855f7" },
          { label:"Faulty",    count:faulty,     color:"#ef4444" }].map(({ label, count, color }) => (
          <div key={label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:color, display:"inline-block", boxShadow:`0 0 5px ${color}88` }}/>
              <span style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)" }}>{label}</span>
            </div>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, fontWeight:700, color:"var(--text-primary)" }}>{loading?"…":count}</span>
          </div>
        ))}
      </div>
      {!loading && providers.length > 0 && (
        <div style={{ height:5, borderRadius:3, overflow:"hidden", background:"var(--border)", display:"flex" }}>
          <div style={{ width:`${(healthy/providers.length)*100}%`, background:"#22c55e" }}/>
          <div style={{ width:`${(waitlisted/providers.length)*100}%`, background:"#a855f7" }}/>
          <div style={{ width:`${(faulty/providers.length)*100}%`, background:"#ef4444" }}/>
        </div>
      )}
      {topZones.length > 0 && (
        <div>
          <div style={{ fontFamily:"var(--font-mono)", fontSize:9, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--text-dim)", marginBottom:6 }}>Top Zones</div>
          {topZones.map(([zone,count],i) => (
            <div key={zone} style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
              <div style={{ width:7, height:7, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }}/>
              <span style={{ fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-muted)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{zone}</span>
              <span style={{ fontFamily:"var(--font-mono)", fontSize:10, fontWeight:700, color:"var(--text-secondary)" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Badge component
function Badge({ label, variant }: { label: string; variant: "green"|"red"|"yellow"|"gray"|"blue"|"ice" }) {
  const { isDark } = useTheme();
  const MAP = {
    green:  { light:{ bg:"#f0fdf4", color:"#16a34a" }, dark:{ bg:"rgba(34,197,94,0.12)",   color:"#22c55e" } },
    red:    { light:{ bg:"#fef2f2", color:"#dc2626" }, dark:{ bg:"rgba(239,68,68,0.12)",   color:"#ef4444" } },
    yellow: { light:{ bg:"#fffbeb", color:"#d97706" }, dark:{ bg:"rgba(245,158,11,0.12)",  color:"#f59e0b" } },
    gray:   { light:{ bg:"#f9fafb", color:"#6b7280" }, dark:{ bg:"rgba(100,116,139,0.12)", color:"#94a3b8" } },
    blue:   { light:{ bg:"#eff6ff", color:"#2563eb" }, dark:{ bg:"rgba(59,130,246,0.12)",  color:"#3b82f6" } },
    ice:    { light:{ bg:"#eff6ff", color:"#1d4ed8" }, dark:{ bg:"rgba(96,165,250,0.15)",  color:"#60a5fa" } },
  };
  const s = isDark ? MAP[variant].dark : MAP[variant].light;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:6, fontSize:12, fontWeight:600, background:s.bg, color:s.color, whiteSpace:"nowrap" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:s.color, display:"inline-block", flexShrink:0 }}/>
      {label}
    </span>
  );
}

function healthVariant(h: string): "green"|"red"|"yellow"|"gray" {
  if (h === "Healthy") return "green";
  if (h === "Faulty" || h === "Unhealthy") return "red";
  if (h === "Awaiting Activation") return "yellow";
  return "gray";
}
function stateVariant(s: string): "green"|"yellow"|"ice"|"gray" {
  if (s === "Active") return "green";
  if (s === "Waitlisted") return "yellow";
  if (s === "Frozen") return "ice";
  return "gray";
}

// Full address copy button
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
      {p.geo?.city && <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:2 }}>{p.geo.city}{p.geo.countryCode?`, ${p.geo.countryCode}`:""}</div>}
    </div>
  );
}

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  if (!full) return <span style={{ color:"var(--text-dim)", fontSize:13 }}>—</span>;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }} title={full}>{full.slice(0,10)}…</span>
      <button onClick={async e=>{e.stopPropagation();await navigator.clipboard.writeText(full).catch(()=>{});setCopied(true);setTimeout(()=>setCopied(false),1500);}}
        style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:copied?"#22c55e":"var(--text-dim)", padding:"0 2px" }}>
        {copied?"✓":"⧉"}
      </button>
    </div>
  );
}

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const active     = providers.filter(p => p.state  === "Active").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const frozen     = providers.filter(p => p.state  === "Frozen").length;
  const cities     = new Set(providers.map(p => p.geo?.city ?? p.availabilityZone)).size;
  const items = [
    { label:"Total SPs",  value:providers.length, color:"#2563eb" },
    { label:"Healthy",    value:healthy,           color:"#16a34a" },
    { label:"Active",     value:active,            color:"#0891b2" },
    { label:"Waitlisted", value:waitlisted,        color:"#f59e0b" },
    { label:"Frozen",     value:frozen,            color:"#60a5fa" },
    { label:"Cities",     value:cities,            color:"#8b5cf6" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:`repeat(${items.length},1fr)`, gap:1, background:"var(--border)", borderRadius:12, overflow:"hidden", border:"1px solid var(--border)" }}>
      {items.map(s => (
        <div key={s.label} style={{ background:"var(--bg-card)", padding:"12px 10px", textAlign:"center" }}>
          <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:700, color:s.color, letterSpacing:-0.5 }}>{s.value}</div>
          <div style={{ fontSize:10, color:"var(--text-muted)", marginTop:3, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function adaptToStorageProvider(sp: Record<string, unknown>): StorageProvider {
  return {
    address:          String(sp.address ?? ""),
    addressShort:     String(sp.addressShort ?? ""),
    availabilityZone: String(sp.availabilityZone ?? "unknown"),
    state:            String(sp.state ?? "Active") as StorageProvider["state"],
    health:           String(sp.health ?? "Unknown") as StorageProvider["health"],
    blsKey:           String(sp.blsKey ?? ""),
    fullBlsKey:       String(sp.blsKey ?? ""),
    capacityTiB:      sp.capacityTiB != null ? Number(sp.capacityTiB) : undefined,
    netAddress:       sp.netAddress ? String(sp.netAddress) : undefined,
    geo: sp.geo ? {
      lat:         Number((sp.geo as Record<string,unknown>).lat ?? 0),
      lng:         Number((sp.geo as Record<string,unknown>).lng ?? 0),
      city:        String((sp.geo as Record<string,unknown>).city ?? ""),
      countryCode: String((sp.geo as Record<string,unknown>).countryCode ?? ""),
      source:      String((sp.geo as Record<string,unknown>).source ?? "zone-fallback") as "geo-ip"|"zone-fallback"|"manual",
    } : undefined,
  };
}

type FilterKey = "all"|"healthy"|"faulty"|"waitlisted"|"frozen";

// ── Provider Directory (below map) ─────────────────────────────────────────────
function ProviderDirectory({ providers, loading, onRefresh }: {
  providers: StorageProvider[]; loading: boolean; onRefresh: ()=>void;
}) {
  const [filter, setFilter]  = useState<FilterKey>("all");
  const [sortBy, setSortBy]  = useState<"zone"|"health"|"state"|"city">("city");
  const frozenCount = providers.filter(p => p.state === "Frozen").length;

  const filtered = providers
    .filter(p => {
      if (filter === "healthy")    return p.health === "Healthy";
      if (filter === "faulty")     return p.health === "Faulty" || p.health === "Unhealthy";
      if (filter === "waitlisted") return p.state  === "Waitlisted";
      if (filter === "frozen")     return p.state  === "Frozen";
      return true;
    })
    .sort((a,b) => {
      if (sortBy === "city")   return (a.geo?.city ?? a.availabilityZone).localeCompare(b.geo?.city ?? b.availabilityZone);
      if (sortBy === "zone")   return a.availabilityZone.localeCompare(b.availabilityZone);
      if (sortBy === "health") return a.health.localeCompare(b.health);
      return a.state.localeCompare(b.state);
    });

  const FILTER_TABS: Array<{ key: FilterKey; label: string }> = [
    { key:"all",        label:"All"        },
    { key:"healthy",    label:"Healthy"    },
    { key:"faulty",     label:"Faulty"     },
    { key:"waitlisted", label:"Waitlisted" },
    { key:"frozen",     label:"Frozen"     },
  ];

  return (
    <div style={{ background:"var(--bg-primary)", padding:"20px 24px 40px" }}>
      {/* Stats summary */}
      <div style={{ marginBottom:16 }}>
        <SummaryBar providers={providers} />
      </div>

      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:12 }}>
        <div>
          <h2 style={{ fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Provider Directory</h2>
          <p style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)", margin:"4px 0 0" }}>
            {loading ? "Loading…" : `${filtered.length} of ${providers.length} providers · Auto-refresh 60s`}
          </p>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {/* Filter tabs */}
          <div style={{ display:"flex", gap:2, background:"var(--bg-card2)", borderRadius:9, padding:2, border:"1px solid var(--border)" }}>
            {FILTER_TABS.map(({ key, label }) => (
              <button key={key} onClick={()=>setFilter(key)} style={{ padding:"5px 12px", borderRadius:7, border:"none", fontSize:12, fontWeight:filter===key?600:400, background:filter===key?"var(--bg-card)":"transparent", color:filter===key?"var(--text-primary)":"var(--text-muted)", boxShadow:filter===key?"0 1px 3px var(--shadow-color)":"none", cursor:"pointer", textTransform:"capitalize" }}>
                {label}
                {key==="frozen" && frozenCount>0 && <span style={{ marginLeft:4, fontSize:10, fontWeight:700, color:"#60a5fa" }}>({frozenCount})</span>}
              </button>
            ))}
          </div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid var(--border)", fontSize:12, color:"var(--text-primary)", background:"var(--bg-card)", cursor:"pointer", outline:"none" }}>
            <option value="city">Sort: City</option>
            <option value="zone">Sort: Zone</option>
            <option value="health">Sort: Health</option>
            <option value="state">Sort: State</option>
          </select>
          <button onClick={onRefresh} disabled={loading} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:12, color:"var(--text-muted)", cursor:"pointer", opacity:loading?0.6:1 }}>
            {loading ? "…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div style={{ borderRadius:11, border:"1px solid var(--border)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["","ADDRESS","LOCATION","AZ ZONE","HEALTH","STATE","BLS KEY / NET"].map((h,i) => (
                <th key={i} style={{ padding:i===0?"10px 18px":"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && providers.length === 0
              ? Array.from({length:5}).map((_,i) => (
                  <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                    {[18,120,100,80,60,60,80].map((w,j) => (
                      <td key={j} style={{ padding:j===0?"11px 18px":"11px 14px" }}>
                        <div className="skeleton" style={{ width:w, height:j===0?9:14, borderRadius:j===0?"50%":4 }}/>
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length === 0
              ? <tr><td colSpan={7} style={{ padding:"52px 18px", textAlign:"center", color:"var(--text-muted)", fontSize:14 }}>No providers match the current filter</td></tr>
              : filtered.map((p, i) => {
                  const hVariant = healthVariant(p.health as string);
                  const sVariant = stateVariant(p.state);
                  const isFrozen = p.state === "Frozen";
                  const dotColor = p.health==="Healthy"?"#22c55e":isFrozen?"#60a5fa":p.state==="Waitlisted"?"#f59e0b":"#ef4444";
                  const loc = p.geo?.city
                    ? `${p.geo.city}${p.geo.countryCode?`, ${p.geo.countryCode}`:""}`
                    : p.availabilityZone;

                  return (
                    <tr key={p.address||i} style={{ borderBottom:"1px solid var(--border-soft)", background:isFrozen?"rgba(96,165,250,0.04)":i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                      <td style={{ padding:"11px 18px", width:30 }}>
                        <div style={{ width:9, height:9, borderRadius:"50%", background:dotColor, boxShadow:p.health==="Healthy"?`0 0 6px ${dotColor}88`:"none" }}/>
                      </td>
                      <td style={{ padding:"11px 14px" }}><AddrCell p={p} /></td>
                      <td style={{ padding:"11px 14px" }}>
                        <div style={{ fontSize:13, color:"var(--text-secondary)", fontWeight:500 }}>{loc}</div>
                        {p.geo?.source==="geo-ip" && <div style={{ fontSize:9, color:"var(--text-dim)", marginTop:1 }}>📍 IP geo</div>}
                      </td>
                      <td style={{ padding:"11px 14px" }}><span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"monospace" }}>{p.availabilityZone}</span></td>
                      <td style={{ padding:"11px 14px" }}>
                        <Badge label={p.health==="Unknown"?"Awaiting":p.health as string} variant={hVariant}/>
                      </td>
                      <td style={{ padding:"11px 14px" }}><Badge label={p.state} variant={sVariant as any}/></td>
                      <td style={{ padding:"11px 18px" }}>
                        <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""}/>
                        {p.netAddress && <div style={{ fontSize:10, color:"var(--text-dim)", marginTop:2, fontFamily:"monospace" }}>{p.netAddress}</div>}
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

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function MapPage() {
  const { network }     = useNetwork();
  const { isDark }      = useTheme();
  const [mode, setMode] = useState<ViewMode>("globe");
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(30_000) });
      const d   = await res.json() as any;
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) setProviders((raw as Record<string,unknown>[]).map(adaptToStorageProvider));
    } catch (e: any) { setError(e.message ?? "Failed to load providers"); }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    setProviders([]); setLoading(true); setError(null);
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  const globeMarkers: GlobeMarker[] = providers.map(providerToMarker).filter((m): m is GlobeMarker => m !== null);
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const isGlobe    = mode === "globe";

  return (
    // FIX: flex column — top bar + map section + directory below
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 60px)", background:"var(--bg-primary)", overflow:"hidden" }}>

      {/* ── Top bar ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 18px", background:"var(--bg-card)", borderBottom:"1px solid var(--border)", gap:12, flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:loading?"var(--text-dim)":"#22c55e", display:"inline-block", boxShadow:!loading?"0 0 6px #22c55e":"none" }}/>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)" }}>
              {loading ? "Loading…" : `${healthy} healthy`}
            </span>
          </div>
          {!loading && providers.length > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)" }}>{providers.length} total SPs</span>
          </>}
          {waitlisted > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"#a855f7" }}>{waitlisted} waitlisted</span>
          </>}
          {/* FIX: Live UTC clock — ticks every second */}
          <span style={{ color:"var(--border)" }}>|</span>
          <LiveUTCClock />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={()=>setMode(isGlobe?"flat":"globe")} title={isGlobe?"Switch to Flat Map":"Switch to Globe"}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", borderRadius:"var(--r-md)", border:"1px solid var(--border)", background:"var(--bg-card2)", color:"var(--text-secondary)", fontFamily:"var(--font-mono)", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.14s" }}
            onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="var(--shelby-pink)";(e.currentTarget as HTMLButtonElement).style.color="var(--shelby-pink)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="var(--border)";(e.currentTarget as HTMLButtonElement).style.color="var(--text-secondary)";}}>
            {isGlobe ? <FlatIcon /> : <GlobeIcon />}
            {isGlobe ? "Flat Map" : "Globe"}
          </button>
          <button onClick={fetchProviders} disabled={loading} title="Refresh" style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"var(--r-md)", border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-muted)", cursor:loading?"not-allowed":"pointer", opacity:loading?0.5:1, fontSize:14 }}>⟳</button>
        </div>
      </div>

      {/* ── Map area: 55vh, fixed height ── */}
      <div style={{ height:"55vh", minHeight:300, position:"relative", overflow:"hidden", flexShrink:0 }}>
        {error && (
          <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:30, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:"var(--r-md)", padding:"8px 16px", fontFamily:"var(--font-mono)", fontSize:12, color:"#ef4444", display:"flex", alignItems:"center", gap:8, whiteSpace:"nowrap" }}>
            <span>⚠</span><span>{error}</span>
            <button onClick={fetchProviders} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:11, textDecoration:"underline" }}>Retry</button>
          </div>
        )}

        {/* GLOBE */}
        {isGlobe && (
          <div style={{ width:"100%", height:"100%", background:isDark?"#0d0a08":"#f7f5f3", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <SpInfoPanel providers={providers} loading={loading} />

            {/* Legend */}
            <div style={{ position:"absolute", bottom:16, left:250, zIndex:10, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--r-md)", padding:"10px 14px", display:"flex", flexDirection:"column", gap:6, boxShadow:"var(--shadow-md)" }}>
              {[{ color:"#ff77c9",label:"Healthy" },{ color:"#a855f7",label:"Waitlisted" },{ color:"#ef4444",label:"Faulty" }].map(({ color, label }) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:color, display:"inline-block", boxShadow:`0 0 5px ${color}88` }}/>
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop:"1px solid var(--border-soft)", paddingTop:5, fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-dim)" }}>Drag to rotate · right=right</div>
            </div>

            {/* Vietnam sovereignty */}
            <div style={{ position:"absolute", bottom:16, right:20, zIndex:10, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--r-md)", padding:"5px 12px", fontFamily:"var(--font-mono)", fontSize:9, color:"var(--text-dim)", boxShadow:"var(--shadow-sm)" }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>

            <Globe
              markers={globeMarkers}
              autoRotate
              interactive
              style={{ width:"min(80vw, 82vh)", height:"min(80vw, 82vh)" }}
            />
          </div>
        )}

        {/* FLAT MAP */}
        {!isGlobe && (
          <div style={{ width:"100%", height:"100%" }}>
            <ProviderMap providers={providers} />
          </div>
        )}
      </div>

      {/* ── Provider Directory: flexible scrollable section ── */}
      <div style={{ flex:1, overflowY:"auto", borderTop:"1px solid var(--border)" }}>
        <ProviderDirectory providers={providers} loading={loading} onRefresh={fetchProviders} />
      </div>
    </div>
  );
}