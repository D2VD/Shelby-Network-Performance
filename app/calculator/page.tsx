// app/calculator/page.tsx
// Shelby Economics Calculator — v3.0
// Full redesign per calculator.md spec:
//   1.  Duration: pill-button segmented control replaces slider
//   2.  Larger size input, aligned unit selector
//   3.  Estimated Cost card: hero number, dominant visual focus
//   4.  Workflow: Parameters → Cost → Breakdown → Chart → Comparison → Actions
//   5.  Breakdown: 6 metric stat-cards in responsive grid
//   6.  Cost chart: CSS-animated horizontal bar chart (no extra deps)
//   7.  Network info: 5 stat-cards in a row
//   8.  Post-calc action buttons
//   9.  Uniform gap-6 / p-6 spacing
//   10. Two-column desktop, single-column mobile

"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HardDrive, Server, Calculator, TrendingUp, Info,
  ExternalLink, BookOpen, ChevronRight, BarChart2,
} from "lucide-react";

// ── On-chain constants ─────────────────────────────────────────────────────────
const MICRO_SUSD_PER_CHUNK_PER_EPOCH = 42;
const SP_MICRO_SUSD_PER_CHUNK        = 39;
const CHUNK_SIZE_BYTES               = 1_048_576;   // 1 MiB assumed
const EPOCHS_PER_DAY                 = 1;
const MAX_STAKE_APT                  = 10_000_000;

interface Competitor {
  name:       string;
  usdPerGBmo: number | null;
  model:      string;
  note:       string;
  color:      string;
}
const COMPETITORS: Competitor[] = [
  { name: "Shelby",        usdPerGBmo: null,   model: "Monthly",   note: "Decentralised, cryptographic guarantees", color: "#10b981" },
  { name: "AWS S3",        usdPerGBmo: 0.023,  model: "Monthly",   note: "Standard, us-east-1",                    color: "#6b7280" },
  { name: "Cloudflare R2", usdPerGBmo: 0.015,  model: "Monthly",   note: "No egress fees",                         color: "#6b7280" },
  { name: "Backblaze B2",  usdPerGBmo: 0.006,  model: "Monthly",   note: "Cheapest S3-compatible",                 color: "#6b7280" },
  { name: "Arweave",       usdPerGBmo: null,   model: "One-time",  note: "~$4.00/GB upfront",                      color: "#6b7280" },
  { name: "Filecoin",      usdPerGBmo: 0.0002, model: "Monthly",   note: "Variable, deal-based",                   color: "#6b7280" },
  { name: "IPFS (pinned)", usdPerGBmo: 0.10,   model: "Monthly",   note: "Via Pinata / NFT.Storage",               color: "#6b7280" },
];

