"use client";
// app/map/page.tsx — v2.0
// CHANGES:
//  - Icon-only toggle: shows flat-map icon when on globe (click → flat map)
//    and globe icon when on flat map (click → globe). Default: globe.
//  - GlobeMarker.color removed — cobe marker color set globally via markerColor prop
//  - Globe fills full remaining viewport height
//  - CSP: react-simple-maps fetches world-atlas from cdn.jsdelivr.net
//    (allowed in next.config.js connect-src)

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import { type GlobeMarker, SHELBY_SP_MARKERS } from "@/components/ui/globe";

// ── Dynamic imports ────────────────────────────────────────────────
const Globe = dynamic(() => import("@/components/ui/globe"), {
  ssr: false,
  loading: () => <MapLoading label="Loading globe…" />,
});

const ProviderMap = dynamic(
  () => import("@/components/provider-map").then(m => m.ProviderMap),
  { ssr: false, loading: () => <MapLoading label="Loading map…" /> }
);

function MapLoading({ label }: { label: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink)", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

// ── Convert SP → GlobeMarker (no color field on GlobeMarker) ──────
function toMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat;
  const lng = p.geo?.lng;
  if (!lat || !lng) return null;
  return {
    location: [lat, lng],
    size: p.health === "Healthy" ? 0.07 : 0.05,
    // color is NOT a field on GlobeMarker — colors are per-role via markerColor
  };
}

// ── Icon SVGs ──────────────────────────────────────────────────────
const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="8"/>
    <path d="M10 2c0 0-3 4.5-3 8s3 8 3 8M10 2c0 0 3 4.5 3 8s-3 8-3 8"/>
    <path d="M2 10h16M3 6.5h14M3 13.5h14"/>
  </svg>
);

const FlatMapIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="16" height="12" rx="1.5"/>
    <path d="M7 4v12M13 4v12"/>
    <path d="M2 8h18M2 12h18" opacity="0.5"/>
  </svg>
);

type ViewMode = "globe" | "flat";

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

  // Markers: use live providers if available, else default
  const globeMarkers: GlobeMarker[] = providers.length > 0
    ? (providers.map(toMarker).filter((m): m is GlobeMarker => m !== null))
    : SHELBY_SP_MARKERS;

  // markerColor by mode — healthy SPs = pink, all fallback = pink
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;

  // ── Icon toggle button: shows the OTHER view's icon ────────────────
  // Clicking switches to that view. Tooltip explains current action.
  const toggleMode = () => setMode(m => m === "globe" ? "flat" : "globe");
  const toggleTitle = mode === "globe" ? "Switch to Flat Map" : "Switch to Globe";

  return (
    <div style={{ height: "calc(100vh - var(--nav-h))", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 20px",
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        gap: 12, flexWrap: "wrap", flexShrink: 0,
      }}>
        {/* Left — stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : "#22c55e", display: "inline-block", boxShadow: !loading ? "0 0 6px #22c55e" : "none" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
              {loading ? "Loading…" : `${healthy} healthy`}
            </span>
          </div>
          {!loading && providers.length > 0 && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{providers.length} total SPs</span>
            </>
          )}
          {waitlisted > 0 && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#a855f7" }}>{waitlisted} waitlisted</span>
            </>
          )}
          {lastAt && (
            <>
              <span style={{ color: "var(--border)" }}>|</span>
              <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{lastAt}</span>
            </>
          )}
        </div>

        {/* Right — icon toggle + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Single icon button: shows the OTHER view icon. Click to switch. */}
          <button
            onClick={toggleMode}
            title={toggleTitle}
            aria-label={toggleTitle}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-card2)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: 12, fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.14s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--shelby-pink)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--shelby-pink)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
          >
            {/* Show the icon of the view you'll SWITCH TO */}
            {mode === "globe" ? <FlatMapIcon /> : <GlobeIcon />}
            {mode === "globe" ? "Flat Map" : "Globe"}
          </button>

          <button
            onClick={fetchProviders}
            disabled={loading}
            title="Refresh providers"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32,
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-muted)",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.5 : 1,
              transition: "all 0.14s",
              fontSize: 14,
            }}
          >
            ⟳
          </button>
        </div>
      </div>

      {/* ── Map area ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* Error banner */}
        {error && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 20, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--r-md)", padding: "8px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <span>⚠</span><span>{error}</span>
            <button onClick={fetchProviders} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Retry</button>
          </div>
        )}

        {/* Globe */}
        {mode === "globe" && (
          <div style={{ width: "100%", height: "100%", background: isDark ? "#0d0a08" : "#f8f6f4", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {/* Legend */}
            <div style={{ position: "absolute", bottom: 20, left: 20, zIndex: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, boxShadow: "var(--shadow-md)" }}>
              {[{ color: "#ff77c9", label: "Healthy" }, { color: "#a855f7", label: "Waitlisted" }, { color: "#ef4444", label: "Faulty" }].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 6px ${color}88` }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>Drag to rotate</div>
            </div>

            {/* Sovereignty badge */}
            <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 10, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "6px 12px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", boxShadow: "var(--shadow-sm)" }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>

            <Globe
              markers={globeMarkers}
              autoRotate
              interactive
              markerColor={[1, 0.47, 0.79]}
              style={{ width: "min(88vw, 88vh)", height: "min(88vw, 88vh)" }}
            />
          </div>
        )}

        {/* Flat map */}
        {mode === "flat" && (
          <div style={{ width: "100%", height: "100%" }}>
            <ProviderMap providers={providers} />
          </div>
        )}
      </div>
    </div>
  );
}