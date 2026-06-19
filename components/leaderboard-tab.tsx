"use client";
// components/leaderboard-tab.tsx — v1.0
// SP Performance Leaderboard (Roadmap B1 — Phase 4 simplified)
// Self-contained: fetches /api/network/leaderboard, renders ranked SP table.
// Reputation score formula: uptime(70%) + stake_normalized(30%)
// Drop into /explorer?tab=leaderboard or any other page.

import { useEffect, useState, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = "score" | "uptime" | "stake";
type Network = "shelbynet" | "testnet";

interface SpLeaderboardEntry {
  rank: number;
  address: string;
  az: string;
  uptime_pct: number;
  healthy_snapshots: number;
  total_snapshots: number;
  current_health: string;
  stake_octas: string;
  stake_apt: string;
  last_seen: string;
  reputation_score: number;
}

interface LeaderboardResponse {
  leaderboard: SpLeaderboardEntry[];
  count: number;
  total: number;
  network: string;
  sort: string;
  generatedAt: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeaderboardTabProps {
  /** Network selected externally (e.g. from a shared network context). */
  initialNetwork?: Network;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (score >= 75) return "text-blue-600 bg-blue-50 border-blue-200";
  if (score >= 55) return "text-yellow-600 bg-yellow-50 border-yellow-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function rankBadge(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank);
}

// Derive a consistent pastel background for an AZ name
function azColor(az: string): string {
  const colors: Record<string, string> = {
    "AR-0":       "bg-purple-100 text-purple-700",
    "AR-1":       "bg-purple-100 text-purple-700",
    "Duoro-0":    "bg-cyan-100 text-cyan-700",
    "Jump-AMS-0": "bg-orange-100 text-orange-700",
    "Jump-AMS-1": "bg-orange-100 text-orange-700",
    "Jump-LON-0": "bg-rose-100 text-rose-700",
    "Jump-LON-1": "bg-rose-100 text-rose-700",
    "Nova-0":     "bg-indigo-100 text-indigo-700",
    "Republic-0": "bg-teal-100 text-teal-700",
    "Stakely-0":  "bg-green-100 text-green-700",
  };
  return colors[az] ?? "bg-gray-100 text-gray-700";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function UptimeBar({ pct }: { pct: number }) {
  const color =
    pct >= 95
      ? "bg-emerald-500"
      : pct >= 80
      ? "bg-blue-500"
      : pct >= 60
      ? "bg-yellow-500"
      : "bg-red-500";

  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-gray-600 w-12 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function HealthBadge({ health }: { health: string }) {
  const isHealthy = health === "Healthy";
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${
        isHealthy
          ? "text-emerald-700 bg-emerald-50 border-emerald-200"
          : "text-red-700 bg-red-50 border-red-200"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          isHealthy ? "bg-emerald-500" : "bg-red-500"
        }`}
      />
      {health}
    </span>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900"
      }`}
    >
      {label}
    </button>
  );
}

function NetworkToggle({
  value,
  onChange,
}: {
  value: Network;
  onChange: (n: Network) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      {(["shelbynet", "testnet"] as Network[]).map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`px-3 py-1 text-sm rounded-md transition-colors capitalize ${
            value === n
              ? "bg-white text-gray-900 shadow-sm font-medium"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {n === "shelbynet" ? "Shelbynet" : "Testnet"}
        </button>
      ))}
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-gray-50">
          {Array.from({ length: 7 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-gray-100 rounded animate-pulse w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LeaderboardTab({ initialNetwork = "shelbynet" }: LeaderboardTabProps) {
  const [network, setNetwork] = useState<Network>(initialNetwork);
  const [sort, setSort] = useState<SortKey>("score");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLeaderboard = useCallback(
    async (net: Network, sortKey: SortKey, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/network/leaderboard?network=${net}&sort=${sortKey}&limit=50`,
          { signal }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json: LeaderboardResponse = await res.json();
        setData(json);
        setLastRefreshed(new Date().toLocaleTimeString("en-US", { hour12: false }));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load leaderboard");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch on network/sort change; refresh every 5 minutes
  useEffect(() => {
    const controller = new AbortController();

    fetchLeaderboard(network, sort, controller.signal);

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(
      () => fetchLeaderboard(network, sort, controller.signal),
      5 * 60 * 1000
    );

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [network, sort, fetchLeaderboard]);

  // Copy address to clipboard
  const copyAddress = useCallback((addr: string) => {
    navigator.clipboard.writeText(addr).then(() => {
      setCopiedAddr(addr);
      setTimeout(() => setCopiedAddr(null), 1500);
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            SP Performance Leaderboard
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Ranked by reputation score — 30-day uptime window
            {lastRefreshed && (
              <span className="ml-2 text-gray-400">· Refreshed {lastRefreshed}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <NetworkToggle value={network} onChange={setNetwork} />
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Sort by:</span>
        <SortButton
          label="Reputation Score"
          active={sort === "score"}
          onClick={() => setSort("score")}
        />
        <SortButton
          label="Uptime"
          active={sort === "uptime"}
          onClick={() => setSort("uptime")}
        />
        <SortButton
          label="Stake"
          active={sort === "stake"}
          onClick={() => setSort("stake")}
        />

        {data && !loading && (
          <span className="ml-auto text-sm text-gray-400">
            {data.count} of {data.total} providers
          </span>
        )}
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Error loading leaderboard:</strong> {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-center w-12">
                  Rank
                </th>
                <th className="px-4 py-3 font-medium text-gray-500">Address</th>
                <th className="px-4 py-3 font-medium text-gray-500">Zone</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-center">
                  Score
                </th>
                <th className="px-4 py-3 font-medium text-gray-500">
                  Uptime (30d)
                </th>
                <th className="px-4 py-3 font-medium text-gray-500 text-right">
                  Stake (APT)
                </th>
                <th className="px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-right pr-5">
                  Last Seen
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <SkeletonRows />
              ) : !data || data.leaderboard.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-gray-400 text-sm"
                  >
                    No data available for{" "}
                    <span className="font-medium">{network}</span>
                  </td>
                </tr>
              ) : (
                data.leaderboard.map((sp) => (
                  <tr
                    key={sp.address}
                    className="hover:bg-gray-50/60 transition-colors"
                  >
                    {/* Rank */}
                    <td className="px-4 py-3 text-center font-mono text-gray-600">
                      {sp.rank <= 3 ? (
                        <span className="text-base">{rankBadge(sp.rank)}</span>
                      ) : (
                        <span className="text-xs text-gray-400 tabular-nums">
                          #{sp.rank}
                        </span>
                      )}
                    </td>

                    {/* Address */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-700">
                          {truncateAddress(sp.address)}
                        </span>
                        <button
                          onClick={() => copyAddress(sp.address)}
                          title="Copy full address"
                          className="text-gray-300 hover:text-gray-600 transition-colors"
                        >
                          {copiedAddr === sp.address ? (
                            <CheckIcon />
                          ) : (
                            <CopyIcon />
                          )}
                        </button>
                      </div>
                    </td>

                    {/* AZ badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${azColor(
                          sp.az
                        )}`}
                      >
                        {sp.az}
                      </span>
                    </td>

                    {/* Reputation score */}
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block min-w-[42px] px-2 py-0.5 rounded border text-xs font-semibold tabular-nums ${scoreColor(
                          sp.reputation_score
                        )}`}
                      >
                        {sp.reputation_score}
                      </span>
                    </td>

                    {/* Uptime bar */}
                    <td className="px-4 py-3">
                      <UptimeBar pct={sp.uptime_pct} />
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {sp.healthy_snapshots.toLocaleString("en-US")} /{" "}
                        {sp.total_snapshots.toLocaleString("en-US")} checks
                      </span>
                    </td>

                    {/* Stake */}
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700 font-mono text-xs">
                      {sp.stake_apt}
                    </td>

                    {/* Health */}
                    <td className="px-4 py-3">
                      <HealthBadge health={sp.current_health} />
                    </td>

                    {/* Last seen */}
                    <td className="px-4 py-3 text-right pr-5 text-xs text-gray-400">
                      {relativeTime(sp.last_seen)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        {data && !loading && data.leaderboard.length > 0 && (
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>
              Score = uptime (70%) + normalized stake (30%) · Updates every 5 minutes
            </span>
            <span>
              Generated {new Date(data.generatedAt).toLocaleTimeString("en-US", {
                hour12: false,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline micro-icons (no lucide-react dependency) ─────────────────────────

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-500"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}