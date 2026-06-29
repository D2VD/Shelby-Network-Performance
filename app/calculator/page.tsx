// app/calculator/page.tsx
// Shelby Economics Calculator — v4.2 (Fully Patched with Live Network Config)

"use client";

import { useState, useEffect } from "react";
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
  ExternalLink, BookOpen, BarChart2, Globe,
} from "lucide-react";

// ── Network-aware constants ────────────────────────────────────────────────────
type NetworkKey = "shelbynet" | "testnet";

const NETWORK_CONSTANTS: Record<NetworkKey, {
  label:              string;
  microSUSDTotal:     number;
  microSUSDSP:        number;
  microSUSDAdmin:     number;
  paymentEpochDays:   number;
  stakingEpochDays:   number;
  contractShort:      string;
}> = {
  shelbynet: {
    label:            "Shelbynet",
    microSUSDTotal:   42,
    microSUSDSP:      39,
    microSUSDAdmin:   3,
    paymentEpochDays: 1,
    stakingEpochDays: 7,
    contractShort:    "0x85fdb9a…988e6a",
  },
  testnet: {
    label:            "Testnet",
    microSUSDTotal:   42,
    microSUSDSP:      39,
    microSUSDAdmin:   3,
    paymentEpochDays: 1,
    stakingEpochDays: 7,
    contractShort:    "0x85fdb9a…988e6a",
  },
};

const DEFAULT_CHUNK_SIZE_BYTES = 1_048_576; // 1 MiB fallback
const MAX_STAKE_APT    = 10_000_000;

// ── Duration presets ───────────────────────────────────────────────────────────
const DURATION_PRESETS = [
  { label: "7d",  days: 7   },
  { label: "1mo", days: 30  },
  { label: "3mo", days: 90  },
  { label: "6mo", days: 180 },
  { label: "1yr", days: 365 },
];

// ── Competitor table & types ───────────────────────────────────────────────────
interface Competitor {
  name: string; usdPerGBmo: number | null; model: string; note: string;
}
const COMPETITORS: Competitor[] = [
  { name: "AWS S3",        usdPerGBmo: 0.023,  model: "Monthly",  note: "Standard, us-east-1" },
  { name: "Cloudflare R2", usdPerGBmo: 0.015,  model: "Monthly",  note: "No egress fees" },
  { name: "Backblaze B2",  usdPerGBmo: 0.006,  model: "Monthly",  note: "Cheapest S3-compatible" },
  { name: "Arweave",       usdPerGBmo: null,   model: "One-time", note: "~$4.00/GB upfront (permanent)" },
  { name: "Filecoin",      usdPerGBmo: 0.0002, model: "Monthly",  note: "Variable, deal-based" },
  { name: "IPFS (pinned)", usdPerGBmo: 0.10,   model: "Monthly",  note: "Via Pinata / NFT.Storage" },
];

interface LivePricingProvider {
  id:                string;
  name:              string;
  storagePerGBMonth: number;
  egressPerGB:       number;
  putPer1000:        number;
  getPer1000:        number;
  model:             "monthly" | "one-time" | "variable";
  note:              string;
  source:            string;
}

interface LivePricing {
  providers: LivePricingProvider[];
  syncedAt:  string;
}

