// app/dashboard/providers/page.tsx
// Storage Providers page — shows REAL data from Shelby RPC + explorer
// All data is fetched live; if the API is unreachable, an error is shown
"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Nav } from "@/components/nav";
import { StatCard, ErrorBanner, StatusBadge } from "@/components/ui";
import { MiniBar } from "@/components/charts";
import { ProviderMap } from "@/components/provider-map";
import type { StorageProvider, ApiResult } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

type SortKey = "address" | "availabilityZone" | "state" | "health";

// ── Type helpers ──────────────────────────────────────────────────────────────
type StateVariant  = "active" | "waiting" | "frozen" | "neutral";
type HealthVariant = "healthy" | "faulty" | "neutral";

function stateVariant(s: string): StateVariant {
  const map: Record<string, StateVariant> = { Active: "active", Waitlisted: "waiting", Frozen: "frozen", Leaving: "neutral" };
  return map[s] ?? "neutral";
}
function healthVariant(h: string): HealthVariant {
  return h === "Healthy" ? "healthy" : h === "Faulty" ? "faulty" : "neutral";
}

// ── Zone summary ──────────────────────────────────────────────────────────────
function ZonePill({ zone, count, color }: { zone: string; count: number; color: string }) {
  const meta = ZONE_META[zone];
  return (
    <div style={{ background: color + "12", border: `1px solid ${color}30`, borderRadius: 10, padding: "10px 16px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        {meta?.label ?? zone}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: "#0A0A0A" }}>{count}</div>
      <div style={{ fontSize: 11, color: "#AAA" }}>providers</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const [providers,   setProviders]   = useState<StorageProvider[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [fetchedAt,   setFetchedAt]   = useState<string | null>(null);
  const [sort,        setSort]        = useState<SortKey>("availabilityZone");
  const [sortDir,     setSortDir]     = useState<1 | -1>(1);
  const [filterZone,  setFilterZone]  = useState<string>("all");
  const [filterText,  setFilterText]  = useState("");

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/network/providers");
      const json: ApiResult<{ providers: StorageProvider[]; count: number }> = await res.json();
      if (!json.ok) {
        setError(json.error);
        setProviders([]);
      } else {
        setProviders(json.data.providers);
        setError(null);
      }
      setFetchedAt(json.fetchedAt);
    } catch (err: any) {
      setError(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  // Derived aggregates
  const zones = useMemo(() => {
    const m = new Map<string, number>();
    providers.forEach(p => m.set(p.availabilityZone, (m.get(p.availabilityZone) ?? 0) + 1));
    return m;
  }, [providers]);

  const activeCount   = providers.filter(p => p.state   === "Active" ).length;
  const healthyCount  = providers.filter(p => p.health  === "Healthy").length;
  const zoneKeys      = Array.from(zones.keys()).sort();
  const ZONE_COLORS   = ["#059669", "#3B82F6", "#8B5CF6", "#D97706", "#F97316"];

  const toggleSort = (k: SortKey) => {
    if (sort === k) setSortDir(d => d === 1 ? -1 : 1);
    else { setSort(k); setSortDir(1); }
  };

  const sorted = useMemo(() => {
    return [...providers]
      .filter(p => {
        const zoneMatch = filterZone === "all" || p.availabilityZone === filterZone;
        const textMatch = !filterText || p.address.toLowerCase().includes(filterText.toLowerCase());
        return zoneMatch && textMatch;
      })
      .sort((a, b) => {
        const av = a[sort] ?? "", bv = b[sort] ?? "";
        return av > bv ? sortDir : av < bv ? -sortDir : 0;
      });
  }, [providers, sort, sortDir, filterZone, filterText]);

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span style={{ fontSize: 9, color: sort === k ? "#059669" : "#D0D0D0", marginLeft: 4 }}>
      {sort === k ? (sortDir === 1 ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", fontFamily: "'Outfit', sans-serif", color: "#0A0A0A" }}>
      <Nav />

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, letterSpacing: -1 }}>Storage Providers</h1>
            <p style={{ fontSize: 13.5, color: "#AAA", margin: "6px 0 0" }}>
              Live data from Shelbynet · auto-refreshes every 60s
              {fetchedAt && (
                <span style={{ marginLeft: 8, fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#CCC" }}>
                  · {new Date(fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <button onClick={fetchProviders} disabled={loading} style={{
            padding: "8px 18px", background: "#F4F4F4", border: "1px solid #E8E8E8",
            borderRadius: 10, cursor: "pointer", fontSize: 13, color: "#555",
          }}>
            {loading ? "Loading…" : "⟳ Refresh"}
          </button>
        </div>

        {/* Error */}
        {error && !loading && (
          <div style={{ marginBottom: 20 }}>
            <ErrorBanner
              message="Cannot fetch storage provider data"
              detail={error}
              onRetry={fetchProviders}
            />
          </div>
        )}

        {/* Loading skeleton */}
        {loading && providers.length === 0 && (
          <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: 40, textAlign: "center", color: "#CCC", marginBottom: 20 }}>
            Loading provider data from Shelbynet…
          </div>
        )}

        {/* Summary stats */}
        {providers.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
              <StatCard label="Total Providers"  value={providers.length}     sub="On Shelbynet"                 color="#059669" />
              <StatCard label="Active"           value={activeCount}          sub={`${Math.round(activeCount/providers.length*100)}% of total`}  color="#059669" />
              <StatCard label="Healthy"          value={healthyCount}         sub={`${Math.round(healthyCount/providers.length*100)}% active health`} color="#3B82F6" />
              <StatCard label="Regions"          value={zones.size}           sub="Availability zones"           color="#8B5CF6" />
            </div>

            {/* Zone breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(zoneKeys.length, 5)}, 1fr)`, gap: 10, marginBottom: 24 }}>
              {zoneKeys.map((z, i) => (
                <ZonePill key={z} zone={z} count={zones.get(z) ?? 0} color={ZONE_COLORS[i % ZONE_COLORS.length]} />
              ))}
            </div>

            {/* Map */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "22px 24px", marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Geographic Distribution</div>
              <div style={{ fontSize: 12.5, color: "#AAA", marginBottom: 16 }}>
                Provider locations by availability zone · dots scale with provider count
              </div>
              <ProviderMap providers={providers} />
            </div>

            {/* State / health breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "20px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>State Mix</div>
                {["Active", "Waitlisted", "Frozen", "Leaving"].map(s => {
                  const cnt = providers.filter(p => p.state === s).length;
                  const pct = providers.length ? Math.round(cnt / providers.length * 1000) / 10 : 0;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ width: 80, fontSize: 13, color: "#555" }}>{s}</span>
                      <div style={{ flex: 1, height: 6, background: "#F4F4F4", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: s === "Active" ? "#059669" : s === "Waitlisted" ? "#D97706" : "#3B82F6", borderRadius: 3 }} />
                      </div>
                      <span style={{ width: 50, textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#555" }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, padding: "20px 24px" }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Active Health</div>
                {["Healthy", "Faulty", "Leaving"].map(h => {
                  const cnt = providers.filter(p => p.health === h).length;
                  const pct = providers.length ? Math.round(cnt / providers.length * 1000) / 10 : 0;
                  return (
                    <div key={h} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <span style={{ width: 80, fontSize: 13, color: "#555" }}>{h}</span>
                      <div style={{ flex: 1, height: 6, background: "#F4F4F4", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: h === "Healthy" ? "#059669" : "#DC2626", borderRadius: 3 }} />
                      </div>
                      <span style={{ width: 50, textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#555" }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Table controls */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setFilterZone("all")} style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid",
                  borderColor: filterZone === "all" ? "#059669" : "#E8E8E8",
                  background: filterZone === "all" ? "#F0FDF4" : "#fff",
                  color: filterZone === "all" ? "#059669" : "#666", cursor: "pointer",
                }}>
                  All ({providers.length})
                </button>
                {zoneKeys.map((z, i) => {
                  const meta = ZONE_META[z];
                  return (
                    <button key={z} onClick={() => setFilterZone(z)} style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 13, border: "1px solid",
                      borderColor: filterZone === z ? ZONE_COLORS[i % ZONE_COLORS.length] : "#E8E8E8",
                      background: filterZone === z ? ZONE_COLORS[i % ZONE_COLORS.length] + "12" : "#fff",
                      color: filterZone === z ? ZONE_COLORS[i % ZONE_COLORS.length] : "#666",
                      cursor: "pointer",
                    }}>
                      {meta?.shortLabel ?? z} ({zones.get(z) ?? 0})
                    </button>
                  );
                })}
              </div>
              <input value={filterText} onChange={e => setFilterText(e.target.value)}
                placeholder="Filter by address…"
                style={{ padding: "8px 14px", borderRadius: 10, fontSize: 13, fontFamily: "'DM Mono', monospace", background: "#fff", border: "1px solid #E8E8E8", color: "#0A0A0A", outline: "none", width: 240 }}
              />
            </div>

            {/* Provider directory table */}
            <div style={{ background: "#fff", border: "1px solid #EBEBEB", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0F0F0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Storage Providers Directory</div>
                <span style={{ fontSize: 12, color: "#AAA" }}>Showing {sorted.length} of {providers.length}</span>
              </div>

              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 140px 90px 90px 120px", padding: "10px 20px", background: "#FAFAFA", borderBottom: "1px solid #F0F0F0" }}>
                {[
                  { label: "Address",           key: "address"          as SortKey },
                  { label: "Availability Zone", key: "availabilityZone" as SortKey },
                  { label: "BLS Key",           key: null },
                  { label: "State",             key: "state"            as SortKey },
                  { label: "Health",            key: "health"           as SortKey },
                ].map((col, i) => (
                  <div key={i} onClick={col.key ? () => toggleSort(col.key!) : undefined}
                    style={{ fontSize: 10, fontWeight: 600, color: "#BBB", textTransform: "uppercase", letterSpacing: "0.06em", cursor: col.key ? "pointer" : "default", userSelect: "none", display: "flex", alignItems: "center" }}>
                    {col.label} {col.key && <SortIcon k={col.key} />}
                  </div>
                ))}
              </div>

              {/* Rows */}
              {sorted.length === 0 && (
                <div style={{ padding: "32px 20px", textAlign: "center", color: "#CCC", fontSize: 13 }}>
                  No providers match current filter
                </div>
              )}
              {sorted.map((p, i) => {
                const zoneIdx = zoneKeys.indexOf(p.availabilityZone);
                const zoneMeta = ZONE_META[p.availabilityZone];
                return (
                  <div key={p.address} style={{ display: "grid", gridTemplateColumns: "200px 1fr 140px 90px 90px 120px", padding: "13px 20px", borderBottom: i < sorted.length - 1 ? "1px solid #F8F8F8" : "none", alignItems: "center", transition: "background .12s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#FAFAFA")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Address */}
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12.5, color: "#3B82F6", fontWeight: 500 }}>
                      {p.addressShort || p.address}
                    </div>

                    {/* Zone */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: ZONE_COLORS[zoneIdx % ZONE_COLORS.length], flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, color: "#0A0A0A" }}>{zoneMeta?.label ?? p.availabilityZone}</div>
                        <div style={{ fontSize: 10.5, color: "#CCC", fontFamily: "'DM Mono', monospace" }}>{p.availabilityZone}</div>
                      </div>
                    </div>

                    {/* BLS Key */}
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#AAA" }}>
                      {p.blsKey || "—"}
                    </div>

                    {/* State */}
                    <div><StatusBadge label={p.state} variant={stateVariant(p.state)} /></div>

                    {/* Health */}
                    <div><StatusBadge label={p.health} variant={healthVariant(p.health)} /></div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Data source note */}
        <div style={{ marginTop: 16, fontSize: 12.5, color: "#CCC", textAlign: "center", fontFamily: "'DM Mono', monospace" }}>
          Data fetched live from Shelbynet RPC · shelby_getStorageProviders
        </div>
      </div>
    </div>
  );
}