// components/blob-explorer.tsx — v1.2
// CHANGES: Updated all column references to match actual blob_registry schema.
//   blob_id → blob_name, owner_address → owner
//   Added tx_hash, tx_version, num_slices, content_hash, content_type to detail
//   Removed placement_groups (column does not exist)
//   Size formatted as dual GB decimal + GiB binary per OS display rule
//   Hint updated: 0x+64hex = "Transaction hash", address = "Owner address"

"use client";

import { useEffect, useState } from "react";
import type { BlobRecord, BlobSearchState, BlobStatus } from "@/hooks/use-blob-search";

// ── Safe value helpers (OS mandatory) ─────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

// ── Mount guard — prevents React #418 hydration mismatch ─────────────────────

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

// ── Formatters ────────────────────────────────────────────────────────────────

// OS rule: display both GB decimal (÷1e9) and GiB binary (÷1024³)
function formatBytes(bytes: unknown): string {
  const b = num(bytes, 0);
  if (b === 0) return "—";
  const gb  = (b / 1e9).toFixed(b >= 1e9 ? 2 : 4);
  const gib = (b / 1_073_741_824).toFixed(b >= 1_073_741_824 ? 2 : 4);
  if (b >= 1_073_741_824) return `${gb} GB (${gib} GiB)`;
  if (b >= 1_048_576)     return `${(b / 1e6).toFixed(2)} MB (${(b / 1_048_576).toFixed(2)} MiB)`;
  if (b >= 1_024)         return `${(b / 1e3).toFixed(1)} KB (${(b / 1_024).toFixed(1)} KiB)`;
  return `${b.toLocaleString("en-US")} B`;
}