interface NetworkConfig {
  chunkSizeBytes: number;
  chunkSizeMiB:   number;
  source:         "on-chain" | "fallback";
  resourceType:   string | null;
  fieldName:      string | null;
  fetchedAt:      string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function num(v: number, d = 2): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function bytesToDisplay(b: number): string {
  if (b >= 1e12) return `${num(b / 1e12, 2)} TB`;
  if (b >= 1e9)  return `${num(b / 1e9,  2)} GB`;
  if (b >= 1e6)  return `${num(b / 1e6,  2)} MB`;
  return `${num(b / 1e3, 2)} KB`;
}

// ── Calculation engines ────────────────────────────────────────────────────────
interface StorageResult {
  chunks: number; epochs: number;
  totalMicroSUSD: number; totalSUSD: number;
  perMonthSUSD: number; perGBMonthSUSD: number; gbDecimal: number;
}
function calcStorage(sizeBytes: number, days: number, net: NetworkKey, chunkSizeBytes: number): StorageResult {
  const c = NETWORK_CONSTANTS[net];
  const chunks         = Math.ceil(sizeBytes / chunkSizeBytes);
  const epochs         = Math.ceil(days / c.paymentEpochDays);
  const totalMicroSUSD = chunks * epochs * c.microSUSDTotal;
  const totalSUSD      = totalMicroSUSD / 1_000_000;
  const perMonthSUSD   = days > 0 ? (totalSUSD / days) * 30 : 0;
  const gbDecimal      = sizeBytes / 1e9;
  const perGBMonthSUSD = gbDecimal > 0 && perMonthSUSD > 0 ? perMonthSUSD / gbDecimal : 0;
  return { chunks, epochs, totalMicroSUSD, totalSUSD, perMonthSUSD, perGBMonthSUSD, gbDecimal };
}

interface SPResult {
  rewardPerEpochSUSD: number; rewardPerDaySUSD: number;
  rewardPerMonthSUSD: number; rewardPerYearSUSD: number;
  breakEvenDays: number | null;
}
function calcSP(stakeApt: number, chunks: number, net: NetworkKey): SPResult {
  const c                  = NETWORK_CONSTANTS[net];
  const rewardPerEpochSUSD = (chunks * c.microSUSDSP) / 1_000_000;
  const rewardPerDaySUSD   = rewardPerEpochSUSD / c.paymentEpochDays;
  const rewardPerMonthSUSD = rewardPerDaySUSD * 30;
  const rewardPerYearSUSD  = rewardPerDaySUSD * 365;
  const stakeValueSUSD     = stakeApt * 10;
  const breakEvenDays      = rewardPerDaySUSD > 0
    ? Math.round(stakeValueSUSD / rewardPerDaySUSD) : null;
  return { rewardPerEpochSUSD, rewardPerDaySUSD, rewardPerMonthSUSD, rewardPerYearSUSD, breakEvenDays };
}

// ── Hooks ──────────────────────────────────────────────────────────────────────
function usePricing() {
  const [pricing, setPricing]         = useState<LivePricing | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pricing/competitors")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LivePricing | null) => {
        if (!d?.providers || d.providers.length === 0) return;
        setPricing(d);
        setLastUpdated(d.syncedAt);
      })
      .catch(() => {
        // Network error — silently fall back to hardcoded COMPETITORS constant
      });
  }, []);

  return { pricing, lastUpdated };
}

function useNetworkConfig(network: NetworkKey) {
  const [config, setConfig]       = useState<NetworkConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setConfig(null);

    fetch(`/api/network/config?network=${network}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NetworkConfig | null) => {
        if (d?.chunkSizeBytes) setConfig(d);
      })
      .catch(() => {/* fall back to DEFAULT_CHUNK_SIZE_BYTES below */})
      .finally(() => setIsLoading(false));
  }, [network]);

  const chunkSizeBytes = config?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const chunkSizeMiB   = chunkSizeBytes / 1_048_576;
  const isOnChain      = config?.source === "on-chain";

  return { chunkSizeBytes, chunkSizeMiB, isOnChain, isLoading, config };
}

// ── Shared sub-components ──────────────────────────────────────────────────────
function StatCard({ label, value, sub, badge, accent }: {
  label: string; value: string; sub?: string; badge?: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 space-y-1 ${accent ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800" : "bg-muted/30"}`}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-bold font-mono leading-tight ${accent ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      {badge && <div className="mt-1">{badge}</div>}
    </div>
  );
}

