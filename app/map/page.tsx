"use client";
// app/map/page.tsx — v4.0
// Fixes:
//  1. SHELBY_SP_MARKERS removed — import deleted, fallback is [] (globe shows no markers until data loads)
//  2. GlobeMarker.color is now string (CSS hex), not number[] — providerToMarker updated
//  3. markerColor prop on Globe removed (globe.tsx v13 uses string, not number[])
//  4. Provider Directory table restored (Image 4 from earlier session)
//  5. Full XY drag already handled in globe.tsx v13

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
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "lspin 1s linear infinite" }} />
      <style>{`@keyframes lspin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// FIX 1+2: color is CSS hex string, no number[] tuple
function providerToMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat;
  const lng  = p.geo?.lng;
  if (!lat || !lng) return null;

  const isHealthy    = p.health === "Healthy";
  const isWaitlisted = p.state  === "Waitlisted";
  const color = isHealthy ? "#ff77c9" : isWaitlisted ? "#a855f7" : "#ef4444";

  return {
    location: [lat, lng],
    size:     isHealthy ? 0.07 : 0.05,
    color,
    label:    p.availabilityZone ?? undefined,
  };
}

type ViewMode = "globe" | "flat";

// Icons
const GlobeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="6.5"/><path d="M8 1.5C8 1.5 5.5 5 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 5 10.5 8s-2.5 6.5-2.5 6.5"/><path d="M1.5 8h13"/>
  </svg>
);
const FlatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M6 6v7"/>
  </svg>
);

// SP info panel
function SpInfoPanel({ providers, loading }: { providers: StorageProvider[]; loading: boolean }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const faulty     = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;

  const byZone = providers.reduce<Record<string, number>>((acc, p) => {
    const z = p.availabilityZone || "unknown";
    acc[z] = (acc[z] || 0) + 1;
    return acc;
  }, {});
  const topZones = Object.entries(byZone).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const COLORS   = ["#ff77c9","#a855f7","#60a5fa","#22c55e","#f59e0b"];

  return (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 20, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", width: 230, boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>Network Providers</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
          {loading ? "…" : providers.length}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginLeft: 6 }}>total SPs</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[{ label:"Healthy",    count: healthy,    color:"#22c55e" },
          { label:"Waitlisted", count: waitlisted, color:"#a855f7" },
          { label:"Faulty",     count: faulty,     color:"#ef4444" }].map(({ label, count, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 5px ${color}88` }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{loading ? "…" : count}</span>
          </div>
        ))}
      </div>
      {!loading && providers.length > 0 && (
        <div style={{ height: 5, borderRadius: 3, overflow: "hidden", background: "var(--border)", display: "flex" }}>
          <div style={{ width: `${(healthy    / providers.length) * 100}%`, background: "#22c55e" }} />
          <div style={{ width: `${(waitlisted / providers.length) * 100}%`, background: "#a855f7" }} />
          <div style={{ width: `${(faulty     / providers.length) * 100}%`, background: "#ef4444" }} />
        </div>
      )}
      {topZones.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>Top Zones</div>
          {topZones.map(([zone, count], i) => (
            <div key={zone} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{zone}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Provider Directory Table
function Badge({ label, variant }: { label: string; variant: "green"|"red"|"yellow"|"gray"|"blue" }) {
  const MAP = {
    green:  { bg:"rgba(34,197,94,0.1)",   color:"#22c55e" },
    red:    { bg:"rgba(239,68,68,0.1)",   color:"#ef4444" },
    yellow: { bg:"rgba(245,158,11,0.1)",  color:"#f59e0b" },
    gray:   { bg:"rgba(100,116,139,0.1)", color:"#94a3b8" },
    blue:   { bg:"rgba(59,130,246,0.1)",  color:"#3b82f6" },
  };
  const s = MAP[variant];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"3px 10px", borderRadius:6, fontSize:12, fontWeight:600, background:s.bg, color:s.color }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:s.color, display:"inline-block" }} />
      {label}
    </span>
  );
}

function healthVariant(h: string): "green"|"red"|"yellow"|"gray" {
  if (h === "Healthy")             return "green";
  if (h === "Faulty" || h === "Unhealthy") return "red";
  if (h === "Awaiting Activation") return "yellow";
  return "gray";
}

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  if (!full) return <span style={{ color:"var(--text-dim)" }}>—</span>;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }} title={full}>{full.slice(0,10)}…</span>
      <button onClick={async e => { e.stopPropagation(); await navigator.clipboard.writeText(full).catch(()=>{}); setCopied(true); setTimeout(()=>setCopied(false),1500); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color: copied ? "#22c55e" : "var(--text-dim)", padding:"0 2px" }}>
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}