function shortAddr(v: unknown): string {
  const s = str(v);
  if (s.length < 12) return s || "—";
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
  query, onChange, loading, isDark,
}: {
  query: string; onChange: (v: string) => void;
  loading: boolean; isDark: boolean;
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
    /^(0x)?[0-9a-f]{64}$/i.test(trimmed) ? "Transaction hash — exact lookup" :
    /^0x[0-9a-f]{62,66}$/i.test(trimmed)  ? "Owner address — filter by wallet" :
    trimmed.length > 0                     ? "Blob name search (partial match)" :
    "";

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
          placeholder="Blob name, tx hash (0x…), or owner address"
          value={str(query)}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />

        {loading ? (
          <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-40" />
        ) : trimmed ? (
          <button onClick={() => onChange("")}
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
      {/* Consistent DOM node between renders — prevents #418 */}
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
  status, onChange, isDark,
}: { status: BlobStatus; onChange: (v: BlobStatus) => void; isDark: boolean }) {
  const active   = isDark ? "bg-white/15 text-white/85 border-white/25"          : "bg-black/10 text-black/80 border-black/20";
  const inactive = isDark ? "bg-transparent text-white/40 border-white/10 hover:border-white/20 hover:text-white/65" : "bg-transparent text-black/40 border-black/10 hover:border-black/20 hover:text-black/65";

  return (
    <div className="flex" role="group" aria-label="Filter by status">
      {STATUS_OPTIONS.map(({ value, label }) => (
        <button key={str(value)} onClick={() => onChange(value)}
          className={`px-3 py-1.5 text-xs font-medium border first:rounded-l-lg last:rounded-r-lg transition-colors ${status === value ? active : inactive}`}
        >
          {str(label)}
        </button>
      ))}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

const PILL_DARK:  Record<string, string> = {
  active:  "bg-green-500/15 text-green-400 border-green-500/25",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
  deleted: "bg-red-500/15 text-red-400 border-red-500/25",
};
const PILL_LIGHT: Record<string, string> = {
  active:  "bg-green-50 text-green-700 border-green-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  deleted: "bg-red-50 text-red-700 border-red-200",
};

function StatusPill({ status, isDark }: { status: unknown; isDark: boolean }) {
  const key = str(status).toLowerCase();
  const cls = (isDark ? PILL_DARK : PILL_LIGHT)[key]
    ?? (isDark ? "bg-white/10 text-white/50 border-white/15" : "bg-black/5 text-black/50 border-black/10");
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {str(status) || "unknown"}
    </span>
  );
}

// ── Blob detail (expanded row) ────────────────────────────────────────────────

function BlobDetailExpanded({ blob, isDark }: { blob: BlobRecord; isDark: boolean }) {
  const rowCls  = isDark ? "text-white/50" : "text-black/50";
  const valCls  = isDark ? "text-white/80 font-mono break-all" : "text-black/75 font-mono break-all";
  const wrapCls = isDark ? "border-white/8 bg-white/3" : "border-black/8 bg-black/2";

  const rows: [string, string][] = [
    ["Blob name",     str(blob.blob_name,    "—")],
    ["Owner",         str(blob.owner,        "—")],
    ["Size",          formatBytes(blob.size_bytes)],
    ["Content type",  str(blob.content_type, "—")],
    ["Slices",        blob.num_slices != null ? num(blob.num_slices).toLocaleString("en-US") : "—"],
    ["Tx hash",       str(blob.tx_hash,      "—")],
    ["Tx version",    num(blob.tx_version).toLocaleString("en-US")],
    ["Content hash",  blob.content_hash ? str(blob.content_hash) : "—"],
    ["Registered",    fmtDateTime(blob.registered_at)],
    ["Expires",       blob.expires_at ? fmtDateTime(blob.expires_at) : "No expiry"],
  ];

  return (
    <div className={`mt-3 rounded-xl border p-4 text-xs space-y-2.5 ${wrapCls}`}>
      {rows.map(([label, value]) => (
        <div key={str(label)} className="flex gap-3">
          <span className={`w-28 shrink-0 ${rowCls}`}>{str(label)}</span>
          <span className={valCls}>{str(value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Static skeleton (identical server + client → no #418) ────────────────────

function BlobSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="space-y-2 mt-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className={`h-12 rounded-lg ${isDark ? "bg-white/5" : "bg-black/4"}`} />
      ))}
    </div>
  );
}

// ── BlobTable ─────────────────────────────────────────────────────────────────

export function BlobTable({ state, isDark }: { state: BlobSearchState; isDark: boolean }) {
  const mounted  = useMounted();
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!mounted) return <BlobSkeleton isDark={isDark} />;

  const headCls   = isDark ? "text-white/35 border-white/8"  : "text-black/35 border-black/8";
  const rowHover  = isDark ? "hover:bg-white/5"               : "hover:bg-black/3";
  const rowBdr    = isDark ? "border-white/6"                 : "border-black/6";
  const mutedCls  = isDark ? "text-white/35"                  : "text-black/35";
  const nameCls   = isDark ? "text-white/75 font-mono"        : "text-black/70 font-mono";
  const borderCls = isDark ? "border-white/8"                 : "border-black/8";
  const emptyCls  = isDark ? "text-white/30"                  : "text-black/30";
  const errCls    = isDark ? "border-red-500/20 bg-red-500/5 text-red-400" : "border-red-200 bg-red-50 text-red-600";

  if (state.loading) return <BlobSkeleton isDark={isDark} />;

  if (state.error) {
    return (
      <div className={`rounded-xl border px-4 py-6 text-center text-sm ${errCls}`}>
        {str(state.error, "An error occurred")}
      </div>
    );
  }

  // Exact tx_hash hit — show single record
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
      <div className={`rounded-xl border px-4 py-10 text-center ${borderCls}`}>
        <p className={`text-sm ${emptyCls}`}>No blobs found.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${borderCls}`}>
      {/* Header */}
      <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider ${headCls}`}>
        <span>Blob Name / Owner</span>
        <span>Size</span>
        <span>Status</span>
        <span>Registered</span>
      </div>

      {state.results.map((blob) => {
        const key    = `${str(blob.blob_name)}-${num(blob.tx_version)}`;
        const isOpen = expanded === key;

        return (
          <div key={key}
            className={`border-b last:border-b-0 ${rowBdr} ${rowHover} cursor-pointer transition-colors`}
            onClick={() => setExpanded(isOpen ? null : key)}
          >
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center">
              <div className="min-w-0">
                <p className={`truncate text-xs ${nameCls}`}>{str(blob.blob_name, "—")}</p>
                <p className={`text-xs mt-0.5 ${mutedCls}`}>{shortAddr(blob.owner)}</p>
              </div>
              <span className={`text-xs tabular-nums whitespace-nowrap ${mutedCls}`}>
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
  state, onPage, pageSize, isDark,
}: {
  state: BlobSearchState; onPage: (p: number) => void;
  pageSize: number; isDark: boolean;
}) {
  const mounted = useMounted();
  if (!mounted) return null;

  const total      = num(state.total, 0);
  const page       = num(state.page,  1);
  const totalPages = Math.ceil(total / pageSize);
  if (total <= pageSize) return null;

  const base     = "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors";
  const active   = isDark ? `${base} bg-white/15 border-white/25 text-white/85` : `${base} bg-black/10 border-black/20 text-black/80`;
  const inactive = isDark ? `${base} bg-transparent border-white/10 text-white/45 hover:border-white/20 hover:text-white/65` : `${base} bg-transparent border-black/10 text-black/45 hover:border-black/20 hover:text-black/65`;
  const disabled = isDark ? `${base} bg-transparent border-white/5 text-white/20 cursor-not-allowed` : `${base} bg-transparent border-black/5 text-black/20 cursor-not-allowed`;
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
        <button className={page <= 1 ? disabled : inactive}
          onClick={() => onPage(page - 1)} disabled={page <= 1}>← Prev</button>

        {pageNums.map((p) => (
          <button key={p} className={p === page ? active : inactive} onClick={() => onPage(p)}>
            {p}
          </button>
        ))}

        <button className={page >= totalPages ? disabled : inactive}
          onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next →</button>
      </div>
    </div>
  );
}