// ── DurationPills ──────────────────────────────────────────────────────────────
function DurationPills({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const [custom, setCustom] = useState(false);
  const [customVal, setCustomVal] = useState("");
  const isPreset = DURATION_PRESETS.some((p) => p.days === days);

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {DURATION_PRESETS.map((p) => (
        <button
          key={p.days}
          onClick={() => { onChange(p.days); setCustom(false); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            ${days === p.days && !custom
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={1}
          max={3650}
          placeholder="Custom"
          value={customVal}
          onChange={(e) => {
            setCustomVal(e.target.value);
            setCustom(true);
            const n = parseInt(e.target.value, 10);
            if (!isNaN(n) && n > 0) onChange(n);
          }}
          className={`w-24 h-8 text-sm ${custom && !isPreset ? "border-primary ring-1 ring-primary" : ""}`}
        />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
    </div>
  );
}

// ── CostBarChart ───────────────────────────────────────────────────────────────
function CostBarChart({ rows }: { rows: { name: string; cost: number; note: string; isShelby: boolean }[] }) {
  const max = Math.max(...rows.map((r) => r.cost), 0.0001);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
          <span className={`text-sm font-medium text-right truncate ${r.isShelby ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
            {r.name}
          </span>
          <div className="h-6 bg-muted rounded-sm overflow-hidden">
            <div
              className={`h-full rounded-sm transition-all duration-700 ease-out ${r.isShelby ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
              style={{ width: `${Math.max((r.cost / max) * 100, 2)}%` }}
            />
          </div>
          <span className={`text-xs font-mono tabular-nums w-36 text-right ${r.isShelby ? "text-emerald-700 font-semibold" : "text-muted-foreground"}`}>
            {r.cost < 0.0001 ? "< 0.0001" : num(r.cost, 4)} {r.note}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Mode switcher — card-based ─────────────────────────────────────────────────
type Mode = "storage" | "sp";

function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const options: { key: Mode; icon: React.ReactNode; title: string; desc: string }[] = [
    {
      key: "storage",
      icon: <HardDrive className="h-5 w-5" />,
      title: "Storage Cost",
      desc: "How much does it cost to store data on Shelby?",
    },
    {
      key: "sp",
      icon: <Server className="h-5 w-5" />,
      title: "SP Economics",
      desc: "How much can a storage provider earn per epoch?",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`
            rounded-xl border p-4 text-left transition-all duration-150
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
            ${mode === o.key
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card hover:border-foreground/20 hover:bg-muted/40"
            }
          `}
        >
          <div className={`flex items-center gap-2 mb-1 font-semibold text-sm ${mode === o.key ? "text-primary" : "text-foreground"}`}>
            {o.icon}
            {o.title}
            {mode === o.key && (
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                Active
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{o.desc}</p>
        </button>
      ))}
    </div>
  );
}

// ── Storage Cost content ───────────────────────────────────────────────────────
function StorageCostContent({
  network,
  onSwitchMode,
}: {
  network: NetworkKey;
  onSwitchMode: () => void;
}) {
  const [sizeValue, setSizeValue] = useState(1);
  const [sizeUnit, setSizeUnit]   = useState<"MB" | "GB" | "TB">("GB");
  const [days, setDays]           = useState(30);

  const { pricing, lastUpdated } = usePricing();
  const { chunkSizeBytes, chunkSizeMiB, isOnChain, isLoading: configLoading } = useNetworkConfig(network);

  const unitBytes: Record<"MB" | "GB" | "TB", number> = { MB: 1e6, GB: 1e9, TB: 1e12 };
  const sizeBytes = sizeValue * unitBytes[sizeUnit];
  const result    = calcStorage(sizeBytes, days, network, chunkSizeBytes);
  const nc        = NETWORK_CONSTANTS[network];

  const competitors: Competitor[] = pricing?.providers
    ? pricing.providers.map((p) => ({
        name: p.name,
        usdPerGBmo: p.storagePerGBMonth,
        model: p.model.charAt(0).toUpperCase() + p.model.slice(1),
        note: p.note,
      }))
    : COMPETITORS;

  const chartRows = [
    { name: "Shelby", cost: result.totalSUSD, note: "sUSD*", isShelby: true },
    ...competitors.map((c) => ({
      name: c.name,
      cost: c.usdPerGBmo !== null
        ? c.usdPerGBmo * result.gbDecimal * (days / 30)
        : 4 * result.gbDecimal,
      note: "USD",
      isShelby: false,
    })),
  ].filter((r) => r.cost > 0);

  return (
    <div className="space-y-6">

      {/* ── Parameters row — horizontal, compact ── */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap gap-6 items-end">

          {/* Size */}
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Storage Size
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0.01}
                step={0.1}
                value={sizeValue}
                onChange={(e) => setSizeValue(Math.max(0.01, Number(e.target.value)))}
                className="w-28 h-9 text-sm"
              />
              <Select value={sizeUnit} onValueChange={(v) => setSizeUnit(v as "MB" | "GB" | "TB")}>
                <SelectTrigger className="w-20 h-9 text-sm">
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

          <div className="hidden sm:block w-px h-12 bg-border self-center" />

          {/* Duration */}
          <div className="space-y-1.5 flex-1 min-w-0">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Duration
              <span className="ml-2 font-normal normal-case text-foreground">
                {days} {days === 1 ? "day" : "days"}
                {days >= 30 ? ` · ${num(days / 30, 1)} months` : ""}
              </span>
            </Label>
            <DurationPills days={days} onChange={setDays} />
          </div>

        </div>
      </div>

      {/* ── Estimated Cost — hero ── */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-6">

          {/* Primary */}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600/70 dark:text-emerald-500 mb-2">
              Estimated total — {bytesToDisplay(sizeBytes)}, {days} days, {nc.label}
            </p>
            <div className="flex items-baseline gap-2.5">
              <span className="text-6xl font-bold font-mono tracking-tight text-emerald-900 dark:text-emerald-100 leading-none">
                {num(result.totalSUSD, 4)}
              </span>
              <span className="text-lg text-emerald-700 dark:text-emerald-400 font-semibold">sUSD</span>
            </div>
          </div>

          {/* Secondary trio */}
          <div className="flex gap-8 sm:border-l sm:border-emerald-200 sm:pl-6">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-2xl font-bold font-mono">{num(result.perMonthSUSD, 4)}</p>
              <p className="text-xs text-muted-foreground">sUSD / mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per GB / mo</p>
              <p className="text-2xl font-bold font-mono">{num(result.perGBMonthSUSD, 6)}</p>
              <p className="text-xs text-muted-foreground">sUSD</p>
            </div>
          </div>

        </div>
        <p className="text-xs text-muted-foreground mt-4">
          {nc.microSUSDTotal} µShelbyUSD · chunk⁻¹ · epoch⁻¹ · 1 epoch = {nc.paymentEpochDays} day
        </p>
      </div>

      {/* ── Breakdown stat cards ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
          <BarChart2 className="h-3.5 w-3.5" /> Calculation Breakdown
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Storage Size" value={bytesToDisplay(sizeBytes)} />
          <StatCard 
            label="Chunk Size" 
            value={`${num(chunkSizeMiB)} MiB`} 
            badge={
              configLoading ? (
                <div className="text-muted-foreground text-xs">fetching...</div>
              ) : isOnChain ? (
                <div className="text-green-600 dark:text-green-400 text-xs font-medium">on-chain ✓</div>
              ) : (
                <div className="text-orange-500 text-xs font-medium">assumed</div>
              )
            }
          />
          <StatCard label="Chunks"           value={result.chunks.toLocaleString("en-US")} />
          <StatCard label="Epochs"           value={result.epochs.toLocaleString("en-US")} sub={`${nc.paymentEpochDays}d each`} />
          <StatCard label="Rate"             value={`${nc.microSUSDTotal} µsUSD`} sub="per chunk / epoch" />
          <StatCard label="Total µShelbyUSD" value={result.totalMicroSUSD.toLocaleString("en-US")} accent />
        </div>
      </div>

      {/* ── Chart ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Cost Comparison — {days}-day period · {bytesToDisplay(sizeBytes)}
        </p>
        <div className="rounded-xl border p-5">
          <CostBarChart rows={chartRows} />
          <p className="text-xs text-muted-foreground mt-4">
            * ShelbyUSD ≠ USD — exchange rate not established on {nc.label}. Comparison is directional only.
          </p>
        </div>
      </div>

      {/* ── Comparison table ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Detailed Comparison
        </p>
        <div className="rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="min-w-[130px]">Provider</TableHead>
                <TableHead className="min-w-[90px]">Model</TableHead>
                <TableHead className="text-right min-w-[160px]">Est. Cost</TableHead>
                <TableHead className="text-right min-w-[130px]">Per GB/mo</TableHead>
                <TableHead className="min-w-[200px]">Note</TableHead>
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
              {competitors.map((c) => {
                const cost = c.usdPerGBmo !== null
                  ? c.usdPerGBmo * result.gbDecimal * (days / 30) : null;
                return (
                  <TableRow key={c.name} className="hover:bg-muted/20">
                    <TableCell className="font-medium text-sm">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.model}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {cost !== null ? `$${num(cost, 4)}` : "Variable"}
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
        {lastUpdated && (
          <p className="text-xs text-muted-foreground mt-2 text-right">
            Competitor prices last updated:{" "}
            {new Date(lastUpdated).toLocaleDateString("en-US", {
              year:  "numeric",
              month: "long",
              day:   "numeric",
            })}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          * ShelbyUSD ≠ USD. Chunk size {num(chunkSizeMiB)} MiB {isOnChain ? "confirmed on-chain" : "assumed pending contract confirmation"}.
        </p>
      </div>

      {/* ── Actions ── */}
      <div className="pt-1 border-t flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href="/explorer" className="flex items-center gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> Open Explorer
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={onSwitchMode}>
          <Server className="h-3.5 w-3.5 mr-1.5" /> Estimate SP Rewards
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="https://docs.shelby.xyz" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Documentation
          </a>
        </Button>
      </div>
    </div>
  );
}

// ── SP Economics content ───────────────────────────────────────────────────────
function SPEconomicsContent({ network }: { network: NetworkKey }) {
  const [stakeApt, setStakeApt] = useState(1000);
  const [chunks, setChunks]     = useState(10000);

  const { chunkSizeBytes } = useNetworkConfig(network);
  const result = calcSP(stakeApt, chunks, network);
  const nc     = NETWORK_CONSTANTS[network];

  const projections = [
    { label: "1 Month",  value: result.rewardPerMonthSUSD },
    { label: "3 Months", value: result.rewardPerMonthSUSD * 3 },
    { label: "6 Months", value: result.rewardPerMonthSUSD * 6 },
    { label: "1 Year",   value: result.rewardPerYearSUSD },
  ];

  return (
    <div className="space-y-6">

      {/* ── Parameters row — horizontal ── */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap gap-6 items-end">

          {/* Stake */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Stake Amount
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={10}
                step={10}
                value={stakeApt}
                onChange={(e) => setStakeApt(Math.max(10, Number(e.target.value)))}
                className="w-32 h-9 text-sm"
              />
              <span className="text-sm font-medium">APT</span>
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              {(stakeApt * 1e8).toLocaleString("en-US")} octas
            </p>
          </div>

          <div className="hidden sm:block w-px h-12 bg-border self-center" />

          {/* Chunks */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chunks / Epoch
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={1}
                step={100}
                value={chunks}
                onChange={(e) => setChunks(Math.max(1, Number(e.target.value)))}
                className="w-32 h-9 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                ≈ {bytesToDisplay(chunks * chunkSizeBytes)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Depends on network demand</p>
          </div>

        </div>
      </div>

      {/* ── Estimated Rewards — hero ── */}
      <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 p-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-6">

          {/* Primary */}
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600/70 dark:text-blue-500 mb-2">
              Estimated rewards — per epoch (1 day) · {nc.label}
            </p>
            <div className="flex items-baseline gap-2.5">
              <span className="text-6xl font-bold font-mono tracking-tight text-blue-900 dark:text-blue-100 leading-none">
                {num(result.rewardPerEpochSUSD, 4)}
              </span>
              <span className="text-lg text-blue-700 dark:text-blue-400 font-semibold">sUSD</span>
            </div>
          </div>

          {/* Secondary trio */}
          <div className="flex gap-8 sm:border-l sm:border-blue-200 sm:pl-6">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Per month</p>
              <p className="text-2xl font-bold font-mono">{num(result.rewardPerMonthSUSD, 2)}</p>
              <p className="text-xs text-muted-foreground">sUSD / mo</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Break-even</p>
              <p className="text-2xl font-bold font-mono">
                {result.breakEvenDays !== null ? result.breakEvenDays.toLocaleString("en-US") : "—"}
              </p>
              <p className="text-xs text-muted-foreground">days (est.)</p>
            </div>
          </div>

        </div>
        <p className="text-xs text-muted-foreground mt-4">
          {nc.microSUSDSP} µsUSD / chunk / epoch (SP share, excl. {nc.microSUSDAdmin} µ admin)
          · break-even assumes 1 APT = 10 sUSD (placeholder)
        </p>
      </div>

      {/* ── Breakdown stat cards ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1.5">
          <BarChart2 className="h-3.5 w-3.5" /> Economics Breakdown
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Stake"        value={`${stakeApt.toLocaleString("en-US")} APT`} />
          <StatCard label="Chunks/epoch" value={chunks.toLocaleString("en-US")} />
          <StatCard label="SP rate"      value={`${nc.microSUSDSP} µsUSD`} sub="per chunk / epoch" />
          <StatCard label="Daily"        value={`${num(result.rewardPerDaySUSD, 4)}`} sub="sUSD / day" />
          <StatCard label="Monthly"      value={`${num(result.rewardPerMonthSUSD, 2)}`} sub="sUSD / mo" />
          <StatCard label="Yearly"       value={`${num(result.rewardPerYearSUSD, 2)}`} sub="sUSD / yr" accent />
        </div>
      </div>

      {/* ── Projections table ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Revenue Projections
        </p>
        <div className="rounded-xl border overflow-hidden">
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
                const pct = stakeValueSUSD > 0 ? (p.value / stakeValueSUSD) * 100 : 0;
                return (
                  <TableRow key={p.label} className="hover:bg-muted/20">
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{num(p.value, 2)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={pct >= 100 ? "default" : "secondary"}>{num(pct, 1)}%</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Stake coverage = rewards ÷ stake value (1 APT = 10 sUSD placeholder). Rates TBD for mainnet.
        </p>
      </div>

      {/* ── Disclaimer + actions ── */}
      <div className="rounded-xl bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 px-4 py-3 flex gap-3 text-sm">
        <Info className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
        <p className="text-yellow-800 dark:text-yellow-300">
          Estimates based on {nc.label} constants and a placeholder APT/ShelbyUSD rate.
          Chunk allocation depends on network demand. <strong>Not financial advice.</strong>
        </p>
      </div>

      <div className="pt-1 border-t flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href="/explorer" className="flex items-center gap-1.5">
            <ExternalLink className="h-3.5 w-3.5" /> Open Explorer
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="https://docs.shelby.xyz" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" /> Documentation
          </a>
        </Button>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function CalculatorPage() {
  const [mode, setMode]       = useState<Mode>("storage");
  const [network, setNetwork] = useState<NetworkKey>("shelbynet");
  const nc                    = NETWORK_CONSTANTS[network];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Calculator className="h-6 w-6 text-muted-foreground shrink-0" />
              <h1 className="text-3xl font-bold tracking-tight">
                Shelby Economics Calculator
              </h1>
            </div>
            <p className="text-sm text-muted-foreground pl-9">
              Estimate storage costs and SP rewards based on live on-chain parameters.
            </p>
          </div>

          {/* Network selector — top right */}
          <div className="flex items-center gap-2 pl-9 sm:pl-0 shrink-0">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <Select value={network} onValueChange={(v) => setNetwork(v as NetworkKey)}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shelbynet">ShelbyNet</SelectItem>
                <SelectItem value="testnet">Testnet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Network info chips ── */}
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            { label: "Rate",          value: `${nc.microSUSDTotal} µsUSD / chunk / epoch` },
            { label: "SP share",      value: `${nc.microSUSDSP} µ · Admin ${nc.microSUSDAdmin} µ` },
            { label: "Payment epoch", value: `${nc.paymentEpochDays} day` },
            { label: "Staking epoch", value: `${nc.stakingEpochDays} days` },
            { label: "Contract",      value: nc.contractShort },
          ].map((chip) => (
            <div key={chip.label}
              className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1">
              <span className="text-muted-foreground">{chip.label}:</span>
              <span className="font-medium font-mono">{chip.value}</span>
            </div>
          ))}
        </div>

        {/* ── Mode switcher — card-based ── */}
        <ModeSwitcher mode={mode} onChange={setMode} />

        {/* ── Content ── */}
        {mode === "storage"
          ? <StorageCostContent network={network} onSwitchMode={() => setMode("sp")} />
          : <SPEconomicsContent network={network} />
        }

      </div>
    </div>
  );
}