function ProviderDirectory({ providers, loading, onRefresh }: { providers: StorageProvider[]; loading: boolean; onRefresh: ()=>void }) {
  const [filter, setFilter]  = useState<"all"|"healthy"|"faulty"|"waitlisted">("all");
  const [sortBy, setSortBy]  = useState<"zone"|"health"|"state">("zone");

  const filtered = providers
    .filter(p => {
      if (filter === "healthy")    return p.health === "Healthy";
      if (filter === "faulty")     return p.health === "Faulty" || p.health === "Unhealthy";
      if (filter === "waitlisted") return p.state  === "Waitlisted";
      return true;
    })
    .sort((a, b) =>
      sortBy === "zone"   ? (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "") :
      sortBy === "health" ? (a.health as string).localeCompare(b.health as string) :
      a.state.localeCompare(b.state)
    );

  return (
    <div style={{ background:"var(--bg-primary)", padding:"20px 24px 40px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18, flexWrap:"wrap", gap:12 }}>
        <div>
          <h2 style={{ fontFamily:"var(--font-display)", fontSize:20, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Provider Directory</h2>
          <p style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)", margin:"4px 0 0" }}>
            {loading ? "Loading…" : `${filtered.length} of ${providers.length} providers · Auto-refresh 60s`}
          </p>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:2, background:"var(--bg-card2)", borderRadius:9, padding:2, border:"1px solid var(--border)" }}>
            {(["all","healthy","faulty","waitlisted"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding:"5px 12px", borderRadius:7, border:"none", fontSize:12, fontWeight:filter===f?600:400, background:filter===f?"var(--bg-card)":"transparent", color:filter===f?"var(--text-primary)":"var(--text-muted)", boxShadow:filter===f?"0 1px 3px var(--shadow-color)":"none", cursor:"pointer", textTransform:"capitalize" }}>{f}</button>
            ))}
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} style={{ padding:"5px 10px", borderRadius:8, border:"1px solid var(--border)", fontSize:12, color:"var(--text-primary)", background:"var(--bg-card)", cursor:"pointer", outline:"none" }}>
            <option value="zone">Sort: Zone</option>
            <option value="health">Sort: Health</option>
            <option value="state">Sort: State</option>
          </select>
          <button onClick={onRefresh} disabled={loading} style={{ padding:"5px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:12, color:"var(--text-muted)", cursor:"pointer", opacity:loading?0.6:1 }}>
            {loading ? "…" : "⟳ Refresh"}
          </button>
        </div>
      </div>

      <div style={{ borderRadius:11, border:"1px solid var(--border)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["","Address","Zone / DC","Health","State","Capacity","BLS Key"].map((h,i) => (
                <th key={i} style={{ padding:i===0?"10px 18px":"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && providers.length === 0
              ? Array.from({length:5}).map((_,i) => (
                  <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                    {[18,120,80,60,60,60,80].map((w,j) => (
                      <td key={j} style={{ padding:j===0?"11px 18px":"11px 14px" }}>
                        <div className="skeleton" style={{ width:w, height:j===0?9:14, borderRadius:j===0?"50%":4 }} />
                      </td>
                    ))}
                  </tr>
                ))
              : filtered.length === 0
              ? <tr><td colSpan={7} style={{ padding:"52px 18px", textAlign:"center", color:"var(--text-muted)", fontSize:14 }}>No providers match the current filter</td></tr>
              : filtered.map((p, i) => (
                  <tr key={p.address || i} style={{ borderBottom:"1px solid var(--border-soft)", background:i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                    <td style={{ padding:"11px 18px", width:30 }}>
                      <div style={{ width:9, height:9, borderRadius:"50%", background:p.health==="Healthy"?"#22c55e":p.health==="Faulty"?"#ef4444":"#f59e0b", boxShadow:p.health==="Healthy"?"0 0 6px #22c55e88":"none" }} />
                    </td>
                    <td style={{ padding:"11px 14px" }}>
                      <span style={{ fontFamily:"monospace", fontSize:13, color:"var(--text-primary)", fontWeight:600 }}>{p.addressShort}</span>
                      {p.geo?.city && <div style={{ fontSize:11, color:"var(--text-dim)", marginTop:2 }}>{p.geo.city}{p.geo.countryCode?`, ${p.geo.countryCode}`:""}</div>}
                    </td>
                    <td style={{ padding:"11px 14px" }}><span style={{ fontSize:13, color:"var(--text-secondary)", fontWeight:500 }}>{p.availabilityZone}</span></td>
                    <td style={{ padding:"11px 14px" }}><Badge label={p.health as string} variant={healthVariant(p.health as string)} /></td>
                    <td style={{ padding:"11px 14px" }}><Badge label={p.state} variant={p.state==="Active"?"green":p.state==="Waitlisted"?"yellow":"gray"} /></td>
                    <td style={{ padding:"11px 14px", textAlign:"right" }}>{p.capacityTiB!=null?<span style={{ fontFamily:"monospace", fontSize:13 }}>{p.capacityTiB.toFixed(2)} TiB</span>:<span style={{ color:"var(--text-dim)" }}>—</span>}</td>
                    <td style={{ padding:"11px 18px" }}>
                      <BlsKey full={p.fullBlsKey ?? p.blsKey ?? ""} />
                      {p.netAddress && <div style={{ fontSize:10, color:"var(--text-dim)", marginTop:1, fontFamily:"monospace" }}>{p.netAddress}</div>}
                    </td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────
export default function MapPage() {
  const { network }     = useNetwork();
  const { isDark }      = useTheme();
  const [mode, setMode] = useState<ViewMode>("globe");
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastAt,    setLastAt]    = useState("");
  const [error,     setError]     = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(30_000) });
      const d   = await res.json() as any;
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) { setProviders(raw as StorageProvider[]); setLastAt(new Date().toLocaleTimeString()); }
    } catch (e: any) { setError(e.message ?? "Failed to load providers"); }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    setProviders([]); setLoading(true); setLastAt(""); fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  // FIX 1: no SHELBY_SP_MARKERS fallback — empty array until data loads
  const globeMarkers: GlobeMarker[] = providers
    .map(providerToMarker)
    .filter((m): m is GlobeMarker => m !== null);

  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const isGlobe    = mode === "globe";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg-primary)" }}>

      {/* Top bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 18px", background:"var(--bg-card)", borderBottom:"1px solid var(--border)", gap:12, flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:loading?"var(--text-dim)":"#22c55e", display:"inline-block", boxShadow:!loading?"0 0 6px #22c55e":"none" }} />
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)" }}>{loading?"Loading…":`${healthy} healthy`}</span>
          </div>
          {!loading && providers.length > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)" }}>{providers.length} total SPs</span>
          </>}
          {waitlisted > 0 && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"#a855f7" }}>{waitlisted} waitlisted</span>
          </>}
          {lastAt && <>
            <span style={{ color:"var(--border)" }}>|</span>
            <span suppressHydrationWarning style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)" }}>{lastAt}</span>
          </>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={() => setMode(isGlobe?"flat":"globe")} title={isGlobe?"Switch to Flat Map":"Switch to Globe"}
            style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 14px", borderRadius:"var(--r-md)", border:"1px solid var(--border)", background:"var(--bg-card2)", color:"var(--text-secondary)", fontFamily:"var(--font-mono)", fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.14s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="var(--shelby-pink)"; (e.currentTarget as HTMLButtonElement).style.color="var(--shelby-pink)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor="var(--border)"; (e.currentTarget as HTMLButtonElement).style.color="var(--text-secondary)"; }}>
            {isGlobe ? <FlatIcon /> : <GlobeIcon />}
            {isGlobe ? "Flat Map" : "Globe"}
          </button>
          <button onClick={fetchProviders} disabled={loading} title="Refresh" style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:"var(--r-md)", border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-muted)", cursor:loading?"not-allowed":"pointer", opacity:loading?0.5:1, fontSize:14 }}>⟳</button>
        </div>
      </div>

      {/* Map area */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        {error && (
          <div style={{ position:"absolute", top:12, left:"50%", transform:"translateX(-50%)", zIndex:30, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:"var(--r-md)", padding:"8px 16px", fontFamily:"var(--font-mono)", fontSize:12, color:"#ef4444", display:"flex", alignItems:"center", gap:8, whiteSpace:"nowrap" }}>
            <span>⚠</span><span>{error}</span>
            <button onClick={fetchProviders} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:11, textDecoration:"underline" }}>Retry</button>
          </div>
        )}

        {/* GLOBE */}
        {mode === "globe" && (
          <div style={{ width:"100%", height:"100%", background:isDark?"#0d0a08":"#f7f5f3", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <SpInfoPanel providers={providers} loading={loading} />
            {/* Legend */}
            <div style={{ position:"absolute", bottom:20, left:250, zIndex:10, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--r-md)", padding:"10px 14px", display:"flex", flexDirection:"column", gap:6, boxShadow:"var(--shadow-md)" }}>
              {[{color:"#ff77c9",label:"Healthy"},{color:"#a855f7",label:"Waitlisted"},{color:"#ef4444",label:"Faulty"}].map(({color,label})=>(
                <div key={label} style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:color, display:"inline-block", boxShadow:`0 0 5px ${color}88` }} />
                  <span style={{ fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop:"1px solid var(--border-soft)", paddingTop:5, fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)" }}>Drag to rotate (XY)</div>
            </div>
            <div style={{ position:"absolute", bottom:20, right:20, zIndex:10, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--r-md)", padding:"5px 12px", fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", boxShadow:"var(--shadow-sm)" }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>
            {/* FIX 3: no markerColor prop (Globe default = "#ff77c9") */}
            <Globe
              markers={globeMarkers}
              autoRotate
              interactive
              style={{ width:"min(86vw, 86vh)", height:"min(86vw, 86vh)" }}
            />
          </div>
        )}

        {/* FLAT MAP */}
        {mode === "flat" && (
          <div style={{ width:"100%", height:"100%" }}>
            <ProviderMap providers={providers} />
          </div>
        )}
      </div>

      {/* Provider Directory below map */}
      <div style={{ maxHeight:"45vh", overflowY:"auto", borderTop:"1px solid var(--border)" }}>
        <ProviderDirectory providers={providers} loading={loading} onRefresh={fetchProviders} />
      </div>
    </div>
  );
}