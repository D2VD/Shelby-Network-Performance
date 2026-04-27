"use client";
// components/ui.tsx — Shelby Analytics v2.0
// Shelby-specific component library xây trên shadcn/ui primitives + Tailwind
//
// ─ Re-exports shadcn primitives (Card, Badge, Button, Skeleton, Table, …)
// ─ Shelby compound components (StatCard, MetricCard, StatusBadge, …)
// ─ Layout helpers (SectionHeader, PageContainer, DataGrid)
// ─ Feedback (ErrorBanner, EmptyState, LiveIndicator)
// ─ Utility (CopyButton, MonoValue, RangeSelector, RefreshButton)

import * as React from "react";
import { cn } from "@/lib/utils";

// ── shadcn primitives re-export ───────────────────────────────────────────────
export {
  Card, CardHeader, CardFooter,
  CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
export { Badge }    from "@/components/ui/badge";
export { Button }   from "@/components/ui/button";
export { Skeleton } from "@/components/ui/skeleton";
export { Separator }from "@/components/ui/separator";
export { Progress } from "@/components/ui/progress";
export {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
export {
  Table, TableHeader, TableBody, TableFooter,
  TableHead, TableRow, TableCell, TableCaption,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE INDICATOR — pulsing dot với animated rings
// ─────────────────────────────────────────────────────────────────────────────
interface LiveIndicatorProps {
  size?:      "sm" | "md" | "lg";
  label?:     string;
  className?: string;
}

export function LiveIndicator({ size = "md", label = "Live", className }: LiveIndicatorProps) {
  const dotSz  = { sm: "size-1.5", md: "size-2",   lg: "size-2.5" }[size];
  const textSz = { sm: "text-[10px]", md: "text-xs", lg: "text-sm" }[size];
  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1",
      "bg-emerald-500/10 border border-emerald-500/20",
      className,
    )}>
      <span className="relative flex shrink-0">
        <span className={cn(dotSz, "absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping")} />
        <span className={cn(dotSz, "relative inline-flex rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]")} />
      </span>
      {label && (
        <span className={cn(textSz, "font-semibold tracking-wide text-emerald-400 uppercase")}>{label}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK BADGE — Shelbynet / Testnet indicator
// ─────────────────────────────────────────────────────────────────────────────
interface NetworkBadgeProps {
  network:    "shelbynet" | "testnet";
  size?:      "sm" | "md";
  className?: string;
}

export function NetworkBadge({ network, size = "sm", className }: NetworkBadgeProps) {
  const isShelbynet = network === "shelbynet";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md font-semibold uppercase tracking-wider",
      size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
      isShelbynet
        ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
        : "bg-purple-500/10 text-purple-400 border border-purple-500/20",
      className,
    )}>
      <span className={cn("size-1.5 rounded-full", isShelbynet ? "bg-blue-400" : "bg-purple-400")} />
      {isShelbynet ? "Shelbynet" : "Testnet"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METHOD BADGE — data source label (shelby-indexer, cached, rpc…)
// ─────────────────────────────────────────────────────────────────────────────
export function MethodBadge({ method, className }: { method?: string | null; className?: string }) {
  if (!method) return null;
  const isLive   = method.includes("indexer") || (method.includes("rpc") && !method.includes("cache"));
  const isCached = method.includes("cache") || method.includes("seeded");
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
      isLive
        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
        : isCached
        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
        : "bg-slate-500/10 text-slate-400 border border-slate-500/20",
      className,
    )}>
      {isLive ? "⚡" : isCached ? "⏱" : "●"} {method}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE — provider health / state
// ─────────────────────────────────────────────────────────────────────────────
type StatusVariant = "active"|"healthy"|"faulty"|"unhealthy"|"waiting"|"waitlisted"|"frozen"|"neutral"|"unknown";

const STATUS_CFG: Record<StatusVariant, { cls: string; dot: string }> = {
  active:     { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
  healthy:    { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", dot: "bg-emerald-500" },
  faulty:     { cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",                dot: "bg-red-500"     },
  unhealthy:  { cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",                dot: "bg-red-500"     },
  waiting:    { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",        dot: "bg-amber-500"   },
  waitlisted: { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",        dot: "bg-amber-500"   },
  frozen:     { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",            dot: "bg-blue-500"    },
  neutral:    { cls: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20",        dot: "bg-slate-400"   },
  unknown:    { cls: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20",        dot: "bg-slate-400"   },
};

function toStatusVariant(s: string): StatusVariant {
  // 1. Chuẩn hóa chuỗi đầu vào (Edge case: null/empty xử lý bởi toLowerCase)
  const normalized = s?.toLowerCase().replace(/[\s-]/g, "") ?? "";

  // 2. Xử lý Alias mapping (Các giá trị không nằm trong STATUS_CFG)
  if (normalized === "awaitingactivation") {
    return "waiting";
  }

  // 3. Kiểm tra tính hợp lệ trong cấu hình (Happy path)
  // Sử dụng 'in' để kiểm tra trước khi ép kiểu
  if (normalized in STATUS_CFG) {
    return normalized as StatusVariant;
  }

  // 4. Fallback mặc định cho các giá trị không xác định
  return "neutral";
}

export function StatusBadge({ label, variant, className }: {
  label: string; variant?: StatusVariant; className?: string;
}) {
  const v   = variant ?? toStatusVariant(label);
  const cfg = STATUS_CFG[v] ?? STATUS_CFG.neutral;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold", cfg.cls, className)}>
      <span className={cn("size-1.5 rounded-full shrink-0", cfg.dot)} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD — primary metric display with accent top-border + delta
// ─────────────────────────────────────────────────────────────────────────────
interface StatCardProps {
  label:     string;
  value:     string | number;
  sub?:      string;
  icon?:     React.ReactNode;
  accent?:   string;
  delta?:    number | null;
  loading?:  boolean;
  pulse?:    boolean;
  className?: string;
}

export function StatCard({
  label, value, sub, icon,
  accent = "#2563eb",
  delta, loading = false, pulse = false, className,
}: StatCardProps) {
  const pos = delta != null && delta > 0;
  const neg = delta != null && delta < 0;
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border bg-[var(--bg-card)] p-4 md:p-5",
        "transition-all duration-200 hover:shadow-md",
        className,
      )}
      style={{ borderTopWidth: 2, borderTopColor: accent }}
    >
      {pulse && (
        <span className="absolute top-3 right-3">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        </span>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</span>
        {icon && <span className="text-base opacity-35">{icon}</span>}
      </div>
      {loading ? (
        <div className="h-8 w-28 rounded-md bg-[var(--bg-card2)] animate-pulse" />
      ) : (
        <div
          className="text-2xl font-bold tabular-nums leading-none tracking-tight text-[var(--text-primary)]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {value}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap min-h-[18px]">
        {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
        {delta != null && (
          <span className={cn(
            "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold",
            pos ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
            neg ? "bg-red-500/10 text-red-600 dark:text-red-400" :
                  "bg-slate-500/10 text-slate-400",
          )}>
            {pos ? "▲" : neg ? "▼" : "—"} {Math.abs(delta).toLocaleString("en-US")}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METRIC CARD — compact, for sidebar / metrics bar
// ─────────────────────────────────────────────────────────────────────────────
export function MetricCard({ label, value, sub, loading = false, updated = false, className }: {
  label: string; value: string | number; sub?: string;
  loading?: boolean; updated?: boolean; className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-[var(--bg-card)] p-3 transition-colors duration-200", className)}>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      {loading
        ? <div className="h-5 w-16 rounded bg-[var(--bg-card2)] animate-pulse" />
        : (
          <div
            className={cn("text-[17px] font-bold tabular-nums leading-tight transition-colors duration-300",
              updated ? "text-[var(--net-color)]" : "text-[var(--text-primary)]")}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {value}
          </div>
        )
      }
      {sub && <div className="mt-0.5 text-[10px] text-[var(--text-dim)]">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION HEADER
// ─────────────────────────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action, badge, className }: {
  title: string; subtitle?: string;
  action?: React.ReactNode; badge?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 flex-wrap mb-6", className)}>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] leading-none">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE CONTAINER
// ─────────────────────────────────────────────────────────────────────────────
export function PageContainer({ children, className, size = "default" }: {
  children: React.ReactNode; className?: string; size?: "default" | "wide" | "narrow";
}) {
  const maxW = { narrow: "max-w-3xl", default: "max-w-[1280px]", wide: "max-w-[1600px]" }[size];
  return <div className={cn("mx-auto w-full px-5 md:px-7", maxW, className)}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA GRID — responsive stat grid
// ─────────────────────────────────────────────────────────────────────────────
export function DataGrid({ children, cols = 3, className }: {
  children: React.ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string;
}) {
  const colCls = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
  }[cols];
  return <div className={cn("grid gap-3", colCls, className)}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR BANNER
// ─────────────────────────────────────────────────────────────────────────────
export function ErrorBanner({ message, detail, onRetry, variant = "error", className }: {
  message: string; detail?: string; onRetry?: () => void;
  variant?: "error" | "warning" | "info"; className?: string;
}) {
  const cfg = {
    error:   { cls: "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400",     icon: "⚠" },
    warning: { cls: "bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400", icon: "⚠" },
    info:    { cls: "bg-blue-500/10 border-blue-500/25 text-blue-600 dark:text-blue-400",    icon: "ℹ" },
  }[variant];
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-xl border p-4", cfg.cls, className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-base shrink-0 mt-0.5">{cfg.icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{message}</p>
          {detail && <p className="mt-1 text-xs opacity-75 font-mono break-all">{detail}</p>}
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-current bg-transparent px-3 py-1.5 text-xs font-semibold cursor-pointer hover:opacity-75 transition-opacity"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EMPTY STATE
// ─────────────────────────────────────────────────────────────────────────────
export function EmptyState({ icon = "📊", title, description, action, className }: {
  icon?: string; title: string; description?: string;
  action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center gap-3 py-12 px-6 text-center",
      "rounded-xl border border-dashed border-[var(--border)]",
      className,
    )}>
      <span className="text-3xl">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        {description && <p className="mt-1 text-xs text-[var(--text-muted)] max-w-xs">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKELETON HELPERS
// ─────────────────────────────────────────────────────────────────────────────
import { Skeleton as ShadSkeleton } from "@/components/ui/skeleton";

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-xl border bg-[var(--bg-card)] p-5 space-y-3">
      <ShadSkeleton className="h-3 w-24" />
      <ShadSkeleton className="h-7 w-36" />
      {rows > 2 && <ShadSkeleton className="h-3 w-20" />}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const gridStyle = { display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "12px" };
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--bg-card2)] border-b border-[var(--border)]" style={gridStyle}>
        {Array.from({ length: cols }).map((_, i) => <ShadSkeleton key={i} className="h-3 w-16" />)}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-[var(--border-soft)] last:border-0" style={gridStyle}>
          {Array.from({ length: cols }).map((_, j) => (
            <ShadSkeleton key={j} className={cn("h-4", j === 0 ? "w-3/5" : "w-4/5")} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY BUTTON
// ─────────────────────────────────────────────────────────────────────────────
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <button
      onClick={handle}
      title={copied ? "Copied!" : "Copy"}
      className={cn(
        "inline-flex items-center justify-center size-6 rounded bg-transparent border-0",
        "text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card2)]",
        "transition-colors cursor-pointer",
        className,
      )}
    >
      {copied
        ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M1 4.5V10a1 1 0 001 1h5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
      }
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MONO VALUE — address / hash display with optional truncate + copy
// ─────────────────────────────────────────────────────────────────────────────
export function MonoValue({ value, copyable = false, truncate = false, className }: {
  value: string; copyable?: boolean; truncate?: boolean; className?: string;
}) {
  const display = truncate ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <code className="font-mono text-xs text-[var(--text-primary)]" title={truncate ? value : undefined}>{display}</code>
      {copyable && <CopyButton text={value} />}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INFO ROW — label: value pair for detail panels
// ─────────────────────────────────────────────────────────────────────────────
export function InfoRow({ label, value, border = true, className }: {
  label: string; value: React.ReactNode; border?: boolean; className?: string;
}) {
  return (
    <div className={cn(
      "flex items-center justify-between gap-4 py-2",
      border && "border-b border-[var(--border-soft)] last:border-0",
      className,
    )}>
      <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--text-primary)] text-right min-w-0">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RANGE SELECTOR — pill tabs for chart time range
// ─────────────────────────────────────────────────────────────────────────────
type TimeRange = "1h" | "24h" | "7d" | "30d";

export function RangeSelector({ value, onChange, className }: {
  value: TimeRange; onChange: (r: TimeRange) => void; className?: string;
}) {
  const ranges: TimeRange[] = ["1h", "24h", "7d", "30d"];
  return (
    <div className={cn(
      "inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card2)] p-0.5",
      className,
    )}>
      {ranges.map(r => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-semibold transition-all duration-150 cursor-pointer border-0",
            r === value
              ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
              : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH BUTTON
// ─────────────────────────────────────────────────────────────────────────────
export function RefreshButton({ onClick, loading = false, className }: {
  onClick: () => void; loading?: boolean; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)]",
        "bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]",
        "hover:text-[var(--text-primary)] hover:border-[var(--text-dim)]",
        "transition-all cursor-pointer disabled:opacity-50",
        className,
      )}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={loading ? "animate-spin" : ""}>
        <path d="M10 6A4 4 0 112 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M10 3v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {loading ? "Syncing…" : "Refresh"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOB BREAKDOWN BAR — animated composition bar
// ─────────────────────────────────────────────────────────────────────────────
interface BlobBreakdownBarProps {
  active:  number;
  pending: number;
  deleted: number;
  empty:   number;
  className?: string;
}

export function BlobBreakdownBar({ active, pending, deleted, empty, className }: BlobBreakdownBarProps) {
  const total = active + pending + deleted + empty;
  if (total === 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;

  const segments = [
    { label: "Active",  value: active,  color: "bg-emerald-500", hint: "is_written=1, is_deleted=0" },
    { label: "Pending", value: pending, color: "bg-amber-400",   hint: "is_written=0" },
    { label: "Deleted", value: deleted, color: "bg-red-500",     hint: "is_deleted=1" },
    { label: "Empty",   value: empty,   color: "bg-slate-400",   hint: "size=0" },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {/* Bar */}
      <div className="flex h-2 overflow-hidden rounded-full gap-px">
        {segments.map(s => (
          s.value > 0 && (
            <div
              key={s.label}
              className={cn("transition-all duration-700", s.color)}
              style={{ width: pct(s.value) }}
              title={`${s.label}: ${s.value.toLocaleString("en-US")} (${((s.value/total)*100).toFixed(1)}%)`}
            />
          )
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-1.5" title={s.hint}>
            <span className={cn("size-2 rounded-sm shrink-0", s.color)} />
            <span className="text-xs text-[var(--text-muted)]">{s.label}</span>
            <span className="text-xs font-semibold text-[var(--text-primary)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
              {s.value.toLocaleString("en-US")}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-[var(--text-dim)]">Total (is_written=1)</span>
          <span className="text-xs font-bold text-[var(--net-color)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
            {total.toLocaleString("en-US")}
          </span>
        </div>
      </div>
    </div>
  );
}