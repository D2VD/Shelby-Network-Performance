"use client";
// app/dashboard/providers/page.tsx — v16.0 (Phase 2 Step 5)
//
// CHANGES v16.0:
//   - Layout: Tailwind classes thay inline styles
//   - SummaryBar: DataGrid + StatCard components
//   - Provider table: shadcn Table + StatusBadge + MonoValue + CopyButton
//   - Filter/Sort bar: Tailwind + RangeSelector pattern
//   - ErrorBanner, EmptyState, SkeletonTable từ ui.tsx
//   - Map section: giữ nguyên ProviderMap (ssr: false)
//   - Logic fetch: KHÔNG thay đổi
//   - TestnetMapNotice: inline component nhỏ

import { useState, useEffect, useCallback } from "react";
import { useNetwork } from "@/components/network-context";
import { ProviderMap } from "@/components/provider-map";
import type { StorageProvider } from "@/lib/types";
import { ZONE_META } from "@/lib/types";
import {
  StatusBadge, MonoValue, CopyButton, ErrorBanner,
  EmptyState, SkeletonTable, LiveIndicator, NetworkBadge,
  StatCard, DataGrid,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getZoneLabel(az: string): string {
  return ZONE_META[az]?.label ?? az;
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
      lat:         Number((sp.geo as Record<string, unknown>).lat ?? 0),
      lng:         Number((sp.geo as Record<string, unknown>).lng ?? 0),
      city:        String((sp.geo as Record<string, unknown>).city ?? ""),
      countryCode: String((sp.geo as Record<string, unknown>).countryCode ?? ""),
      source:      "zone-fallback" as const,
    } : undefined,
  };
}

type FilterKey = "all" | "healthy" | "faulty" | "waitlisted";
type SortKey   = "zone" | "health" | "state";

// ── Health dot color ──────────────────────────────────────────────────────────
function HealthDot({ health }: { health: string }) {
  const color =
    health === "Healthy"             ? "bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" :
    health === "Faulty" ||
    health === "Unhealthy"           ? "bg-red-500"   :
    health === "Awaiting Activation" ? "bg-amber-400" :
                                       "bg-slate-400";
  return <span className={cn("inline-block size-2 rounded-full shrink-0", color)} />;
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ providers }: { providers: StorageProvider[] }) {
  const healthy    = providers.filter(p => p.health === "Healthy").length;
  const active     = providers.filter(p => p.state  === "Active").length;
  const waitlisted = providers.filter(p => p.state  === "Waitlisted").length;
  const zones      = new Set(providers.map(p => p.availabilityZone)).size;
  const totalTiB   = providers.reduce((s, p) => s + (p.capacityTiB ?? 0), 0);

  return (
    <DataGrid cols={6} className="gap-px rounded-xl overflow-hidden border border-[var(--border)]">
      {[
        { label: "Total SPs",      value: String(providers.length), accent: "#2563eb" },
        { label: "Healthy",        value: String(healthy),          accent: "#16a34a" },
        { label: "Active",         value: String(active),           accent: "#0891b2" },
        { label: "Waitlisted",     value: String(waitlisted),       accent: "#d97706" },
        { label: "Zones",          value: String(zones),            accent: "#8b5cf6" },
        { label: "Total Capacity", value: totalTiB > 0 ? `${totalTiB.toFixed(0)} TiB` : "—", accent: "#d97706" },
      ].map(s => (
        <div key={s.label} className="bg-[var(--bg-card)] px-3 py-4 text-center">
          <div className="text-xl font-extrabold tabular-nums" style={{ color: s.accent, fontFamily: "var(--font-mono)" }}>
            {s.value}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {s.label}
          </div>
        </div>
      ))}
    </DataGrid>
  );
}

