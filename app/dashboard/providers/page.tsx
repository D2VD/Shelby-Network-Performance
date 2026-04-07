"use client";
/**
 * app/dashboard/providers/page.tsx — v8.0
 * 1. SP row hover: fixed tooltip bên phải, row KHÔNG mở rộng
 * 2. Font lớn hơn toàn trang
 * 3. ProviderMap nhận onClusterHover → hover cluster hiện tất cả SP
 * 4. GeoShare panel lớn hơn (đã handle trong provider-map.tsx)
 */

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import { ProviderMap } from "@/components/provider-map";
import { TestnetBanner } from "@/components/testnet-banner";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

type Variant = "green" | "red" | "yellow" | "gray";

function Badge({ label, variant }: { label: string; variant: Variant }) {
  const { isDark } = useTheme();
  const COLORS: Record<Variant, { light: { bg: string; color: string }; dark: { bg: string; color: string } }> = {
    green:  { light:{ bg:"#f0fdf4",color:"#16a34a" }, dark:{ bg:"rgba(34,197,94,0.12)",color:"#22c55e" }},
    red:    { light:{ bg:"#fef2f2",color:"#dc2626" }, dark:{ bg:"rgba(239,68,68,0.12)",color:"#ef4444" }},
    yellow: { light:{ bg:"#fffbeb",color:"#d97706" }, dark:{ bg:"rgba(245,158,11,0.12)",color:"#f59e0b" }},
    gray:   { light:{ bg:"#f9fafb",color:"#6b7280" }, dark:{ bg:"rgba(100,116,139,0.12)",color:"#94a3b8" }},
  };
  const s = isDark ? COLORS[variant].dark : COLORS[variant].light;
  return (
    <span style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"3px 10px",borderRadius:6,fontSize:13,fontWeight:600,background:s.bg,color:s.color }}>
      <span style={{ width:6,height:6,borderRadius:"50%",background:s.color,display:"inline-block" }} />
      {label}
    </span>
  );
}

const healthVariant = (h: string): Variant => h === "Healthy" ? "green" : "red";
const stateVariant  = (s: string): Variant =>
  s === "Active" ? "green" : s === "Waitlisted" ? "yellow" : s === "Frozen" ? "gray" : "red";

