// app/calculator/page.tsx
// Cost Calculator — Phase 3 Week 4 (A2)
// Pure frontend — reads PaymentTiers constants derived from on-chain data.
// No new backend routes required.
// v2.0 — Full layout redesign:
//   - max-w-5xl container, desktop two-column grid (parameters + results side-by-side)
//   - Header: text-4xl font-bold
//   - Info bar: 3-column grid (no more long single line)
//   - Estimated Cost card: text-4xl numbers, visually dominant
//   - Price Comparison: min-width columns, readable font sizes
//   - Uniform gap-6 spacing throughout
//   - Tabs aligned to content container edge

"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Server, Calculator, TrendingUp, Info } from "lucide-react";

// ── On-chain constants (from TestnetDataSource.md PaymentTiers) ────────────────
// payment_to_sp_per_chunk_per_epoch:    39 micro ShelbyUSD
// payment_to_admin_per_chunk_per_epoch:  3 micro ShelbyUSD
// Total:                                42 micro ShelbyUSD / chunk / epoch
// Payment epoch duration:   86,400,000,000 µs = 86,400 s = 1 day
// Staking epoch duration: 604,800,000,000 µs = 604,800 s = 7 days
// Max slices per blob: 50
// Encoding: ClayCode_16Total_10Data_13Helper
//   → 16 total nodes, 10 data shards = each shard is blob_size / 10
// Chunk size: derived — assume 1 MiB (1,048,576 bytes) per shard/chunk
//   (not in contract; adjust when confirmed)

const MICRO_SUSD_PER_CHUNK_PER_EPOCH = 42;       // µShelbyUSD
const CHUNK_SIZE_BYTES               = 1_048_576;  // 1 MiB — update when confirmed
const EPOCHS_PER_DAY                 = 1;
const APT_PER_EPOCH                  = 0.0001;    // SP rough estimate placeholder
const MAX_STAKE_APT                  = 10_000_000; // contract: 1e15 octas = 10M APT (approx)