// ── Filter button group ───────────────────────────────────────────────────────
function FilterGroup({ value, onChange }: { value: FilterKey; onChange: (v: FilterKey) => void }) {
  const opts: { key: FilterKey; label: string }[] = [
    { key: "all",       label: "All"       },
    { key: "healthy",   label: "Healthy"   },
    { key: "faulty",    label: "Faulty"    },
    { key: "waitlisted",label: "Waitlisted"},
  ];
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card2)] p-0.5">
      {opts.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer border-0",
            value === o.key
              ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
              : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProvidersPage() {
  const { network } = useNetwork();
  const isTestnet   = network === "testnet";

  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastAtStr, setLastAtStr] = useState<string>("");
  const [filter,    setFilter]    = useState<FilterKey>("all");
  const [sortBy,    setSortBy]    = useState<SortKey>("zone");
  const [source,    setSource]    = useState<string>("");

  const fetchProviders = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(35_000) });
      const d   = await res.json() as any;
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      const raw = d?.data?.providers;
      if (Array.isArray(raw)) {
        setProviders((raw as Record<string, unknown>[]).map(adaptToStorageProvider));
        setLastAtStr(new Date().toLocaleTimeString());
        setSource(String(d?.source ?? "vps"));
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setProviders([]); setError(null); setSource(""); setLastAtStr("");
    fetchProviders();
    const id = setInterval(fetchProviders, 60_000);
    return () => clearInterval(id);
  }, [fetchProviders]);

  // Filter + sort
  const filtered = providers
    .filter(p => {
      if (filter === "healthy")    return p.health === "Healthy";
      if (filter === "faulty")     return (p.health as string) === "Faulty" || (p.health as string) === "Unhealthy";
      if (filter === "waitlisted") return p.state === "Waitlisted";
      return true;
    })
    .sort((a, b) =>
      sortBy === "zone"   ? (a.availabilityZone ?? "").localeCompare(b.availabilityZone ?? "") :
      sortBy === "health" ? (a.health as string).localeCompare(b.health as string) :
      a.state.localeCompare(b.state)
    );

  const healthyCount = providers.filter(p => p.health === "Healthy").length;

  return (
    <div className="flex flex-col min-h-[calc(100vh-120px)] bg-[var(--bg-primary)]">

      {/* ── MAP section ──────────────────────────────────────────────────── */}
      <div className="relative bg-[var(--bg-card2)]" style={{ height: "55vh", minHeight: 340 }}>

        {/* Map status badge */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          {lastAtStr && (
            <span suppressHydrationWarning className="rounded-md border border-[var(--border)] bg-[var(--bg-card)]/90 px-3 py-1 text-[11px] font-mono text-[var(--text-dim)] backdrop-blur-sm">
              {lastAtStr}
            </span>
          )}
          <div className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1 text-xs backdrop-blur-sm",
            loading
              ? "border-[var(--border)] bg-[var(--bg-card)]/90 text-[var(--text-muted)]"
              : providers.length > 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-[var(--border)] bg-[var(--bg-card)]/90 text-[var(--text-dim)]",
          )}>
            {!loading && providers.length > 0 && (
              <span className="relative flex size-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
            )}
            {loading
              ? "Loading…"
              : providers.length === 0
              ? (isTestnet ? "No testnet providers" : "No providers")
              : `${healthyCount}/${providers.length} nodes online`
            }
          </div>
        </div>

        {/* Map content */}
        {loading && providers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-muted)] text-sm">
            <div className="size-7 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
            {isTestnet ? "Fetching testnet providers…" : "Loading providers…"}
          </div>
        ) : error && providers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="text-3xl">⚠️</span>
            <p className="text-sm font-semibold text-amber-500">Provider data unavailable</p>
            <p className="text-xs text-[var(--text-dim)] max-w-sm">{error}</p>
            <button
              onClick={fetchProviders}
              className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--text-dim)] transition-colors cursor-pointer"
            >
              ⟳ Retry
            </button>
          </div>
        ) : (
          <ProviderMap providers={providers} />
        )}
      </div>

      {/* ── Stats section ──────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-card)] px-6 py-5">
        {isTestnet && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-purple-500/25 bg-purple-500/8 px-4 py-2.5 text-sm text-purple-400">
            <span>⚗</span>
            <span>Shelby Testnet · Storage provider data from Aptos Testnet RPC</span>
          </div>
        )}
        <SummaryBar providers={providers} />
        {source && (
          <p className="mt-2.5 text-[11px] font-mono text-[var(--text-dim)]">
            Source: {source} · {isTestnet ? "Aptos Testnet RPC" : "Shelbynet on-chain"} · Auto-refresh 60s
          </p>
        )}
      </div>

      {/* ── Provider table ─────────────────────────────────────────────────── */}
      <div className="flex-1 bg-[var(--bg-primary)] px-6 py-5">

        {/* Table header row */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Provider Directory</h2>
            <p className="mt-0.5 text-xs font-mono text-[var(--text-muted)]">
              {loading && providers.length === 0
                ? "Loading…"
                : `${filtered.length} of ${providers.length} providers · ${isTestnet ? "Aptos Testnet" : "Shelbynet"} · Auto-refresh 60s`
              }
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterGroup value={filter} onChange={f => { setFilter(f); }} />

            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className={cn(
                "rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5",
                "text-xs text-[var(--text-primary)] cursor-pointer outline-none",
                "hover:border-[var(--text-dim)] transition-colors",
              )}
            >
              <option value="zone">Sort: Zone</option>
              <option value="health">Sort: Health</option>
              <option value="state">Sort: State</option>
            </select>

            <button
              onClick={fetchProviders}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)]",
                "bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]",
                "hover:text-[var(--text-primary)] hover:border-[var(--text-dim)]",
                "transition-all cursor-pointer disabled:opacity-50",
              )}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={loading ? "animate-spin" : ""}>
                <path d="M10 6A4 4 0 112 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M10 3v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && providers.length === 0 && (
          <ErrorBanner message={error} variant="error" onRetry={fetchProviders} className="mb-4" />
        )}

        {/* Table */}
        {loading && providers.length === 0 ? (
          <SkeletonTable rows={8} cols={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="🗺"
            title={error ? "Failed to load providers" : "No providers match this filter"}
            description={error ? "Check backend connection" : "Try selecting a different filter"}
            action={
              <button
                onClick={error ? fetchProviders : () => setFilter("all")}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                {error ? "⟳ Retry" : "Clear filter"}
              </button>
            }
          />
        ) : (
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--bg-card2)] hover:bg-[var(--bg-card2)]">
                  <TableHead className="w-8" />
                  <TableHead>Address</TableHead>
                  <TableHead>Zone / DC</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead>BLS Key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p, i) => {
                  const healthStr = p.health as string;
                  const bls       = p.fullBlsKey || p.blsKey || "";
                  return (
                    <TableRow
                      key={p.address || i}
                      className={cn(
                        "transition-colors",
                        i % 2 === 0
                          ? "bg-[var(--bg-card)]"
                          : "bg-[var(--bg-card2)]",
                      )}
                    >
                      {/* Health dot */}
                      <TableCell className="py-3 pl-4 pr-2">
                        <HealthDot health={healthStr} />
                      </TableCell>

                      {/* Address */}
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-0.5">
                          <MonoValue value={p.address} truncate copyable />
                          {p.geo?.city && (
                            <span className="text-[10px] text-[var(--text-dim)]">
                              {p.geo.city}{p.geo.countryCode ? `, ${p.geo.countryCode}` : ""}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Zone */}
                      <TableCell className="py-3">
                        <span className="text-sm font-medium text-[var(--text-secondary)]">
                          {getZoneLabel(p.availabilityZone)}
                        </span>
                      </TableCell>

                      {/* Health badge */}
                      <TableCell className="py-3">
                        <StatusBadge label={healthStr} />
                      </TableCell>

                      {/* State badge */}
                      <TableCell className="py-3">
                        <StatusBadge label={p.state} />
                      </TableCell>

                      {/* Capacity */}
                      <TableCell className="py-3 text-right">
                        {p.capacityTiB != null
                          ? <span className="font-mono text-sm text-[var(--text-primary)]">{p.capacityTiB.toFixed(2)} TiB</span>
                          : <span className="text-[var(--text-dim)]">—</span>
                        }
                      </TableCell>

                      {/* BLS Key */}
                      <TableCell className="py-3 pr-4">
                        {bls ? (
                          <div className="flex flex-col gap-0.5">
                            <MonoValue
                              value={bls}
                              truncate
                              copyable
                              className="max-w-[160px]"
                            />
                            {p.netAddress && (
                              <span className="text-[10px] font-mono text-[var(--text-dim)]">{p.netAddress}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--text-dim)]">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}