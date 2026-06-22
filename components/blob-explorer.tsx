// components/blob-explorer.tsx — v1.0
// Priority 4: Blob Explorer — reusable search + table components
// Compose into app/explorer/page.tsx blob tab.
//
// Usage (inside your existing blob tab):
//
//   import { BlobSearchBar, BlobStatusFilter, BlobTable, BlobPagination } from "@/components/blob-explorer";
//   import { useBlobSearch } from "@/hooks/use-blob-search";
//
//   const [state, ctrl] = useBlobSearch({ network });
//
//   <BlobSearchBar   query={ctrl.query} onChange={ctrl.setQuery} loading={state.loading} isDark={isDark} />
//   <BlobStatusFilter status={ctrl.status} onChange={ctrl.setStatus} isDark={isDark} />
//   <BlobTable       state={state} isDark={isDark} />
//   <BlobPagination  state={state} onPage={ctrl.setPage} pageSize={20} isDark={isDark} />

"use client";

import { useState } from "react";
import type { BlobRecord, BlobSearchState, BlobStatus } from "@/hooks/use-blob-search";

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
  const hintCls = isDark ? "text-white/25" : "text-black/25";

  // Detect what kind of input this looks like
  const trimmed = query.trim();
  const hint =
    /^(0x)?[0-9a-f]{64}$/i.test(trimmed) ? "Blob ID — exact lookup" :
    /^0x[0-9a-f]{62,66}$/i.test(trimmed)  ? "Owner address — filter" :
    trimmed.length > 0                     ? "Partial name search"    :
    null;

  return (
    <div>
      <div className={containerCls}>
        {/* Search icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round"
          className={isDark ? "text-white/30 shrink-0" : "text-black/30 shrink-0"}
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10.5 10.5l3.5 3.5" />
        </svg>

        <input
          className={inputCls}
          placeholder="Search blob ID (0x…), owner address, or name"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />

        {/* Spinner or clear */}
        {loading ? (
          <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-40" />
        ) : query ? (
          <button
            onClick={() => onChange("")}
            className={`shrink-0 ${isDark ? "text-white/30 hover:text-white/60" : "text-black/30 hover:text-black/60"} transition-colors`}
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Type hint */}
      {hint && (
        <p className={`text-xs mt-1 ml-1 font-mono ${hintCls}`}>{hint}</p>
      )}
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
  const active = isDark
    ? "bg-white/15 text-white/85 border-white/25"
    : "bg-black/10 text-black/80 border-black/20";
  const inactive = isDark
    ? "bg-transparent text-white/40 border-white/10 hover:border-white/20 hover:text-white/65"
    : "bg-transparent text-black/40 border-black/10 hover:border-black/20 hover:text-black/65";

  return (
    <div className="flex items-center gap-0" role="group" aria-label="Filter by status">
      {STATUS_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`px-3 py-1.5 text-xs font-medium border first:rounded-l-lg last:rounded-r-lg transition-colors ${
            status === value ? active : inactive
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── BlobTable ─────────────────────────────────────────────────────────────────

const STATUS_PILL: Record<string, { text: string; cls: string }> = {
  active:  { text: "Active",  cls: "bg-green-500/15 text-green-400 border-green-500/25"   },
  pending: { text: "Pending", cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" },
  deleted: { text: "Deleted", cls: "bg-red-500/15 text-red-400 border-red-500/25"          },
};
const STATUS_PILL_LIGHT: Record<string, { text: string; cls: string }> = {
  active:  { text: "Active",  cls: "bg-green-50 text-green-700 border-green-200"   },
  pending: { text: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200"   },
  deleted: { text: "Deleted", cls: "bg-red-50 text-red-700 border-red-200"         },
};

function StatusPill({ status, isDark }: { status: string; isDark: boolean }) {
  const map   = isDark ? STATUS_PILL : STATUS_PILL_LIGHT;
  const entry = map[status.toLowerCase()] ?? { text: status, cls: isDark ? "bg-white/10 text-white/50 border-white/15" : "bg-black/5 text-black/50 border-black/10" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${entry.cls}`}>
      {entry.text}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GiB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(2)} MiB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function BlobDetailExpanded({ blob, isDark }: { blob: BlobRecord; isDark: boolean }) {
  const rowCls  = isDark ? "text-white/50" : "text-black/50";
  const valCls  = isDark ? "text-white/80 font-mono" : "text-black/75 font-mono";
  const pgCls   = isDark
    ? "px-2 py-0.5 rounded-md bg-white/8 border border-white/10 text-white/55 text-xs font-mono"
    : "px-2 py-0.5 rounded-md bg-black/5 border border-black/10 text-black/55 text-xs font-mono";

  const rows: [string, string | null | undefined][] = [
    ["Blob ID",       blob.blob_id],
    ["Owner",         blob.owner_address],
    ["Size",          formatBytes(blob.size_bytes)],
    ["Registered",    blob.registered_at ? new Date(blob.registered_at).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC" : null],
    ["Expires",       blob.expires_at    ? new Date(blob.expires_at).toLocaleString("en-US",    { timeZone: "UTC" }) + " UTC" : "No expiry"],
  ];

  return (
    <div className={`mt-3 rounded-xl border p-4 text-xs space-y-2.5 ${isDark ? "border-white/8 bg-white/3" : "border-black/8 bg-black/2"}`}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-3">
          <span className={`w-24 shrink-0 ${rowCls}`}>{label}</span>
          <span className={`break-all ${valCls}`}>{value ?? "—"}</span>
        </div>
      ))}

      {/* Placement Groups */}
      {blob.placement_groups && blob.placement_groups.length > 0 && (
        <div className="flex gap-3">
          <span className={`w-24 shrink-0 ${rowCls}`}>Placement Groups</span>
          <div className="flex flex-wrap gap-1.5">
            {blob.placement_groups.map((pg) => (
              <span key={pg} className={pgCls} title={pg}>
                {pg.slice(0, 10)}…
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function BlobTable({
  state,
  isDark,
}: {
  state:  BlobSearchState;
  isDark: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const headCls  = isDark ? "text-white/35 border-white/8"  : "text-black/35 border-black/8";
  const rowHover = isDark ? "hover:bg-white/5"              : "hover:bg-black/3";
  const rowBdr   = isDark ? "border-white/6"                : "border-black/6";
  const textCls  = isDark ? "text-white/70"                 : "text-black/65";
  const mutedCls = isDark ? "text-white/35"                 : "text-black/35";
  const monoCls  = isDark ? "text-white/55 font-mono"       : "text-black/50 font-mono";
  const emptyMsg = isDark ? "text-white/30"                 : "text-black/30";

  // Loading skeleton
  if (state.loading && state.results.length === 0 && !state.single) {
    return (
      <div className="space-y-2 mt-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`h-12 rounded-lg animate-pulse ${isDark ? "bg-white/5" : "bg-black/4"}`} />
        ))}
      </div>
    );
  }

  // Error
  if (state.error) {
    return (
      <div className={`rounded-xl border px-4 py-6 text-center text-sm ${isDark ? "border-red-500/20 bg-red-500/5 text-red-400" : "border-red-200 bg-red-50 text-red-600"}`}>
        {state.error}
      </div>
    );
  }

  // Single exact blob_id result
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

  // Empty
  if (state.results.length === 0) {
    return (
      <div className={`rounded-xl border px-4 py-10 text-center text-sm ${isDark ? "border-white/8" : "border-black/8"}`}>
        <p className={emptyMsg}>No blobs found.</p>
      </div>
    );
  }

  // Table
  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? "border-white/8" : "border-black/8"}`}>
      {/* Header */}
      <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 border-b text-xs font-semibold uppercase tracking-wider ${headCls}`}>
        <span>Blob ID / Owner</span>
        <span>Size</span>
        <span>Status</span>
        <span>Registered</span>
      </div>

      {/* Rows */}
      {state.results.map((blob) => {
        const isOpen = expanded === blob.blob_id;
        return (
          <div
            key={blob.blob_id}
            className={`border-b last:border-b-0 ${rowBdr} ${rowHover} cursor-pointer transition-colors`}
            onClick={() => setExpanded(isOpen ? null : blob.blob_id)}
          >
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 items-center">
              {/* ID + owner */}
              <div className="min-w-0">
                <p className={`truncate text-xs ${monoCls}`}>{blob.blob_id}</p>
                <p className={`text-xs mt-0.5 ${mutedCls}`}>{shortAddr(blob.owner_address)}</p>
              </div>
              <span className={`text-xs ${textCls} tabular-nums`}>{formatBytes(blob.size_bytes)}</span>
              <StatusPill status={blob.status} isDark={isDark} />
              <span className={`text-xs ${mutedCls} tabular-nums whitespace-nowrap`}>
                {new Date(blob.registered_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>

            {/* Expanded detail */}
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
  if (state.total <= pageSize) return null;

  const totalPages = Math.ceil(state.total / pageSize);
  const btnBase    = "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors";
  const active     = isDark
    ? `${btnBase} bg-white/15 border-white/25 text-white/85`
    : `${btnBase} bg-black/10 border-black/20 text-black/80`;
  const inactive   = isDark
    ? `${btnBase} bg-transparent border-white/10 text-white/45 hover:border-white/20 hover:text-white/65`
    : `${btnBase} bg-transparent border-black/10 text-black/45 hover:border-black/20 hover:text-black/65`;
  const disabled   = isDark
    ? `${btnBase} bg-transparent border-white/5 text-white/20 cursor-not-allowed`
    : `${btnBase} bg-transparent border-black/5 text-black/20 cursor-not-allowed`;
  const metaCls    = isDark ? "text-white/35" : "text-black/35";

  return (
    <div className="flex items-center justify-between mt-3">
      <span className={`text-xs ${metaCls}`}>
        {state.total.toLocaleString("en-US")} blobs · page {state.page}/{totalPages}
      </span>
      <div className="flex gap-1.5">
        <button
          className={state.page <= 1 ? disabled : inactive}
          onClick={() => onPage(state.page - 1)}
          disabled={state.page <= 1}
        >
          ← Prev
        </button>
        {/* Show up to 5 page numbers */}
        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
          const p = Math.max(1, Math.min(totalPages - 4, state.page - 2)) + i;
          if (p > totalPages) return null;
          return (
            <button
              key={p}
              className={p === state.page ? active : inactive}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          );
        })}
        <button
          className={state.page >= totalPages ? disabled : inactive}
          onClick={() => onPage(state.page + 1)}
          disabled={state.page >= totalPages}
        >
          Next →
        </button>
      </div>
    </div>
  );
}