// Comparison providers (per GB per month)
interface Competitor {
  name:       string;
  usdPerGBmo: number | null;   // null = one-time or variable
  model:      string;
  note:       string;
}
const COMPETITORS: Competitor[] = [
  { name: "AWS S3",        usdPerGBmo: 0.023,  model: "Monthly",    note: "Standard storage, us-east-1" },
  { name: "Cloudflare R2", usdPerGBmo: 0.015,  model: "Monthly",    note: "No egress fees" },
  { name: "Backblaze B2",  usdPerGBmo: 0.006,  model: "Monthly",    note: "Cheapest S3-compatible" },
  { name: "Arweave",       usdPerGBmo: null,    model: "One-time",   note: "~$4.00/GB upfront (permanent)" },
  { name: "Filecoin",      usdPerGBmo: 0.0002,  model: "Monthly",   note: "Variable, deal-based" },
  { name: "IPFS (pinned)", usdPerGBmo: 0.10,   model: "Monthly",    note: "Via Pinata / NFT.Storage" },
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

// ── Storage Cost Calculator ────────────────────────────────────────────────────

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

// ── SP Economics Calculator ────────────────────────────────────────────────────

interface SPRewardResult {
  stakeApt:           number;
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
  const rewardPerEpochSUSD = (chunksAllocated * 39) / 1_000_000;
  const rewardPerDaySUSD   = rewardPerEpochSUSD * EPOCHS_PER_DAY;
  const rewardPerMonthSUSD = rewardPerDaySUSD * 30;
  const rewardPerYearSUSD  = rewardPerDaySUSD * 365;

  const SUSD_PER_APT   = 10;
  const stakeValueSUSD = stakeApt * SUSD_PER_APT;
  const breakEvenDays  = rewardPerDaySUSD > 0
    ? Math.round(stakeValueSUSD / rewardPerDaySUSD)
    : null;

  return {
    stakeApt, stakeNormalized, chunksAllocated,
    rewardPerEpochSUSD, rewardPerDaySUSD, rewardPerMonthSUSD, rewardPerYearSUSD, breakEvenDays,
  };
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function StorageCostTab() {
  const [sizeValue, setSizeValue] = useState(1);
  const [sizeUnit, setSizeUnit]   = useState<"MB" | "GB" | "TB">("GB");
  const [days, setDays]           = useState(30);

  const unitBytes: Record<"MB" | "GB" | "TB", number> = {
    MB: 1e6, GB: 1e9, TB: 1e12,
  };

  const sizeBytes = sizeValue * unitBytes[sizeUnit];
  const result    = calcStorageCost(sizeBytes, days);

  return (
    <div className="space-y-6">
      {/* ── Row 1: Parameters + Cost (side-by-side on lg+) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* Storage Parameters */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Storage Parameters
          </h3>

          {/* Size */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">Storage Size</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0.01}
                step={0.1}
                value={sizeValue}
                onChange={(e) => setSizeValue(Math.max(0.01, Number(e.target.value)))}
                className="w-32"
              />
              <Select value={sizeUnit} onValueChange={(v) => setSizeUnit(v as "MB" | "GB" | "TB")}>
                <SelectTrigger className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MB">MB</SelectItem>
                  <SelectItem value="GB">GB</SelectItem>
                  <SelectItem value="TB">TB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">= {bytesToDisplay(sizeBytes)}</p>
          </div>

          {/* Duration */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">
              Duration: <span className="font-bold text-foreground">{days} days</span>
            </Label>
            <Slider
              min={1}
              max={365}
              step={1}
              value={[days]}
              onValueChange={([v]) => setDays(v)}
            />
            <div className="flex gap-4 text-xs text-muted-foreground pt-0.5">
              {[7, 30, 90, 180, 365].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`hover:text-foreground transition-colors ${days === d ? "font-semibold text-foreground" : ""}`}
                >
                  {d === 365 ? "1y" : d === 180 ? "6mo" : d === 90 ? "3mo" : d === 30 ? "1mo" : "1w"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Estimated Cost — visually dominant */}
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 p-6 space-y-5 h-full">
          <h3 className="font-semibold text-base text-emerald-800 dark:text-emerald-400">
            Estimated Cost
          </h3>

          {/* Primary: total cost */}
          <div>
            <p className="text-xs text-emerald-700/70 dark:text-emerald-500 uppercase tracking-wide font-medium mb-1">
              Total cost
            </p>
            <p className="text-4xl font-bold font-mono text-emerald-900 dark:text-emerald-200 leading-none">
              {num(result.totalSUSD, 4)}
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">ShelbyUSD</p>
          </div>

          {/* Secondary metrics */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-emerald-200 dark:border-emerald-800">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-xl font-bold font-mono">{num(result.perMonthSUSD, 4)}</p>
              <p className="text-xs text-muted-foreground">sUSD/mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per GB / month</p>
              <p className="text-xl font-bold font-mono">{num(result.perGBMonthSUSD, 6)}</p>
              <p className="text-xs text-muted-foreground">sUSD</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            42 µShelbyUSD / chunk / epoch · 1 epoch = 1 day · chunk ≈ 1 MiB
          </p>
        </div>
      </div>

      {/* ── Row 2: Calculation Breakdown (full-width) ── */}
      <div className="rounded-lg border bg-muted/30 p-5">
        <p className="text-sm font-semibold mb-3">Calculation Breakdown</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Storage size</span>
            <span className="font-mono font-medium">{bytesToDisplay(sizeBytes)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Chunk size</span>
            <span className="font-mono font-medium">1 MiB</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Chunks required</span>
            <span className="font-mono font-medium">{result.chunks.toLocaleString("en-US")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Epochs (= days)</span>
            <span className="font-mono font-medium">{result.epochs.toLocaleString("en-US")}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Rate / chunk / epoch</span>
            <span className="font-mono font-medium">42 µShelbyUSD</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Total µShelbyUSD</span>
            <span className="font-mono font-medium">{result.totalMicroSUSD.toLocaleString("en-US")}</span>
          </div>
        </div>
      </div>

      {/* ── Row 3: Price Comparison (full-width) ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Price Comparison — {days}-day period, {bytesToDisplay(sizeBytes)}
        </h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="min-w-[130px]">Provider</TableHead>
                <TableHead className="min-w-[90px]">Model</TableHead>
                <TableHead className="text-right min-w-[180px]">Est. Cost (USD)</TableHead>
                <TableHead className="text-right min-w-[150px]">Per GB/mo (USD)</TableHead>
                <TableHead className="min-w-[220px]">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Shelby row */}
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
              {COMPETITORS.map((c) => {
                const totalCost = c.usdPerGBmo !== null
                  ? c.usdPerGBmo * result.gbDecimal * (days / 30)
                  : null;
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
        <p className="text-xs text-muted-foreground">
          * ShelbyUSD ≠ USD — exchange rate not yet established. Comparison is directional only.
          Shelby chunk size (1 MiB assumed) pending contract confirmation.
        </p>
      </div>
    </div>
  );
}

function SPEconomicsTab() {
  const [stakeApt, setStakeApt] = useState(1000);
  const [chunks, setChunks]     = useState(10000);

  const result = calcSPRewards(stakeApt, chunks);

  const projections = [
    { label: "1 Month",  days: 30,  value: result.rewardPerMonthSUSD },
    { label: "3 Months", days: 90,  value: result.rewardPerMonthSUSD * 3 },
    { label: "6 Months", days: 180, value: result.rewardPerMonthSUSD * 6 },
    { label: "1 Year",   days: 365, value: result.rewardPerYearSUSD },
  ];

  return (
    <div className="space-y-6">
      {/* ── Row 1: Parameters + Rewards (side-by-side on lg+) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* SP Parameters */}
        <div className="rounded-lg border bg-card p-6 space-y-6">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            SP Parameters
          </h3>

          {/* Stake */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">Stake Amount (APT)</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={10}
                step={10}
                value={stakeApt}
                onChange={(e) => setStakeApt(Math.max(10, Number(e.target.value)))}
                className="w-40"
              />
              <span className="text-sm text-muted-foreground font-mono">
                {num(stakeApt * 1e8, 0)} octas
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Min: 100,000,000 octas (1 APT) · Max: 10,000,000 APT
            </p>
          </div>

          {/* Chunks */}
          <div className="space-y-2.5">
            <Label className="text-sm font-medium">Chunks Allocated per Epoch</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={1}
                step={100}
                value={chunks}
                onChange={(e) => setChunks(Math.max(1, Number(e.target.value)))}
                className="w-40"
              />
              <span className="text-sm text-muted-foreground">
                ≈ {bytesToDisplay(chunks * CHUNK_SIZE_BYTES)} stored
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Chunk allocation depends on network demand and your quota. This is an estimate.
            </p>
          </div>
        </div>

        {/* Estimated Rewards — visually dominant */}
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-6 space-y-5 h-full">
          <h3 className="font-semibold text-base text-blue-800 dark:text-blue-400">
            Estimated Rewards
          </h3>

          {/* Primary: per epoch */}
          <div>
            <p className="text-xs text-blue-700/70 dark:text-blue-500 uppercase tracking-wide font-medium mb-1">
              Per epoch (1 day)
            </p>
            <p className="text-4xl font-bold font-mono text-blue-900 dark:text-blue-200 leading-none">
              {num(result.rewardPerEpochSUSD, 4)}
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">ShelbyUSD</p>
          </div>

          {/* Secondary */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-blue-200 dark:border-blue-800">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-xl font-bold font-mono">{num(result.rewardPerMonthSUSD, 2)}</p>
              <p className="text-xs text-muted-foreground">sUSD/mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per year</p>
              <p className="text-xl font-bold font-mono">{num(result.rewardPerYearSUSD, 2)}</p>
              <p className="text-xs text-muted-foreground">sUSD/yr</p>
            </div>
          </div>

          {/* Break-even */}
          <div className="pt-1 border-t border-blue-200 dark:border-blue-800">
            <p className="text-xs text-muted-foreground mb-0.5">Break-even estimate</p>
            <p className="text-2xl font-bold font-mono">
              {result.breakEvenDays !== null
                ? result.breakEvenDays.toLocaleString("en-US")
                : "—"}
            </p>
            {result.breakEvenDays !== null && (
              <p className="text-xs text-muted-foreground">days (at 1 APT ≈ 10 sUSD)</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            39 µShelbyUSD / chunk / epoch (SP share, excl. 3 µ admin)
          </p>
        </div>
      </div>

      {/* ── Row 2: Revenue Projections (full-width) ── */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Revenue Projections</h3>
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
                const coveragePct    = stakeValueSUSD > 0
                  ? (p.value / stakeValueSUSD) * 100
                  : 0;
                return (
                  <TableRow key={p.label} className="hover:bg-muted/20">
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {num(p.value, 2)}
                    </TableCell>
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
        <p className="text-xs text-muted-foreground">
          Stake coverage = cumulative rewards ÷ stake value (at 1 APT = 10 sUSD placeholder rate).
          Actual rates TBD for mainnet.
        </p>
      </div>

      {/* ── Row 3: Disclaimer ── */}
      <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 px-4 py-3 flex gap-3 text-sm">
        <Info className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
        <p className="text-yellow-800 dark:text-yellow-300">
          Estimates are based on testnet constants and a placeholder APT/ShelbyUSD rate.
          Chunk allocation depends on network-wide demand. Actual rewards may differ.{" "}
          <strong>Do not use for financial planning.</strong>
        </p>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function CalculatorPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* ── Header ── */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Calculator className="h-7 w-7 text-muted-foreground" />
            <h1 className="text-4xl font-bold tracking-tight">
              Shelby Economics Calculator
            </h1>
          </div>
          <p className="text-base text-muted-foreground pl-10">
            Estimate storage costs and SP rewards based on live on-chain parameters.
          </p>
        </div>

        {/* ── Info bar — 3-column grid ── */}
        <div className="rounded-md bg-muted/50 border px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <div className="space-y-1">
            <p>
              <span className="font-semibold text-foreground">Rate:</span>{" "}
              42 µShelbyUSD / chunk / epoch
            </p>
            <p>
              <span className="font-semibold text-foreground">Split:</span>{" "}
              SP 39 µ · Admin 3 µ
            </p>
          </div>
          <div className="space-y-1">
            <p>
              <span className="font-semibold text-foreground">Payment epoch:</span>{" "}
              1 day
            </p>
            <p>
              <span className="font-semibold text-foreground">Staking epoch:</span>{" "}
              7 days
            </p>
          </div>
          <div className="space-y-1">
            <p>
              <span className="font-semibold text-foreground">Network:</span>{" "}
              Aptos Testnet
            </p>
            <p>
              <span className="font-semibold text-foreground">Contract:</span>{" "}
              <span className="font-mono">0x85fdb9a…988e6a</span>
            </p>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="storage">
          <TabsList className="mb-6">
            <TabsTrigger value="storage" className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" /> Storage Cost
            </TabsTrigger>
            <TabsTrigger value="sp" className="flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> SP Economics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="storage">
            <StorageCostTab />
          </TabsContent>
          <TabsContent value="sp">
            <SPEconomicsTab />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}