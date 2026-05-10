"use client";
// app/map/page.tsx — v1.0
// Globe (default) ↔ Flat map toggle
// Globe uses cobe WebGL (components/ui/globe.tsx)
// Flat map uses existing ProviderMap (react-simple-maps)

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useNetwork } from "@/components/network-context";
import { useTheme } from "@/components/theme-context";
import type { StorageProvider } from "@/lib/types";
import type { GlobeMarker } from "@/components/ui/globe";
import { SHELBY_SP_MARKERS } from "@/components/ui/globe";

// Dynamic imports — both use browser APIs
const Globe = dynamic(() => import("@/components/ui/globe"), {
  ssr: false,
  loading: () => <MapLoading label="Loading globe…" />,
});

const ProviderMap = dynamic(
  () => import("@/components/provider-map").then(m => m.ProviderMap),
  {
    ssr: false,
    loading: () => <MapLoading label="Loading map…" />,
  }
);

// ── Loading placeholder ──────────────────────────────────────────
function MapLoading({ label }: { label: string }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "var(--text-muted)" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--shelby-pink)", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{label}</span>
    </div>
  );
}

// ── Convert StorageProvider → GlobeMarker ────────────────────────
function providerToMarker(p: StorageProvider): GlobeMarker | null {
  const lat = p.geo?.lat;
  const lng = p.geo?.lng;
  if (!lat || !lng) return null;

  const isHealthy   = p.health === "Healthy";
  const isWaitlisted = p.state === "Waitlisted";

  // Healthy → Shelby pink, Waitlisted → purple, Faulty → red
  const color: [number, number, number] = isHealthy
    ? [1, 0.47, 0.79]          // #ff77c9
    : isWaitlisted
    ? [0.66, 0.33, 0.93]        // #a855f7
    : [0.94, 0.26, 0.21];       // #ef4444

  return {
    location: [lat, lng],
    size:     isHealthy ? 0.07 : 0.05,
    color,
  };
}

// ── Toggle button ─────────────────────────────────────────────────
type ViewMode = "globe" | "flat";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div style={{
      display: "flex",
      gap: 2,
      background: "var(--bg-card2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--r-lg)",
      padding: 3,
    }}>
      {(["globe", "flat"] as ViewMode[]).map(v => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: "calc(var(--r-lg) - 2px)",
            border: "none",
            cursor: "pointer",
            transition: "all 0.14s",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            fontWeight: mode === v ? 700 : 500,
            background: mode === v ? "var(--bg-card)" : "transparent",
            color: mode === v ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: mode === v ? "var(--shadow-sm), 0 0 0 1px var(--border)" : "none",
          }}
        >
          {v === "globe"
            ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 1.5C8 1.5 5.5 5 5.5 8s2.5 6.5 2.5 6.5M8 1.5C8 1.5 10.5 5 10.5 8s-2.5 6.5-2.5 6.5"/><path d="M1.5 8h13"/></svg>
            : <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M6 6v7"/></svg>
          }
          {v === "globe" ? "Globe" : "Flat Map"}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function MapPage() {
  const { network }   = useNetwork();
  const { isDark }    = useTheme();
  const [mode, setMode] = useState<ViewMode>("globe");
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastAt,    setLastAt]    = useState("");
  const [error,     setError]     = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const d = await res.json() as any;
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

  // Convert providers to globe markers; fall back to default markers when empty
  const globeMarkers: GlobeMarker[] = providers.length > 0
    ? providers.map(providerToMarker).filter((m): m is GlobeMarker => m !== null)
    : SHELBY_SP_MARKERS;

  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;

  return (
    <div style={{ height: "calc(100vh - var(--nav-h))", display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 20px",
        background: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        gap: 12,
        flexWrap: "wrap",
        flexShrink: 0,
      }}>
        {/* Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: loading ? "var(--text-dim)" : "#22c55e", display: "inline-block", boxShadow: !loading ? "0 0 6px #22c55e" : "none" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
              {loading ? "Loading…" : `${healthy} healthy`}
            </span>
          </div>
          {!loading && providers.length > 0 && (
            <>
              <span style={{ color: "var(--border)", fontSize: 14 }}>|</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                {providers.length} total SPs
              </span>
              {waitlisted > 0 && (
                <>
                  <span style={{ color: "var(--border)", fontSize: 14 }}>|</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#a855f7" }}>
                    {waitlisted} waitlisted
                  </span>
                </>
              )}
            </>
          )}
          {lastAt && (
            <>
              <span style={{ color: "var(--border)", fontSize: 14 }}>|</span>
              <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                {lastAt}
              </span>
            </>
          )}
        </div>

        {/* Right: toggle + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ViewToggle mode={mode} onChange={setMode} />
          <button
            onClick={fetchProviders}
            disabled={loading}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            ⟳ Refresh
          </button>
        </div>
      </div>

      {/* ── Map area ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* Error banner */}
        {error && (
          <div style={{
            position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--r-md)", padding: "8px 16px",
            fontFamily: "var(--font-mono)", fontSize: 12, color: "#ef4444",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠</span><span>{error}</span>
            <button onClick={fetchProviders} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>Retry</button>
          </div>
        )}

        {/* Globe view */}
        {mode === "globe" && (
          <div style={{
            width: "100%", height: "100%",
            background: isDark ? "#0d0a08" : "#f8f6f4",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* Legend */}
            <div style={{
              position: "absolute", bottom: 20, left: 20, zIndex: 10,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", padding: "10px 14px",
              display: "flex", flexDirection: "column", gap: 6,
              boxShadow: "var(--shadow-md)",
            }}>
              {[
                { color: "#ff77c9", label: "Healthy" },
                { color: "#a855f7", label: "Waitlisted" },
                { color: "#ef4444", label: "Faulty" },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 6px ${color}88` }} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>
                Drag to rotate
              </div>
            </div>

            {/* Sovereignty badge */}
            <div style={{
              position: "absolute", bottom: 20, right: 20, zIndex: 10,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              borderRadius: "var(--r-md)", padding: "6px 12px",
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)",
              boxShadow: "var(--shadow-sm)",
            }}>
              🇻🇳 Hoàng Sa · Trường Sa — Chủ quyền Việt Nam
            </div>

            <Globe
              markers={globeMarkers}
              autoRotate={true}
              interactive={true}
              style={{ width: "min(90vw, 90vh)", height: "min(90vw, 90vh)" }}
            />
          </div>
        )}

        {/* Flat map view */}
        {mode === "flat" && (
          <div style={{ width: "100%", height: "100%" }}>
            <ProviderMap providers={providers} />
          </div>
        )}
      </div>
    </div>
  );
}