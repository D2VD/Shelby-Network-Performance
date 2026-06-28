// components/leaderboard-tab.tsx
// SP Performance Leaderboard — Phase 3 Week 4 (B1)
// v1.1 — Defensive field reads: handles both camelCase (v1.2 backend) and
//   snake_case (older compiled dist), ensuring fields never silently resolve
//   to undefined. Fixes "all Faulty / all —" display when API naming drifts.

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trophy, TrendingUp, Zap } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type SortKey = "score" | "uptime" | "stake";

interface LeaderboardEntry {
  rank:            number;
  address:         string;
  az:              string;
  condition:       number;       // 0=Healthy, 1=Faulty
  stake:           string;       // octas string
  uptimePct:       number;
  reputationScore: number;
  firstSeen:       string;
  lastSeen:        string;
  // snake_case fallback fields (older dist may still emit these)
  uptime_pct?:        number;
  reputation_score?:  number;
  stake_octas?:       string;
  current_health?:    string;
}

interface LeaderboardResponse {
  network:     string;
  sort:        SortKey;
  count:       number;
  generatedAt: string;
  leaderboard: LeaderboardEntry[];
}

// ── Defensive field reads ──────────────────────────────────────────────────────
// API may return camelCase (v1.2) or snake_case (pre-v1.2 dist).
// Always prefer camelCase; fall back to snake_case; then use safe default.

function getCondition(e: LeaderboardEntry): number {
  if (e.condition !== undefined) return e.condition;
  // fall back to string health field if old dist is running
  if (e.current_health !== undefined) return e.current_health === "Healthy" ? 0 : 1;
  return 1; // safe default — show Faulty rather than silently hide
}

function getStake(e: LeaderboardEntry): string {
  if (e.stake !== undefined && e.stake !== null) return String(e.stake);
  if (e.stake_octas !== undefined && e.stake_octas !== null) return String(e.stake_octas);
  return "0";
}

function getUptimePct(e: LeaderboardEntry): number {
  const v = e.uptimePct ?? e.uptime_pct;
  return typeof v === "number" ? v : 0;
}

function getScore(e: LeaderboardEntry): number {
  const v = e.reputationScore ?? e.reputation_score;
  return typeof v === "number" ? v : 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

function num(v: unknown, decimals = 0): string {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function stakeToApt(octas: string): string {
  const n = Number(octas);
  if (isNaN(n) || octas === "—") return "—";
  if (n === 0) return "0.00 APT";
  return num(n / 1e8, 2) + " APT";
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-500";
}

function scoreBadgeVariant(score: number): "default" | "secondary" | "destructive" {
  if (score >= 80) return "default";
  if (score >= 60) return "secondary";
  return "destructive";
}

function rankIcon(rank: number) {
  if (rank === 1) return <Trophy className="inline h-4 w-4 text-yellow-500 mr-1" />;
  if (rank === 2) return <Trophy className="inline h-4 w-4 text-gray-400 mr-1" />;
  if (rank === 3) return <Trophy className="inline h-4 w-4 text-amber-700 mr-1" />;
  return null;
}

function conditionLabel(condition: number) {
  if (condition === 0) return { label: "Healthy", variant: "default" as const };
  return { label: "Faulty", variant: "destructive" as const };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface LeaderboardTabProps {
  initialNetwork?: "shelbynet" | "testnet";
}

export function LeaderboardTab({ initialNetwork = "testnet" }: LeaderboardTabProps) {
  const [network, setNetwork]     = useState<"shelbynet" | "testnet">(initialNetwork);
  const [sort, setSort]           = useState<SortKey>("score");
  const [data, setData]           = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/network/leaderboard?network=${network}&sort=${sort}&limit=50`
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
      }
      const json: LeaderboardResponse = await res.json();
      setData(json);
      setLastRefresh(new Date().toLocaleTimeString("en-US"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [network, sort]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={network} onValueChange={(v) => setNetwork(v as "shelbynet" | "testnet")}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shelbynet">Shelbynet</SelectItem>
              <SelectItem value="testnet">Testnet</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">
                <span className="flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> Sort: Reputation Score
                </span>
              </SelectItem>
              <SelectItem value="uptime">
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Sort: Uptime %
                </span>
              </SelectItem>
              <SelectItem value="stake">
                <span className="flex items-center gap-1">
                  <Trophy className="h-3.5 w-3.5" /> Sort: Stake
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {lastRefresh && <span>Updated {lastRefresh}</span>}
          {data && <span>· {data.count} providers</span>}
          <Button variant="ghost" size="sm" className="h-7 px-2"
            onClick={fetchLeaderboard} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Formula callout */}
      <div className="rounded-md bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Reputation Score</span>
        {" "}= Uptime % × 0.70 + Normalized Stake × 0.30 · Updated every 5 min from sp_snapshots
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load leaderboard: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>AZ</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Stake</TableHead>
                <TableHead className="text-right">Uptime (30d)</TableHead>
                <TableHead className="text-right font-semibold">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.leaderboard.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No data available. sp_snapshots may still be populating.
                  </TableCell>
                </TableRow>
              )}
              {data.leaderboard.map((entry) => {
                // Use defensive readers — never undefined regardless of API version
                const condition     = getCondition(entry);
                const stakeOctas    = getStake(entry);
                const uptimePct     = getUptimePct(entry);
                const score         = getScore(entry);
                const cond          = conditionLabel(condition);

                return (
                  <TableRow key={entry.address} className="hover:bg-muted/20 transition-colors">
                    <TableCell className="text-center font-mono text-sm font-medium">
                      {rankIcon(entry.rank)}{entry.rank}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <a
                        href={`https://explorer.aptoslabs.com/account/${entry.address}?network=shelbynet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline text-blue-600 dark:text-blue-400"
                        title={entry.address}
                      >
                        {shortAddress(str(entry.address))}
                      </a>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                        {str(entry.az) || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={cond.variant} className="text-xs">{cond.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {stakeToApt(stakeOctas)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <span className={uptimePct >= 95 ? "text-emerald-600" : uptimePct >= 80 ? "text-yellow-600" : "text-red-500"}>
                        {num(uptimePct, 1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={scoreBadgeVariant(score)} className="tabular-nums font-semibold">
                        <span className={scoreColor(score)}>{num(score, 0)}</span>
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground text-right">
          {data.generatedAt
            ? `Data as of ${new Date(data.generatedAt).toLocaleString("en-US")}`
            : ""}
        </p>
      )}
    </div>
  );
}