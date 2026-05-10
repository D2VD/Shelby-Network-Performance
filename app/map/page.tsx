"use client";
// app/map/page.tsx — v3.0
// Features:
//  - Globe (default) ↔ Flat Map toggle via icon buttons in top bar
//  - SP network info panel restored (health, zone breakdown, stake)
//  - Flat map uses bundled GEO data fallback to avoid CSP cdn.jsdelivr.net block
//  - Globe uses cobe v6 (live size in onRender)

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import { type GlobeMarker, SHELBY_SP_MARKERS } from "@/components/ui/globe";

// Dynamic imports — browser-only
const Globe = dynamic(() => import("@/components/ui/globe"), {
  ssr: false,
  loading: () => <Loader label="Loading globe…" />,
});

// NOTE: ProviderMap (react-simple-maps) fetches world-atlas from cdn.jsdelivr.net.
// This requires connect-src to include https://unpkg.com OR the topology must be
// bundled locally. The component handles its own error gracefully.
const ProviderMap = dynamic(
  () => import("@/components/provider-map").then(m => m.ProviderMap),
  { ssr: false, loading: () => <Loader label="Loading map…" /> }
);

function Loader({ label }: { label: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink, #ff77c9)", animation: "ms 1s linear infinite" }} />
      <style>{`@keyframes ms{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// Convert StorageProvider → GlobeMarker (no color field on GlobeMarker type)
function toMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat;
  const lng  = p.geo?.lng;
  if (!lat || !lng) return null;
  return { location: [lat, lng], size: p.health === "Healthy" ? 0.07 : 0.05 };
}

// ── Icons ──────────────────────────────────────────────────────────
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="8"/>
    <path d="M10 2c0 0-3 4.5-3 8s3 8 3 8M10 2c0 0 3 4.5 3 8s-3 8-3 8"/>
    <path d="M2 10h16M3 6.5h14M3 13.5h14"/>
  </svg>
);
const FlatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="16" height="12" rx="1.5"/>
    <path d="M7 4v12M13 4v12"/><path d="M2 8.5h16M2 11.5h16" strokeOpacity="0.4"/>
  </svg>
);

type ViewMode = "globe" | "flat";

// ── SP Info Panel ──────────────────────────────────────────────────
function SpInfoPanel({ providers, loading }: { providers: StorageProvider[]; loading: boolean }) {
  const byZone = providers.reduce<Record<string, number>>((acc, p) => {
    const z = p.availabilityZone || "unknown";
    acc[z] = (acc[z] || 0) + 1;
    return acc;
  }, {});

  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const faulty     = providers.filter(p => p.health === "Faulty" || p.health === "Unhealthy").length;

  const topZones = Object.entries(byZone)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const ZONE_COLORS = ["#ff77c9", "#a855f7", "#60a5fa", "#22c55e", "#f59e0b"];

  return (
    <div style={{
      position: "absolute",
      top: 16, left: 16,
      zIndex: 20,
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: "16px 18px",
      width: 230,
      boxShadow: "var(--shadow-lg)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      {/* Header */}
      <div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 4 }}>
          Network Providers
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 14, width: "60%", borderRadius: 4 }} />
        ) : (
          <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>
            {providers.length}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginLeft: 6 }}>total SPs</span>
          </div>
        )}
      </div>

      {/* Health breakdown */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {[
          { label: "Healthy",    count: healthy,    color: "#22c55e" },
          { label: "Waitlisted", count: waitlisted, color: "#a855f7" },
          { label: "Faulty",     count: faulty,     color: "#ef4444" },
        ].map(({ label, count, color }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 5px ${color}88` }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
              {loading ? "…" : count}
            </span>
          </div>
        ))}
      </div>

      {/* Health bar */}
      {!loading && providers.length > 0 && (
        <div>
          <div style={{ height: 5, borderRadius: 3, overflow: "hidden", background: "var(--border)", display: "flex" }}>
            <div style={{ width: `${(healthy / providers.length) * 100}%`, background: "#22c55e", transition: "width 0.5s" }} />
            <div style={{ width: `${(waitlisted / providers.length) * 100}%`, background: "#a855f7", transition: "width 0.5s" }} />
            <div style={{ width: `${(faulty / providers.length) * 100}%`, background: "#ef4444", transition: "width 0.5s" }} />
          </div>
        </div>
      )}

      {/* Zone breakdown */}
      {topZones.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>
            Top zones
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {topZones.map(([zone, count], i) => (
              <div key={zone} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: 2, background: ZONE_COLORS[i % ZONE_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {zone}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", flexShrink: 0 }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
      if (Array.isArray(raw)) {
        setProviders(raw as StorageProvider[]);
        setLastAt(new Date().toLocaleTimeString());
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setProviders([]); setLoading(true); setLastAt("");
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  const globeMarkers: GlobeMarker[] = providers.length > 0
    ? providers.map(toMarker).filter((m): m is GlobeMarker => m !== null)
    : SHELBY_SP_MARKERS;

  const healthy = providers.filter(p => p.health === "Healthy").length;

  // Toggle button — shows icon + label of the VIEW YOU'LL SWITCH TO
  const isGlobe = mode === "globe";

  return (
    <div style={{ height: "calc(100vh - var(--nav-h))", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>

      {/* ── Top bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 18px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>

        {/* Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : "#22c55e", display: "inline-block", boxShadow: !loading && !error ? "0 0 6px #22c55e" : "none" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
              {loading ? "Loading…" : error ? "Error" : `${healthy} healthy`}
            </span>
          </div>
          {!loading && !error && providers.length > 0 && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{providers.length} total SPs</span>
            </>
          )}
          {lastAt && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{lastAt}</span>
            </>
          )}
        </div>

        {/* Right — view toggle + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Icon toggle: shows the other view's icon to click into */}
          <button
            onClick={() => setMode(isGlobe ? "flat" : "globe")}
            title={isGlobe ? "Switch to Flat Map" : "Switch to Globe"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-card2)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: 12, fontWeight: 600,
              cursor: "pointer", transition: "all 0.14s",
            }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = "var(--shelby-pink)"; b.style.color = "var(--shelby-pink)"; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = "var(--border)"; b.style.color = "var(--text-secondary)"; }}
          >
            {isGlobe ? <FlatIcon /> : <GlobeIcon />}
            {isGlobe ? "Flat Map" : "Globe"}
          </button>

          <button
            onClick={fetchProviders}
            disabled={loading}
            title="Refresh"
            style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-md)", border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-muted)", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1, fontSize: 14 }}
          >
            ⟳
          </button>
        </div>
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {error && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "8px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <span>⚠</span><span>{error}</span>
            <button onClick={fetchProviders} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Retry</button>
          </div>
        )}

        {/* SP Info Panel — shown in both views */}
        <SpInfoPanel providers={providers} loading={loading} />

        {/* GLOBE */}
        {mode === "globe" && (
          <div style={{ width: "100%", height: "100%", background: isDark ? "#0d0a08" : "#f7f5f3", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {/* Legend */}
            <div style={{ position: "absolute", bottom: 20, left: 250, zIndex: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "var(--shadow-md)" }}>
              {[{ color: "#ff77c9", label: "Healthy" }, { color: "#a855f7", label: "Waitlisted" }, { color: "#ef4444", label: "Faulty" }].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 5px ${color}88` }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 5, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>Drag to rotate</div>
            </div>

            {/* Sovereignty */}
            <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "5px 12px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", boxShadow: "var(--shadow-sm)" }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>

            <Globe
              markers={globeMarkers}
              autoRotate
              interactive
              markerColor={[1, 0.47, 0.79]}
              style={{ width: "min(86vw, 86vh)", height: "min(86vw, 86vh)" }}
            />
          </div>
        )}

        {/* FLAT MAP */}
        {mode === "flat" && (
          <div style={{ width: "100%", height: "100%" }}>
            <ProviderMap providers={providers} />
          </div>
        )}
      </div>
    </div>
  );
}