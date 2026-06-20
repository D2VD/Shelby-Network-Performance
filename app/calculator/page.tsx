// app/calculator/page.tsx
// Cost Calculator — Phase 3 Week 4 (A2)
// Pure frontend — reads PaymentTiers constants derived from on-chain data.
// No new backend routes required.
// v1.0

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
  stakeNormalized:    number;  // 0–1
  chunksAllocated:    number;  // estimated
  rewardPerEpochSUSD: number;
  rewardPerDaySUSD:   number;
  rewardPerMonthSUSD: number;
  rewardPerYearSUSD:  number;
  breakEvenDays:      number | null;  // null if stake ≈ 0
}

function calcSPRewards(stakeApt: number, chunksAllocated: number): SPRewardResult {
  const stakeNormalized    = Math.min(stakeApt / MAX_STAKE_APT, 1);
  const rewardPerEpochSUSD = (chunksAllocated * 39) / 1_000_000; // SP gets 39µ (not 3µ admin)
  const rewardPerDaySUSD   = rewardPerEpochSUSD * EPOCHS_PER_DAY;
  const rewardPerMonthSUSD = rewardPerDaySUSD * 30;
  const rewardPerYearSUSD  = rewardPerDaySUSD * 365;

  // Break-even: at what day does cumulative reward = stake value?
  // We model stake in ShelbyUSD — placeholder: 1 APT ≈ 10 ShelbyUSD (adjust for mainnet)
  const SUSD_PER_APT   = 10;
  const stakeValueSUSD = stakeApt * SUSD_PER_APT;
  const breakEvenDays  = rewardPerDaySUSD > 0
    ? Math.round(stakeValueSUSD / rewardPerDaySUSD)
    : null;

  return {
    stakeApt,
    stakeNormalized,
    chunksAllocated,
    rewardPerEpochSUSD,
    rewardPerDaySUSD,
    rewardPerMonthSUSD,
    rewardPerYearSUSD,
    breakEvenDays,
  };
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function StorageCostTab() {
  const [sizeValue, setSizeValue] = useState(1);
  const [sizeUnit, setSizeUnit]   = useState<"MB" | "GB" | "TB">("GB");
  const [days, setDays]           = useState(30);

  const unitBytes: Record<"MB" | "GB" | "TB", number> = {
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
  };

  const sizeBytes = sizeValue * unitBytes[sizeUnit];
  const result    = calcStorageCost(sizeBytes, days);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Inputs */}
      <div className="rounded-lg border bg-card p-5 space-y-5">
        <h3 className="font-semibold flex items-center gap-2">
          <HardDrive className="h-4 w-4" /> Storage Parameters
        </h3>

        {/* Size */}
        <div className="space-y-2">
          <Label>Storage Size</Label>
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
            <span className="text-sm text-muted-foreground">
              = {bytesToDisplay(sizeBytes)}
            </span>
          </div>
        </div>

        {/* Duration */}
        <div className="space-y-2">
          <Label>Storage Duration: <span className="font-semibold">{days} days</span></Label>
          <Slider
            min={1}
            max={365}
            step={1}
            value={[days]}
            onValueChange={([v]) => setDays(v)}
            className="max-w-sm"
          />
          <div className="flex gap-3 text-xs text-muted-foreground">
            {[7, 30, 90, 180, 365].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`hover:text-foreground ${days === d ? "font-semibold text-foreground" : ""}`}
              >
                {d === 365 ? "1y" : d === 180 ? "6mo" : d === 90 ? "3mo" : d === 30 ? "1mo" : "1w"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 p-5 space-y-3">
        <h3 className="font-semibold text-emerald-800 dark:text-emerald-400">
          Estimated Cost
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total cost</p>
            <p className="text-2xl font-bold font-mono">
              {num(result.totalSUSD, 4)} <span className="text-sm font-normal">ShelbyUSD</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Per month</p>
            <p className="text-2xl font-bold font-mono">
              {num(result.perMonthSUSD, 4)} <span className="text-sm font-normal">ShelbyUSD/mo</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Rate per GB/month</p>
            <p className="text-lg font-semibold font-mono">
              {num(result.perGBMonthSUSD, 6)} ShelbyUSD
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Chunks allocated</p>
            <p className="text-lg font-semibold font-mono">
              {result.chunks.toLocaleString("en-US")}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Based on 42 µShelbyUSD / chunk / epoch · 1 epoch = 1 day · chunk size ≈ 1 MiB
        </p>
      </div>

      {/* Breakdown */}
      <div className="rounded-lg border p-4 text-sm space-y-1 bg-muted/30">
        <p className="font-medium mb-2">Calculation Breakdown</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
          <span>Storage size:</span>         <span className="font-mono">{bytesToDisplay(sizeBytes)}</span>
          <span>Chunk size:</span>            <span className="font-mono">1 MiB</span>
          <span>Chunks required:</span>       <span className="font-mono">{result.chunks.toLocaleString("en-US")}</span>
          <span>Epochs (= days):</span>       <span className="font-mono">{result.epochs.toLocaleString("en-US")}</span>
          <span>Rate per chunk/epoch:</span>  <span className="font-mono">42 µShelbyUSD</span>
          <span>Total µShelbyUSD:</span>      <span className="font-mono">{result.totalMicroSUSD.toLocaleString("en-US")}</span>
        </div>
      </div>

      {/* Comparison table */}
      <div className="space-y-2">
        <h3 className="font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Price Comparison (same {days}-day period, {bytesToDisplay(sizeBytes)})
        </h3>
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Estimated Cost (USD)</TableHead>
                <TableHead className="text-right">Per GB/mo (USD)</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Shelby row */}
              <TableRow className="bg-emerald-50/50 dark:bg-emerald-950/10">
                <TableCell className="font-semibold">
                  <Badge variant="default" className="mr-1">Shelby</Badge>
                </TableCell>
                <TableCell>Monthly</TableCell>
                <TableCell className="text-right font-mono font-semibold text-emerald-700">
                  {num(result.totalSUSD, 4)} sUSD*
                </TableCell>
                <TableCell className="text-right font-mono">
                  {num(result.perGBMonthSUSD, 6)} sUSD*
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  Decentralised, cryptographic guarantees
                </TableCell>
              </TableRow>
              {COMPETITORS.map((c) => {
                const totalCost = c.usdPerGBmo !== null
                  ? c.usdPerGBmo * result.gbDecimal * (days / 30)
                  : null;
                return (
                  <TableRow key={c.name} className="hover:bg-muted/20">
                    <TableCell>{c.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.model}</TableCell>
                    <TableCell className="text-right font-mono">
                      {totalCost !== null ? `$${num(totalCost, 4)}` : "Variable"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {c.usdPerGBmo !== null ? `$${c.usdPerGBmo}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.note}</TableCell>
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
  const [stakeApt, setStakeApt]         = useState(1000);
  const [chunks, setChunks]             = useState(10000);

  const result = calcSPRewards(stakeApt, chunks);

  const projections = [
    { label: "1 Month",  days: 30,  value: result.rewardPerMonthSUSD },
    { label: "3 Months", days: 90,  value: result.rewardPerMonthSUSD * 3 },
    { label: "6 Months", days: 180, value: result.rewardPerMonthSUSD * 6 },
    { label: "1 Year",   days: 365, value: result.rewardPerYearSUSD },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Inputs */}
      <div className="rounded-lg border bg-card p-5 space-y-5">
        <h3 className="font-semibold flex items-center gap-2">
          <Server className="h-4 w-4" /> SP Parameters
        </h3>

        {/* Stake */}
        <div className="space-y-2">
          <Label>Stake Amount (APT)</Label>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              min={10}
              step={10}
              value={stakeApt}
              onChange={(e) => setStakeApt(Math.max(10, Number(e.target.value)))}
              className="w-40"
            />
            <span className="text-sm text-muted-foreground">
              = {num(stakeApt * 1e8, 0)} octas
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Testnet min: 100,000,000 octas (1 APT) · Max: 1,000,000,000,000,000 octas (10M APT)
          </p>
        </div>

        {/* Chunks allocated */}
        <div className="space-y-2">
          <Label>Estimated Chunks Allocated per Epoch</Label>
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

      {/* Result */}
      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 p-5 space-y-3">
        <h3 className="font-semibold text-blue-800 dark:text-blue-400">
          Estimated Rewards
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Per epoch (1 day)</p>
            <p className="text-2xl font-bold font-mono">
              {num(result.rewardPerEpochSUSD, 4)} <span className="text-sm font-normal">sUSD</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Per month</p>
            <p className="text-2xl font-bold font-mono">
              {num(result.rewardPerMonthSUSD, 2)} <span className="text-sm font-normal">sUSD/mo</span>
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Per year</p>
            <p className="text-lg font-semibold font-mono">
              {num(result.rewardPerYearSUSD, 2)} sUSD
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Break-even estimate</p>
            <p className="text-lg font-semibold font-mono">
              {result.breakEvenDays !== null
                ? `${result.breakEvenDays.toLocaleString("en-US")} days`
                : "—"}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          39 µShelbyUSD / chunk / epoch (SP share) · 1 epoch = 1 day ·
          Break-even assumes 1 APT ≈ 10 ShelbyUSD (placeholder — update for mainnet)
        </p>
      </div>

      {/* Projections table */}
      <div className="space-y-2">
        <h3 className="font-semibold">Revenue Projections</h3>
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
                    <TableCell className="text-right font-mono">
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

      {/* Disclaimer */}
      <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 px-4 py-3 flex gap-2 text-sm">
        <Info className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
        <p className="text-yellow-800 dark:text-yellow-300">
          These estimates are based on testnet constants and a placeholder APT/ShelbyUSD rate.
          Chunk allocation depends on network-wide demand. Actual rewards may differ significantly.
          <strong> Do not use for financial planning.</strong>
        </p>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function CalculatorPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="h-6 w-6" />
            Shelby Economics Calculator
          </h1>
          <p className="text-muted-foreground">
            Estimate storage costs and SP rewards based on live on-chain parameters.
          </p>
        </div>

        {/* On-chain config callout */}
        <div className="rounded-md bg-muted/50 border px-4 py-2.5 text-xs text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
          <span><span className="font-medium text-foreground">Rate:</span> 42 µShelbyUSD / chunk / epoch</span>
          <span><span className="font-medium text-foreground">SP share:</span> 39 µ · Admin: 3 µ</span>
          <span><span className="font-medium text-foreground">Epoch:</span> 1 day (payment) · 7 days (staking)</span>
          <span><span className="font-medium text-foreground">Network:</span> Aptos Testnet</span>
          <span><span className="font-medium text-foreground">Contract:</span> 0x85fdb9a...988e6a</span>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="storage">
          <TabsList className="mb-4">
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