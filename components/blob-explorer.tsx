// components/blob-explorer.tsx — v1.1
// FIXES:
//   - All JSX string/number values wrapped in str()/num() helpers per OS rules
//     (prevents React #418 hydration mismatch from null/undefined rendering)
//   - Added useMounted() guard: server renders static skeleton, client hydrates
//     to matching skeleton, then loads real content — eliminates #418
//   - Replaced `any` with `unknown` per OS TypeScript rules
//   - Early return pattern for null/error states

"use client";

import { useEffect, useState } from "react";
import type { BlobRecord, BlobSearchState, BlobStatus } from "@/hooks/use-blob-search";

// ── Safe value helpers (mandatory per OS rules) ───────────────────────────────
// Prevents React hydration errors from null/undefined/NaN in JSX

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ── Mounted guard — fixes React #418 ──────────────────────────────────────────
// Server renders skeleton; client hydrates to identical skeleton; then mounts
// real content. Eliminates server/client JSX mismatch on first render.

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatBytes(bytes: unknown): string {
  const b = num(bytes, 0);
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(2)} GiB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(2)} MiB`;
  if (b >= 1_024)         return `${(b / 1_024).toFixed(1)} KiB`;
  return `${b.toLocaleString("en-US")} B`;
}

function shortAddr(addr: unknown): string {
  const s = str(addr);
  if (s.length < 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function fmtDate(iso: unknown): string {
  const s = str(iso);
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtDateTime(iso: unknown): string {
  const s = str(iso);
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
}

// ── BlobSearchBar ─────────────────────────────────────────────────────────────

export function BlobSearchBar({
  query,
  onChange,
  loading,
  isDark,
}: {
  query:    string;
  onChange: (v: string) => void;
  loading:  boolean;
  isDark:   boolean;
}) {
  const containerCls = isDark
    ? "flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 focus-within:border-white/30 transition-colors"
    : "flex items-center gap-2 rounded-xl border border-black/12 bg-black/4 px-3 py-2.5 focus-within:border-black/25 transition-colors";
  const inputCls = isDark
    ? "flex-1 bg-transparent text-sm text-white/80 placeholder-white/25 focus:outline-none font-mono"
    : "flex-1 bg-transparent text-sm text-black/75 placeholder-black/30 focus:outline-none font-mono";
  const iconCls  = isDark ? "text-white/30 shrink-0" : "text-black/30 shrink-0";
  const hintCls  = isDark ? "text-white/25"           : "text-black/25";

  const trimmed = str(query).trim();
  const hint =
    /^(0x)?[0-9a-f]{64}$/i.test(trimmed) ? "Blob ID — exact lookup"   :
    /^0x[0-9a-f]{62,66}$/i.test(trimmed)  ? "Owner address — filter"   :
    trimmed.length > 0                     ? "Partial name search"      :
    "";  // empty string, not null — consistent between server and client

  return (
    <div>
      <div className={containerCls}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={iconCls}
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10.5 10.5l3.5 3.5" />
        </svg>

        <input
          className={inputCls}
          placeholder="Search blob ID (0x…), owner address, or name"
          value={str(query)}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />

        {loading ? (
          <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-40" />
        ) : trimmed ? (
          <button
            onClick={() => onChange("")}
            className={`shrink-0 transition-colors ${isDark ? "text-white/30 hover:text-white/60" : "text-black/30 hover:text-black/60"}`}
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Render empty span when no hint — keeps DOM structure identical server/client */}
      <p className={`text-xs mt-1 ml-1 font-mono min-h-[1rem] ${hintCls}`}>
        {str(hint)}
      </p>
    </div>
  );
}

// ── BlobStatusFilter ──────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: BlobStatus; label: string }[] = [
  { value: "all",     label: "All"     },
  { value: "active",  label: "Active"  },
  { value: "pending", label: "Pending" },
  { value: "deleted", label: "Deleted" },
];

export function BlobStatusFilter({
  status,
  onChange,
  isDark,
}: {
  status:   BlobStatus;
  onChange: (v: BlobStatus) => void;
  isDark:   boolean;
}) {
  const active   = isDark
    ? "bg-white/15 text-white/85 border-white/25"
    : "bg-black/10 text-black/80 border-black/20";
  const inactive = isDark
    ? "bg-transparent text-white/40 border-white/10 hover:border-white/20 hover:text-white/65"
    : "bg-transparent text-black/40 border-black/10 hover:border-black/20 hover:text-black/65";

  return (
    <div className="flex" role="group" aria-label="Filter by status">
      {STATUS_OPTIONS.map(({ value, label }) => (
        <button
          key={str(value)}
          onClick={() => onChange(value)}
          className={`px-3 py-1.5 text-xs font-medium border first:rounded-l-lg last:rounded-r-lg transition-colors ${
            status === value ? active : inactive
          }`}
        >
          {str(label)}
        </button>
      ))}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_DARK: Record<string, string> = {
  active:  "bg-green-500/15 text-green-400 border-green-500/25",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  deleted: "bg-red-500/15 text-red-400 border-red-500/25",
};
const STATUS_LIGHT: Record<string, string> = {
  active:  "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  deleted: "bg-red-50 text-red-700 border-red-200",
};

function StatusPill({ status, isDark }: { status: unknown; isDark: boolean }) {
  const key = str(status).toLowerCase();
  const map = isDark ? STATUS_DARK : STATUS_LIGHT;
  const cls = map[key] ?? (isDark
    ? "bg-white/10 text-white/50 border-white/15"
    : "bg-black/5 text-black/50 border-black/10");
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {str(status) || "unknown"}
    </span>
  );
}

// ── Blob detail (expanded row) ────────────────────────────────────────────────

function BlobDetailExpanded({ blob, isDark }: { blob: BlobRecord; isDark: boolean }) {
  const rowCls = isDark ? "text-white/50" : "text-black/50";
  const valCls = isDark ? "text-white/80 font-mono" : "text-black/75 font-mono";
  const pgCls  = isDark
    ? "px-2 py-0.5 rounded-md bg-white/8 border border-white/10 text-white/55 text-xs font-mono"
    : "px-2 py-0.5 rounded-md bg-black/5 border border-black/10 text-black/55 text-xs font-mono";
  const wrapCls = isDark ? "border-white/8 bg-white/3" : "border-black/8 bg-black/2";

  const rows: [string, string][] = [
    ["Blob ID",    str(blob.blob_id,       "—")],
    ["Owner",      str(blob.owner_address, "—")],
    ["Size",       formatBytes(blob.size_bytes)],
    ["Registered", fmtDateTime(blob.registered_at)],
    ["Expires",    blob.expires_at ? fmtDateTime(blob.expires_at) : "No expiry"],
  ];

  const pgs = Array.isArray(blob.placement_groups) ? blob.placement_groups : [];

  return (
    <div className={`mt-3 rounded-xl border p-4 text-xs space-y-2.5 ${wrapCls}`}>
      {rows.map(([label, value]) => (
        <div key={str(label)} className="flex gap-3">
          <span className={`w-24 shrink-0 ${rowCls}`}>{str(label)}</span>
          <span className={`break-all ${valCls}`}>{str(value)}</span>
        </div>
      ))}

      {pgs.length > 0 && (
        <div className="flex gap-3">
          <span className={`w-24 shrink-0 ${rowCls}`}>Placement Groups</span>
          <div className="flex flex-wrap gap-1.5">
            {pgs.map((pg) => (
              <span key={str(pg)} className={pgCls} title={str(pg)}>
                {str(pg).slice(0, 10)}…
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Static skeleton — rendered identically on server and client ───────────────

function BlobSkeleton({ isDark }: { isDark: boolean }) {
  const cls = isDark ? "bg-white/5" : "bg-black/4";
  return (
    <div className="space-y-2 mt-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`h-12 rounded-lg ${cls}`} />
      ))}
    </div>
  );
}

// ── BlobTable ─────────────────────────────────────────────────────────────────

export function BlobTable({
  state,
  isDark,
}: {
  state:  BlobSearchState;
  isDark: boolean;
}) {
  const mounted  = useMounted();
  const [expanded, setExpanded] = useState<string | null>(null);

  // Until mounted: render identical skeleton on server AND client
  // This eliminates React #418 hydration mismatch
  if (!mounted) return <BlobSkeleton isDark={isDark} />;

  const headCls  = isDark ? "text-white/35 border-white/8"  : "text-black/35 border-black/8";
  const rowHover = isDark ? "hover:bg-white/5"              : "hover:bg-black/3";
  const rowBdr   = isDark ? "border-white/6"                : "border-black/6";
  const mutedCls = isDark ? "text-white/35"                 : "text-black/35";
  const monoCls  = isDark ? "text-white/55 font-mono"       : "text-black/50 font-mono";
  const emptyMsg = isDark ? "text-white/30"                 : "text-black/30";
  const errCls   = isDark
    ? "border-red-500/20 bg-red-500/5 text-red-400"
    : "border-red-200 bg-red-50 text-red-600";
  const borderCls = isDark ? "border-white/8" : "border-black/8";

  if (state.loading) return <BlobSkeleton isDark={isDark} />;

  if (state.error) {
    return (
      <div className={`rounded-xl border px-4 py-6 text-center text-sm ${errCls}`}>
        {str(state.error, "An error occurred")}
      </div>
    );
  }

  // Exact blob_id hit
  if (state.single) {
    return (
      <div className={`rounded-xl border p-4 ${isDark ? "border-white/10 bg-white/5" : "border-black/8 bg-black/3"}`}>
        <div className="flex items-center justify-between mb-2">
          <StatusPill status={state.single.status} isDark={isDark} />
          <span className={`text-xs ${mutedCls}`}>{formatBytes(state.single.size_bytes)}</span>
        </div>
        <BlobDetailExpanded blob={state.single} isDark={isDark} />
      </div>
    );
  }

  if (state.results.length === 0) {
    return (
      <div className={`rounded-xl border px-4 py-10 text-center text-sm ${borderCls}`}>
        <p className={emptyMsg}>No blobs found.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${borderCls}`}>
      {/* Header */}
      <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider ${headCls}`}>
        <span>Blob ID / Owner</span>
        <span>Size</span>
        <span>Status</span>
        <span>Registered</span>
      </div>

      {state.results.map((blob) => {
        const isOpen  = expanded === str(blob.blob_id);
        const blobKey = str(blob.blob_id, Math.random().toString());

        return (
          <div
            key={blobKey}
            className={`border-b last:border-b-0 ${rowBdr} ${rowHover} cursor-pointer transition-colors`}
            onClick={() => setExpanded(isOpen ? null : str(blob.blob_id))}
          >
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center">
              <div className="min-w-0">
                <p className={`truncate text-xs ${monoCls}`}>{str(blob.blob_id, "—")}</p>
                <p className={`text-xs mt-0.5 ${mutedCls}`}>{shortAddr(blob.owner_address)}</p>
              </div>
              <span className={`text-xs tabular-nums ${mutedCls}`}>
                {formatBytes(blob.size_bytes)}
              </span>
              <StatusPill status={blob.status} isDark={isDark} />
              <span className={`text-xs tabular-nums whitespace-nowrap ${mutedCls}`}>
                {fmtDate(blob.registered_at)}
              </span>
            </div>

            {isOpen && (
              <div className="px-4 pb-4">
                <BlobDetailExpanded blob={blob} isDark={isDark} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── BlobPagination ────────────────────────────────────────────────────────────

export function BlobPagination({
  state,
  onPage,
  pageSize,
  isDark,
}: {
  state:    BlobSearchState;
  onPage:   (p: number) => void;
  pageSize: number;
  isDark:   boolean;
}) {
  const mounted = useMounted();
  if (!mounted) return null;

  const total      = num(state.total, 0);
  const page       = num(state.page,  1);
  const totalPages = Math.ceil(total / pageSize);

  if (total <= pageSize) return null;

  const btnBase  = "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors";
  const active   = isDark
    ? `${btnBase} bg-white/15 border-white/25 text-white/85`
    : `${btnBase} bg-black/10 border-black/20 text-black/80`;
  const inactive = isDark
    ? `${btnBase} bg-transparent border-white/10 text-white/45 hover:border-white/20 hover:text-white/65`
    : `${btnBase} bg-transparent border-black/10 text-black/45 hover:border-black/20 hover:text-black/65`;
  const disabled = isDark
    ? `${btnBase} bg-transparent border-white/5 text-white/20 cursor-not-allowed`
    : `${btnBase} bg-transparent border-black/5 text-black/20 cursor-not-allowed`;
  const metaCls  = isDark ? "text-white/35" : "text-black/35";

  const startPage = Math.max(1, Math.min(totalPages - 4, page - 2));
  const pageNums  = Array.from({ length: Math.min(5, totalPages) }, (_, i) => startPage + i)
    .filter((p) => p <= totalPages);

  return (
    <div className="flex items-center justify-between mt-3">
      <span className={`text-xs ${metaCls}`}>
        {total.toLocaleString("en-US")} blobs · page {page}/{totalPages}
      </span>
      <div className="flex gap-1.5">
        <button
          className={page <= 1 ? disabled : inactive}
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          ← Prev
        </button>

        {pageNums.map((p) => (
          <button
            key={p}
            className={p === page ? active : inactive}
            onClick={() => onPage(p)}
          >
            {p}
          </button>
        ))}

        <button
          className={page >= totalPages ? disabled : inactive}
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
        >
          Next →
        </button>
      </div>
    </div>
  );
}