// ── Duration presets ───────────────────────────────────────────────────────────
const DURATION_PRESETS = [
  { label: "7d",  days: 7   },
  { label: "1mo", days: 30  },
  { label: "3mo", days: 90  },
  { label: "6mo", days: 180 },
  { label: "1yr", days: 365 },
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function num(v: number, decimals = 2): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function bytesToDisplay(bytes: number): string {
  if (bytes >= 1e12) return `${num(bytes / 1e12, 2)} TB`;
  if (bytes >= 1e9)  return `${num(bytes / 1e9,  2)} GB`;
  if (bytes >= 1e6)  return `${num(bytes / 1e6,  2)} MB`;
  return `${num(bytes / 1e3, 2)} KB`;
}

// ── Calculation engines ────────────────────────────────────────────────────────
interface StorageCostResult {
  chunks:         number;
  epochs:         number;
  totalMicroSUSD: number;
  totalSUSD:      number;
  perMonthSUSD:   number;
  perGBMonthSUSD: number;
  gbDecimal:      number;
}
function calcStorageCost(sizeBytes: number, durationDays: number): StorageCostResult {
  const chunks         = Math.ceil(sizeBytes / CHUNK_SIZE_BYTES);
  const epochs         = Math.ceil(durationDays * EPOCHS_PER_DAY);
  const totalMicroSUSD = chunks * epochs * MICRO_SUSD_PER_CHUNK_PER_EPOCH;
  const totalSUSD      = totalMicroSUSD / 1_000_000;
  const perMonthSUSD   = durationDays > 0 ? (totalSUSD / durationDays) * 30 : 0;
  const gbDecimal      = sizeBytes / 1e9;
  const perGBMonthSUSD = gbDecimal > 0 && perMonthSUSD > 0 ? perMonthSUSD / gbDecimal : 0;
  return { chunks, epochs, totalMicroSUSD, totalSUSD, perMonthSUSD, perGBMonthSUSD, gbDecimal };
}

interface SPRewardResult {
  stakeNormalized:    number;
  chunksAllocated:    number;
  rewardPerEpochSUSD: number;
  rewardPerDaySUSD:   number;
  rewardPerMonthSUSD: number;
  rewardPerYearSUSD:  number;
  breakEvenDays:      number | null;
}
function calcSPRewards(stakeApt: number, chunksAllocated: number): SPRewardResult {
  const stakeNormalized    = Math.min(stakeApt / MAX_STAKE_APT, 1);
  const rewardPerEpochSUSD = (chunksAllocated * SP_MICRO_SUSD_PER_CHUNK) / 1_000_000;
  const rewardPerDaySUSD   = rewardPerEpochSUSD * EPOCHS_PER_DAY;
  const rewardPerMonthSUSD = rewardPerDaySUSD * 30;
  const rewardPerYearSUSD  = rewardPerDaySUSD * 365;
  const stakeValueSUSD     = stakeApt * 10; // placeholder 1 APT = 10 sUSD
  const breakEvenDays      = rewardPerDaySUSD > 0
    ? Math.round(stakeValueSUSD / rewardPerDaySUSD) : null;
  return {
    stakeNormalized, chunksAllocated,
    rewardPerEpochSUSD, rewardPerDaySUSD, rewardPerMonthSUSD, rewardPerYearSUSD, breakEvenDays,
  };
}

// ── Shared sub-components ──────────────────────────────────────────────────────

/** Single stat card for the Breakdown grid */
function StatCard({
  label, value, sub, accent = false,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 space-y-1 ${accent ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800" : "bg-muted/30"}`}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold font-mono leading-tight ${accent ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Duration pill button row */
function DurationPills({
  days, onChange,
}: {
  days: number; onChange: (d: number) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");

  const isPreset = DURATION_PRESETS.some((p) => p.days === days);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {DURATION_PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => { onChange(p.days); setCustom(false); }}
            className={`
              px-3 py-1.5 rounded-md text-sm font-medium border transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${days === p.days && !custom
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-foreground/20"
              }
            `}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setCustom(true)}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium border transition-all
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            ${custom || (!isPreset)
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-foreground/20"
            }
          `}
        >
          Custom
        </button>
      </div>

      {(custom || !isPreset) && (
        <div className="flex items-center gap-2 pt-0.5">
          <Input
            type="number"
            min={1}
            max={3650}
            placeholder="Days"
            value={customVal}
            onChange={(e) => {
              setCustomVal(e.target.value);
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n) && n > 0) onChange(n);
            }}
            className="w-28 h-8 text-sm"
          />
          <span className="text-sm text-muted-foreground">days</span>
          {days > 0 && <span className="text-xs text-muted-foreground font-medium">= {days} epochs</span>}
        </div>
      )}
    </div>
  );
}

/** CSS-animated horizontal bar chart for cost comparison */
function CostBarChart({
  shelbyTotalSUSD,
  gbDecimal,
  days,
}: {
  shelbyTotalSUSD: number;
  gbDecimal:       number;
  days:            number;
}) {
  const bars = COMPETITORS.map((c) => {
    if (c.name === "Shelby") return { name: "Shelby", cost: shelbyTotalSUSD, note: "sUSD*", isShelby: true };
    if (c.usdPerGBmo === null) return { name: c.name, cost: 4 * gbDecimal, note: "USD (est.)", isShelby: false };
    return { name: c.name, cost: c.usdPerGBmo * gbDecimal * (days / 30), note: "USD", isShelby: false };
  }).filter((b) => b.cost > 0);

  const maxCost = Math.max(...bars.map((b) => b.cost), 0.0001);

  return (
    <div className="space-y-2.5">
      {bars.map((bar) => {
        const pct = Math.round((bar.cost / maxCost) * 100);
        return (
          <div key={bar.name} className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
            <span className={`text-sm font-medium text-right truncate ${bar.isShelby ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
              {bar.name}
            </span>
            <div className="h-6 bg-muted rounded-sm overflow-hidden">
              <div
                className={`h-full rounded-sm transition-all duration-700 ease-out ${bar.isShelby ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <span className={`text-xs font-mono tabular-nums w-32 text-right ${bar.isShelby ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-muted-foreground"}`}>
              {bar.cost < 0.0001 ? "< 0.0001" : num(bar.cost, 4)} {bar.note}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Post-calculation action buttons */
function CalcActions({ onSwitchToSP }: { onSwitchToSP?: () => void }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <Button variant="outline" size="sm" asChild>
        <a href="/explorer" className="flex items-center gap-1.5">
          <ExternalLink className="h-3.5 w-3.5" />
          Open Explorer
        </a>
      </Button>
      {onSwitchToSP && (
        <Button variant="outline" size="sm" onClick={onSwitchToSP}>
          <Server className="h-3.5 w-3.5 mr-1.5" />
          Estimate SP Rewards
        </Button>
      )}
      <Button variant="outline" size="sm" asChild>
        <a
          href="https://docs.shelby.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Documentation
        </a>
      </Button>
    </div>
  );
}

// ── StorageCostTab ─────────────────────────────────────────────────────────────

function StorageCostTab({ onSwitchToSP }: { onSwitchToSP: () => void }) {
  const [sizeValue, setSizeValue] = useState(1);
  const [sizeUnit, setSizeUnit]   = useState<"MB" | "GB" | "TB">("GB");
  const [days, setDays]           = useState(30);

  const unitBytes: Record<"MB" | "GB" | "TB", number> = { MB: 1e6, GB: 1e9, TB: 1e12 };
  const sizeBytes = sizeValue * unitBytes[sizeUnit];
  const result    = calcStorageCost(sizeBytes, days);

  return (
    <div className="space-y-6">

      {/* ── 1. Parameters + Cost ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Parameters */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <h3 className="font-semibold flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Storage Parameters
          </h3>

          {/* Size input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Storage Size</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0.01}
                step={0.1}
                value={sizeValue}
                onChange={(e) => setSizeValue(Math.max(0.01, Number(e.target.value)))}
                className="w-36 h-10 text-base"
              />
              <Select value={sizeUnit} onValueChange={(v) => setSizeUnit(v as "MB" | "GB" | "TB")}>
                <SelectTrigger className="w-20 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                  <SelectItem value="TB">TB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              = {bytesToDisplay(sizeBytes)} · {result.chunks.toLocaleString("en-US")} chunks
            </p>
          </div>

          {/* Duration */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">
              Duration
              <span className="ml-2 font-normal text-muted-foreground">
                {days} {days === 1 ? "day" : "days"}
                {days >= 30 ? ` (${num(days / 30, 1)} mo)` : ""}
              </span>
            </Label>
            <DurationPills days={days} onChange={setDays} />
          </div>
        </div>

        {/* Estimated Cost — hero card */}
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-6 space-y-5 flex flex-col">
          <h3 className="font-semibold text-base text-emerald-800 dark:text-emerald-300">
            Estimated Cost
          </h3>

          {/* Hero number */}
          <div className="flex-1 flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-widest text-emerald-600/70 dark:text-emerald-500 mb-2">
              Total for {days} days · {bytesToDisplay(sizeBytes)}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold font-mono tracking-tight text-emerald-900 dark:text-emerald-100 leading-none">
                {num(result.totalSUSD, 4)}
              </span>
              <span className="text-base text-emerald-700 dark:text-emerald-400 font-medium">
                sUSD
              </span>
            </div>
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-emerald-200 dark:border-emerald-800">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-xl font-bold font-mono">{num(result.perMonthSUSD, 4)}</p>
              <p className="text-xs text-muted-foreground">sUSD / mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per GB / mo</p>
              <p className="text-xl font-bold font-mono">{num(result.perGBMonthSUSD, 6)}</p>
              <p className="text-xs text-muted-foreground">sUSD</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            42 µShelbyUSD · chunk⁻¹ · epoch⁻¹ · 1 epoch = 1 day
          </p>
        </div>
      </div>

      {/* ── 2. Calculation Breakdown — stat cards ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          Calculation Breakdown
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Storage Size"    value={bytesToDisplay(sizeBytes)} />
          <StatCard label="Chunk Size"      value="1 MiB"                    sub="assumed" />
          <StatCard label="Chunks"          value={result.chunks.toLocaleString("en-US")} />
          <StatCard label="Epochs"          value={result.epochs.toLocaleString("en-US")} sub="1 epoch = 1 day" />
          <StatCard label="Rate"            value="42 µsUSD"                 sub="per chunk / epoch" />
          <StatCard label="Total µShelbyUSD" value={result.totalMicroSUSD.toLocaleString("en-US")} accent />
        </div>
      </div>

      {/* ── 3. Cost Chart ── */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-1.5">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Cost Comparison — {days}-day period · {bytesToDisplay(sizeBytes)}
        </h3>
        <div className="rounded-lg border p-5">
          <CostBarChart
            shelbyTotalSUSD={result.totalSUSD}
            gbDecimal={result.gbDecimal}
            days={days}
          />
          <p className="text-xs text-muted-foreground mt-4">
            * ShelbyUSD ≠ USD — exchange rate not established. Arweave shown as one-time cost spread over period. Comparison is directional only.
          </p>
        </div>
      </div>

      {/* ── 4. Price Comparison Table ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Detailed Comparison</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="min-w-[130px]">Provider</TableHead>
                <TableHead className="min-w-[90px]">Model</TableHead>
                <TableHead className="text-right min-w-[170px]">Est. Cost</TableHead>
                <TableHead className="text-right min-w-[140px]">Per GB/mo</TableHead>
                <TableHead className="min-w-[210px]">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-emerald-50/60 dark:bg-emerald-950/10">
                <TableCell className="font-semibold">
                  <Badge variant="default" className="mr-1.5">Shelby</Badge>
                </TableCell>
                <TableCell className="text-sm">Monthly</TableCell>
                <TableCell className="text-right font-mono font-semibold text-emerald-700 text-sm">
                  {num(result.totalSUSD, 4)} sUSD*
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {num(result.perGBMonthSUSD, 6)} sUSD*
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Decentralised, cryptographic guarantees
                </TableCell>
              </TableRow>
              {COMPETITORS.filter((c) => c.name !== "Shelby").map((c) => {
                const totalCost = c.usdPerGBmo !== null
                  ? c.usdPerGBmo * result.gbDecimal * (days / 30) : null;
                return (
                  <TableRow key={c.name} className="hover:bg-muted/20">
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.model}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {totalCost !== null ? `$${num(totalCost, 4)}` : "Variable"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {c.usdPerGBmo !== null ? `$${c.usdPerGBmo}` : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.note}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          * ShelbyUSD ≠ USD. Chunk size (1 MiB) pending contract confirmation.
        </p>
      </div>

      {/* ── 5. Actions ── */}
      <div className="pt-1 border-t">
        <p className="text-xs text-muted-foreground mb-3 font-medium">Next steps</p>
        <CalcActions onSwitchToSP={onSwitchToSP} />
      </div>

    </div>
  );
}

// ── SPEconomicsTab ─────────────────────────────────────────────────────────────

function SPEconomicsTab() {
  const [stakeApt, setStakeApt] = useState(1000);
  const [chunks, setChunks]     = useState(10000);

  const result      = calcSPRewards(stakeApt, chunks);
  const projections = [
    { label: "1 Month",  value: result.rewardPerMonthSUSD },
    { label: "3 Months", value: result.rewardPerMonthSUSD * 3 },
    { label: "6 Months", value: result.rewardPerMonthSUSD * 6 },
    { label: "1 Year",   value: result.rewardPerYearSUSD },
  ];

  return (
    <div className="space-y-6">

      {/* ── 1. Parameters + Rewards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Parameters */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <h3 className="font-semibold flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-muted-foreground" />
            SP Parameters
          </h3>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Stake Amount (APT)</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={10}
                step={10}
                value={stakeApt}
                onChange={(e) => setStakeApt(Math.max(10, Number(e.target.value)))}
                className="w-40 h-10 text-base"
              />
              <span className="text-sm text-muted-foreground font-mono">
                {num(stakeApt * 1e8, 0)} octas
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Min: 1 APT · Max: 10,000,000 APT</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Chunks Allocated per Epoch</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={1}
                step={100}
                value={chunks}
                onChange={(e) => setChunks(Math.max(1, Number(e.target.value)))}
                className="w-40 h-10 text-base"
              />
              <span className="text-sm text-muted-foreground">
                ≈ {bytesToDisplay(chunks * CHUNK_SIZE_BYTES)} stored
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Depends on network demand and SP quota. Estimate only.
            </p>
          </div>
        </div>

        {/* Estimated Rewards — hero card */}
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-6 space-y-5 flex flex-col">
          <h3 className="font-semibold text-base text-blue-800 dark:text-blue-300">
            Estimated Rewards
          </h3>

          <div className="flex-1 flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-widest text-blue-600/70 dark:text-blue-500 mb-2">
              Per epoch (1 day)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-bold font-mono tracking-tight text-blue-900 dark:text-blue-100 leading-none">
                {num(result.rewardPerEpochSUSD, 4)}
              </span>
              <span className="text-base text-blue-700 dark:text-blue-400 font-medium">sUSD</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-blue-200 dark:border-blue-800">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-xl font-bold font-mono">{num(result.rewardPerMonthSUSD, 2)}</p>
              <p className="text-xs text-muted-foreground">sUSD / mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Break-even</p>
              <p className="text-xl font-bold font-mono">
                {result.breakEvenDays !== null
                  ? result.breakEvenDays.toLocaleString("en-US")
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">days (est.)</p>
            </div>
          </div>

          <div className="pt-1 border-t border-blue-200 dark:border-blue-800">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per year</p>
              <p className="text-2xl font-bold font-mono">{num(result.rewardPerYearSUSD, 2)}</p>
              <p className="text-xs text-muted-foreground">sUSD / yr</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            39 µsUSD / chunk / epoch (SP share) · break-even at 1 APT = 10 sUSD placeholder
          </p>
        </div>
      </div>

      {/* ── 2. Breakdown stat cards ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          Economics Breakdown
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Stake"          value={`${stakeApt.toLocaleString("en-US")} APT`} />
          <StatCard label="Chunks/epoch"   value={chunks.toLocaleString("en-US")} />
          <StatCard label="SP rate"        value="39 µsUSD"   sub="per chunk / epoch" />
          <StatCard label="Daily reward"   value={`${num(result.rewardPerDaySUSD, 4)} sUSD`} />
          <StatCard label="Monthly"        value={`${num(result.rewardPerMonthSUSD, 2)} sUSD`} />
          <StatCard label="Yearly"         value={`${num(result.rewardPerYearSUSD, 2)} sUSD`} accent />
        </div>
      </div>

      {/* ── 3. Revenue Projections ── */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Revenue Projections</h3>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Cumulative Reward (sUSD)</TableHead>
                <TableHead className="text-right">Stake Coverage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projections.map((p) => {
                const stakeValueSUSD = stakeApt * 10;
                const coveragePct    = stakeValueSUSD > 0 ? (p.value / stakeValueSUSD) * 100 : 0;
                return (
                  <TableRow key={p.label} className="hover:bg-muted/20">
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(p.value, 2)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={coveragePct >= 100 ? "default" : "secondary"}>
                        {num(coveragePct, 1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Stake coverage = cumulative rewards ÷ stake value (1 APT = 10 sUSD placeholder). Rates TBD for mainnet.
        </p>
      </div>

      {/* ── 4. Disclaimer + actions ── */}
      <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 px-4 py-3 flex gap-3 text-sm">
        <Info className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
        <p className="text-yellow-800 dark:text-yellow-300">
          Estimates based on testnet constants and a placeholder APT/ShelbyUSD rate.
          Chunk allocation depends on network demand.{" "}
          <strong>Do not use for financial planning.</strong>
        </p>
      </div>

      <div className="pt-1 border-t">
        <p className="text-xs text-muted-foreground mb-3 font-medium">Next steps</p>
        <CalcActions />
      </div>

    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function CalculatorPage() {
  const [activeTab, setActiveTab] = useState("storage");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* ── Header ── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Calculator className="h-7 w-7 text-muted-foreground shrink-0" />
            <h1 className="text-4xl font-bold tracking-tight">
              Shelby Economics Calculator
            </h1>
          </div>
          <p className="text-base text-muted-foreground pl-10">
            Estimate storage costs and SP rewards based on live on-chain parameters.
          </p>
        </div>

        {/* ── Network info — 5 stat cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: "Rate",            value: "42 µsUSD",   sub: "per chunk / epoch" },
            { label: "SP Share",        value: "39 µsUSD",   sub: "admin gets 3 µ" },
            { label: "Payment Epoch",   value: "1 day",      sub: "86,400 seconds" },
            { label: "Staking Epoch",   value: "7 days",     sub: "604,800 seconds" },
            { label: "Network",         value: "Testnet",    sub: "0x85fdb9a…988e6a" },
          ].map((card) => (
            <div key={card.label} className="rounded-lg border bg-card px-4 py-3 space-y-0.5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                {card.label}
              </p>
              <p className="text-sm font-bold font-mono leading-snug">{card.value}</p>
              {card.sub && <p className="text-xs text-muted-foreground">{card.sub}</p>}
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="storage" className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" /> Storage Cost
            </TabsTrigger>
            <TabsTrigger value="sp" className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> SP Economics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="storage">
            <StorageCostTab onSwitchToSP={() => setActiveTab("sp")} />
          </TabsContent>
          <TabsContent value="sp">
            <SPEconomicsTab />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}