function BlsKey({ full }: { full: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(full).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  if (!full) return <span style={{ color:"var(--text-dim)",fontSize:13 }}>—</span>;
  return (
    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
      <span style={{ fontFamily:"monospace",fontSize:11,color:"var(--text-muted)" }} title={full}>{full.slice(0,10)}…</span>
      <button onClick={copy} style={{ background:"none",border:"none",cursor:"pointer",fontSize:12,color:copied?"#22c55e":"var(--text-dim)",padding:"0 2px" }}>{copied?"✓":"⧉"}</button>
    </div>
  );
}

// ── Fixed right-side tooltip (row không thay đổi kích thước) ─────────────────
function HoverTooltip({ p }: { p: StorageProvider }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const bls = p.fullBlsKey || p.blsKey || "";
  const isH = p.health === "Healthy";
  const copy = async () => {
    if (!bls) return;
    await navigator.clipboard.writeText(bls).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const bg  = isDark ? "rgba(13,21,38,0.97)" : "rgba(255,255,255,0.98)";
  const bdr = isDark ? "rgba(56,189,248,0.2)" : "#e2e8f0";
  const tc  = isDark ? "#e2e8f0" : "#111827";
  const mc  = isDark ? "#94a3b8" : "#6b7280";

  return (
    <div style={{ position:"fixed",right:24,top:"50%",transform:"translateY(-50%)",zIndex:600,width:288, background:bg,border:`1px solid ${bdr}`,borderRadius:14,padding:"15px 17px", backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)", boxShadow:"0 20px 50px rgba(0,0,0,0.25)",pointerEvents:"none" }}>
      <div style={{ fontSize:10,fontWeight:700,color:mc,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5 }}>STORAGE PROVIDER</div>
      <div style={{ fontSize:14,fontWeight:700,color:"#3b82f6",fontFamily:"monospace",marginBottom:10 }}>{p.addressShort}</div>
      <div style={{ display:"flex",gap:5,marginBottom:12,flexWrap:"wrap" }}>
        {[
          { label:p.state,  bg:isH?"rgba(34,197,94,0.15)":"rgba(245,158,11,0.15)", color:isH?"#22c55e":"#f59e0b", bdr:isH?"rgba(34,197,94,0.3)":"rgba(245,158,11,0.3)" },
          { label:p.health, bg:isH?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)",  color:isH?"#22c55e":"#ef4444", bdr:"none" },
          { label:`Zone ${ZONE_META[p.availabilityZone]?.shortLabel??p.availabilityZone.replace("dc_","")}`, bg:"rgba(245,158,11,0.12)",color:"#f59e0b",bdr:"none" },
        ].map((b,i) => (
          <span key={i} style={{ fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,background:b.bg,color:b.color,border:b.bdr!=="none"?`1px solid ${b.bdr}`:"none" }}>● {b.label}</span>
        ))}
      </div>
      <div style={{ background:"rgba(128,128,128,0.08)",borderRadius:8,padding:"9px 11px",marginBottom:10 }}>
        <div style={{ fontSize:9,color:mc,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:3 }}>LOCATION</div>
        <div style={{ fontSize:14,fontWeight:700,color:tc }}>{p.geo?.city??ZONE_META[p.availabilityZone]?.label??"Unknown"}{p.geo?.countryCode?`, ${p.geo.countryCode}`:""}</div>
        {p.geo && <div style={{ fontSize:10,color:mc,fontFamily:"monospace",marginTop:2 }}>{p.geo.lat?.toFixed(4)}°, {p.geo.lng?.toFixed(4)}°</div>}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 10px",marginBottom:bls?10:0 }}>
        {[
          { label:"ZONE",     val:ZONE_META[p.availabilityZone]?.label??p.availabilityZone },
          { label:"CAPACITY", val:p.capacityTiB!=null?`${p.capacityTiB.toFixed(1)} TiB`:"—" },
          { label:"NET IP",   val:p.netAddress??"—" },
        ].map(r => (
          <div key={r.label}>
            <div style={{ fontSize:9,color:mc,textTransform:"uppercase" }}>{r.label}</div>
            <div style={{ fontSize:12,color:tc,fontWeight:500,fontFamily:r.label==="NET IP"?"monospace":"inherit" }}>{r.val}</div>
          </div>
        ))}
      </div>
      {bls && (
        <div style={{ borderTop:`1px solid ${bdr}`,paddingTop:10 }}>
          <div style={{ fontSize:9,color:mc,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4 }}>BLS PUBLIC KEY</div>
          <div style={{ display:"flex",alignItems:"center",gap:5,background:"rgba(128,128,128,0.07)",borderRadius:5,padding:"4px 7px" }}>
            <span style={{ fontSize:10,fontFamily:"monospace",color:mc,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{bls.length>36?`${bls.slice(0,34)}…`:bls}</span>
            <button onClick={copy} style={{ background:"none",border:"none",cursor:"pointer",fontSize:12,color:copied?"#22c55e":mc,flexShrink:0,pointerEvents:"auto" }}>{copied?"✓":"⧉"}</button>
          </div>
          <div style={{ fontSize:9,color:mc,marginTop:3,opacity:.7 }}>on-chain · storage_provider_registry</div>
        </div>
      )}
    </div>
  );
}

function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy  = providers.filter(p=>p.health==="Healthy").length;
  const active   = providers.filter(p=>p.state==="Active").length;
  const zones    = new Set(providers.map(p=>p.availabilityZone)).size;
  const totalTiB = providers.reduce((s,p)=>s+(p.capacityTiB??0),0);
  return (
    <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:"var(--border)",borderRadius:12,overflow:"hidden",border:"1px solid var(--border)" }}>
      {[
        { label:"Total SPs",      value:providers.length,                             color:"#2563eb" },
        { label:"Healthy",        value:healthy,                                       color:"#16a34a" },
        { label:"Active",         value:active,                                        color:"#0891b2" },
        { label:"Zones",          value:zones,                                         color:"#8b5cf6" },
        { label:"Total Capacity", value:totalTiB>0?`${totalTiB.toFixed(0)} TiB`:"—", color:"#d97706", isStr:true },
      ].map(s => (
        <div key={s.label} style={{ background:"var(--bg-card)",padding:"14px 18px",textAlign:"center" }}>
          <div style={{ fontFamily:"monospace",fontSize:(s as any).isStr?20:26,fontWeight:700,color:s.color,letterSpacing:-0.5 }}>{s.value}</div>
          <div style={{ fontSize:11,color:"var(--text-muted)",marginTop:3,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em" }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function ProvidersPage() {
  const { network } = useNetwork();
  const { isDark }  = useTheme();
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string|null>(null);
  const [lastAt,    setLastAt]    = useState<Date|null>(null);
  const [filter,    setFilter]    = useState<"all"|"healthy"|"faulty">("all");
  const [sortBy,    setSortBy]    = useState<"zone"|"health"|"state">("zone");
  const [hoveredSP, setHoveredSP] = useState<StorageProvider|null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch(`/api/network/providers?network=${network}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as any;
      if (d.data?.providers) { setProviders(d.data.providers); setLastAt(new Date()); setError(null); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    setLoading(true); setProviders([]);
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  if (network === "testnet") return <TestnetBanner />;

  const filtered = providers
    .filter(p => filter==="healthy"?p.health==="Healthy":filter==="faulty"?p.health!=="Healthy":true)
    .sort((a,b) => sortBy==="zone"?(a.availabilityZone??"").localeCompare(b.availabilityZone??""):sortBy==="health"?a.health.localeCompare(b.health):a.state.localeCompare(b.state));

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:0,minHeight:"calc(100vh - 120px)",background:"var(--bg-primary)" }}>
      {/* MAP */}
      <div style={{ background:isDark?"#0d1526":"#f0f4f8",position:"relative",height:"55vh",minHeight:340 }}>
        <div style={{ position:"absolute",top:12,left:264,zIndex:10,display:"flex",alignItems:"center",gap:8 }}>
          <div style={{ background:isDark?"rgba(13,21,38,0.92)":"rgba(255,255,255,0.92)",border:`1px solid ${isDark?"rgba(34,197,94,0.3)":"rgba(34,197,94,0.4)"}`,borderRadius:8,padding:"5px 14px",fontSize:12,color:isDark?"#94a3b8":"#6b7280",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",gap:7 }}>
            <span style={{ width:7,height:7,borderRadius:"50%",background:"#22c55e",display:"inline-block" }} />
            {loading ? "Loading…" : `${providers.filter(p=>p.health==="Healthy").length} nodes online`}
          </div>
          {lastAt && <div style={{ background:isDark?"rgba(13,21,38,0.9)":"rgba(255,255,255,0.9)",border:`1px solid ${isDark?"rgba(255,255,255,0.08)":"#e5e7eb"}`,borderRadius:6,padding:"4px 10px",fontSize:11,color:"var(--text-dim)",fontFamily:"monospace" }}>{lastAt.toLocaleTimeString()}</div>}
        </div>
        {loading && providers.length===0 ? (
          <div style={{ height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-muted)",fontSize:14,flexDirection:"column",gap:12 }}>
            <div style={{ width:28,height:28,borderRadius:"50%",border:"2px solid var(--border)",borderTopColor:"var(--accent)",animation:"spin 1s linear infinite" }} />
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            Loading providers…
          </div>
        ) : <ProviderMap providers={providers} />}
      </div>

      {/* STATS */}
      <div style={{ padding:"18px 26px",background:"var(--bg-card)",borderBottom:"1px solid var(--border)" }}>
        <SummaryBar providers={providers} />
      </div>

      {/* TABLE */}
      <div style={{ flex:1,background:"var(--bg-primary)",padding:"22px 26px" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:12 }}>
          <div>
            <h2 style={{ fontSize:20,fontWeight:700,color:"var(--text-primary)",margin:0 }}>Provider Directory</h2>
            <p style={{ fontSize:13,color:"var(--text-muted)",margin:"4px 0 0",fontFamily:"monospace" }}>
              {filtered.length} of {providers.length} providers · Hover row for details · Auto-refresh 60s
            </p>
          </div>
          <div style={{ display:"flex",gap:9 }}>
            <div style={{ display:"flex",gap:2,background:"var(--bg-card2)",borderRadius:9,padding:2,border:"1px solid var(--border)" }}>
              {(["all","healthy","faulty"] as const).map(f => (
                <button key={f} onClick={()=>setFilter(f)} style={{ padding:"6px 14px",borderRadius:7,border:"none",fontSize:12,fontWeight:filter===f?600:400,background:filter===f?"var(--bg-card)":"transparent",color:filter===f?"var(--text-primary)":"var(--text-muted)",boxShadow:filter===f?"0 1px 3px var(--shadow-color)":"none",cursor:"pointer",textTransform:"capitalize" }}>{f}</button>
              ))}
            </div>
            <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={{ padding:"6px 11px",borderRadius:8,border:"1px solid var(--border)",fontSize:12,color:"var(--text-primary)",background:"var(--bg-card)",cursor:"pointer",outline:"none" }}>
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>
            <button onClick={fetchProviders} style={{ padding:"6px 14px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg-card)",fontSize:12,color:"var(--text-muted)",cursor:"pointer" }}>⟳ Refresh</button>
          </div>
        </div>

        {error && <div style={{ background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:9,padding:"11px 15px",marginBottom:14,fontSize:13,color:"#ef4444" }}>⚠ {error}</div>}

        <div style={{ borderRadius:11,border:"1px solid var(--border)",overflow:"hidden" }}>
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:"var(--bg-card2)",borderBottom:"1px solid var(--border)" }}>
                {["","ADDRESS","ZONE","HEALTH","STATE","CAPACITY","BLS KEY"].map((h,i) => (
                  <th key={i} style={{ padding:i===0?"10px 18px":"10px 14px",textAlign:i===5?"right":"left",fontSize:11,fontWeight:600,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.07em",whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 ? (
                <tr><td colSpan={7} style={{ padding:"52px 18px",textAlign:"center",color:"var(--text-muted)",fontSize:14 }}>{loading?"Loading providers…":"No providers found"}</td></tr>
              ) : filtered.map((p,i) => {
                const isH = p.health==="Healthy";
                return (
                  <tr key={p.address||i}
                    style={{ borderBottom:"1px solid var(--border-soft)",background:i%2===0?"var(--bg-card)":"var(--bg-card2)",cursor:"default" }}
                    onMouseEnter={()=>setHoveredSP(p)}
                    onMouseLeave={()=>setHoveredSP(null)}
                  >
                    <td style={{ padding:"11px 18px",width:30 }}>
                      <div style={{ width:9,height:9,borderRadius:"50%",background:isH?"#22c55e":"#ef4444",boxShadow:isH?"0 0 6px #22c55e88":"0 0 6px #ef444488" }} />
                    </td>
                    <td style={{ padding:"11px 14px" }}>
                      <div style={{ fontFamily:"monospace",fontSize:13,color:"var(--text-primary)",fontWeight:600 }}>{p.addressShort}</div>
                      {p.geo?.city && <div style={{ fontSize:11,color:"var(--text-dim)",marginTop:2 }}>{p.geo.city}{p.geo.countryCode?`, ${p.geo.countryCode}`:""}</div>}
                    </td>
                    <td style={{ padding:"11px 14px" }}>
                      <div style={{ fontSize:13,color:"var(--text-secondary)",fontWeight:500 }}>{ZONE_META[p.availabilityZone]?.label??p.availabilityZone}</div>
                    </td>
                    <td style={{ padding:"11px 14px" }}><Badge label={p.health} variant={healthVariant(p.health)} /></td>
                    <td style={{ padding:"11px 14px" }}><Badge label={p.state} variant={stateVariant(p.state)} /></td>
                    <td style={{ padding:"11px 14px",textAlign:"right" }}>
                      {p.capacityTiB!=null ? <span style={{ fontFamily:"monospace",fontSize:13,color:"var(--text-primary)" }}>{p.capacityTiB.toFixed(2)} TiB</span> : <span style={{ color:"var(--text-dim)" }}>—</span>}
                    </td>
                    <td style={{ padding:"11px 18px" }}>
                      <BlsKey full={p.fullBlsKey??p.blsKey??""} />
                      {p.netAddress && <div style={{ fontSize:10,color:"var(--text-dim)",marginTop:1,fontFamily:"monospace" }}>{p.netAddress}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fixed tooltip — no row size change */}
      {hoveredSP && <HoverTooltip p={hoveredSP} />}
    </div>
  );
}