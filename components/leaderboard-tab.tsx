// components/leaderboard-tab.tsx
// SP Performance Leaderboard — Phase 3 Week 4 (B1)
// v1.0

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trophy, TrendingUp, Zap } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type SortKey = "score" | "uptime" | "stake";

interface LeaderboardEntry {
  rank: number;
  address: string;
  az: string;
  condition: number;
  stake: string;
  uptimePct: number;
  reputationScore: number;
  firstSeen: string;
  lastSeen: string;
}

interface LeaderboardResponse {
  network: string;
  sort: SortKey;
  count: number;
  generatedAt: string;
  leaderboard: LeaderboardEntry[];
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
  if (isNaN(n)) return "—";
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

function conditionLabel(condition: number): { label: string; variant: "default" | "secondary" | "destructive" } {
  // condition=0 → Healthy; condition=1 → Faulty (per project rules: no grace period)
  if (condition === 0) return { label: "Healthy", variant: "default" };
  return { label: "Faulty", variant: "destructive" };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface LeaderboardTabProps {
  initialNetwork?: "shelbynet" | "testnet";
}

export function LeaderboardTab({ initialNetwork = "testnet" }: LeaderboardTabProps) {
  const [network, setNetwork] = useState<"shelbynet" | "testnet">(initialNetwork);
  const [sort, setSort] = useState<SortKey>("score");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select
            value={network}
            onValueChange={(v) => setNetwork(v as "shelbynet" | "testnet")}
          >
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={fetchLeaderboard}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Score formula callout */}
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
                const cond = conditionLabel(entry.condition);
                return (
                  <TableRow
                    key={entry.address}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    {/* Rank */}
                    <TableCell className="text-center font-mono text-sm font-medium">
                      {rankIcon(entry.rank)}
                      {entry.rank}
                    </TableCell>

                    {/* Address */}
                    <TableCell className="font-mono text-xs">
                      <a
                        href={`https://explorer.aptoslabs.com/account/${entry.address}?network=testnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline text-blue-600 dark:text-blue-400"
                        title={entry.address}
                      >
                        {shortAddress(str(entry.address))}
                      </a>
                    </TableCell>

                    {/* AZ */}
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">
                        {str(entry.az) || "—"}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell className="text-center">
                      <Badge variant={cond.variant} className="text-xs">
                        {cond.label}
                      </Badge>
                    </TableCell>

                    {/* Stake */}
                    <TableCell className="text-right text-sm font-mono">
                      {stakeToApt(str(entry.stake))}
                    </TableCell>

                    {/* Uptime */}
                    <TableCell className="text-right text-sm">
                      <span className={entry.uptimePct >= 95 ? "text-emerald-600" : entry.uptimePct >= 80 ? "text-yellow-600" : "text-red-500"}>
                        {num(entry.uptimePct, 1)}%
                      </span>
                    </TableCell>

                    {/* Score */}
                    <TableCell className="text-right">
                      <Badge
                        variant={scoreBadgeVariant(entry.reputationScore)}
                        className="tabular-nums font-semibold"
                      >
                        <span className={scoreColor(entry.reputationScore)}>
                          {num(entry.reputationScore, 0)}
                        </span>
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Footer meta */}
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