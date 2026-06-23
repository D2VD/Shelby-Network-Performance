// components/export-panel.tsx — v1.1
// CHANGES:
//   - Downloads now go through same-origin Next.js proxy routes (/api/v1/export/*)
//     instead of fetching the VPS directly. This eliminates the CSP connect-src
//     violation and the NEXT_PUBLIC_VPS_API_URL dependency.
//   - Error messages from the proxy are surfaced correctly.

"use client";

import { useState } from "react";
import { useTheme } from "./theme-context";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportFormat = "json" | "csv";

interface DownloadState {
  loading: boolean;
  error:   string | null;
  lastOk:  string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: "Last 24 h", days: 1  },
  { label: "Last 7 d",  days: 7  },
  { label: "Last 30 d", days: 30 },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Downloads via same-origin proxy — no CSP issues
async function triggerDownload(
  proxyPath: string,
  params:    URLSearchParams,
  filename:  string
): Promise<void> {
  const res = await fetch(`${proxyPath}?${params.toString()}`);

  // Surface structured errors from proxy
  if (!res.ok) {
    let message = `Server error (${res.status})`;
    try {
      const err = await res.json() as { error?: string };
      if (err.error) message = err.error;
    } catch { /* non-JSON body */ }
    throw new Error(message);
  }

  const blob   = await res.blob();
  const href   = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href     = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(href);
}

// ── Shared card shell ─────────────────────────────────────────────────────────

interface ExportCardProps {
  title:        string;
  description:  string;
  isDark:       boolean;
  from:         string;
  setFrom:      (v: string) => void;
  to:           string;
  setTo:        (v: string) => void;
  fmt:          ExportFormat;
  setFmt:       (v: ExportFormat) => void;
  state:        DownloadState;
  onQuick:      (days: number) => void;
  onExport:     () => void;
  extraFields?: React.ReactNode;
}

function ExportCard({
  title, description, isDark,
  from, setFrom, to, setTo,
  fmt, setFmt, state,
  onQuick, onExport, extraFields,
}: ExportCardProps) {
  const cardCls    = isDark ? "border-white/10 bg-white/5"   : "border-black/8 bg-black/3";
  const labelCls   = isDark ? "text-white/50"                 : "text-black/50";
  const titleCls   = isDark ? "text-white/85"                 : "text-black/80";
  const descCls    = isDark ? "text-white/40"                 : "text-black/40";
  const inputCls   = isDark
    ? "rounded-lg border border-white/15 bg-white/5 text-white/80 text-xs px-3 py-2 focus:outline-none focus:border-white/30 w-full"
    : "rounded-lg border border-black/15 bg-black/5 text-black/80 text-xs px-3 py-2 focus:outline-none focus:border-black/30 w-full";
  const quickCls   = isDark
    ? "px-2.5 py-1 rounded-md border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 text-xs transition-colors"
    : "px-2.5 py-1 rounded-md border border-black/10 text-black/40 hover:text-black/70 hover:border-black/20 text-xs transition-colors";
  const btnCls     = isDark
    ? "flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    : "flex items-center gap-2 px-4 py-2 rounded-lg bg-black/8 hover:bg-black/12 text-black/70 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const fmtActive  = isDark
    ? "bg-white/15 text-white/85 border-white/20"
    : "bg-black/10 text-black/80 border-black/20";
  const fmtInact   = isDark
    ? "bg-transparent text-white/35 border-white/10 hover:border-white/20"
    : "bg-transparent text-black/35 border-black/10 hover:border-black/20";

  return (
    <div className={`rounded-xl border p-5 ${cardCls}`}>
      <div className="mb-4">
        <p className={`text-sm font-semibold mb-0.5 ${titleCls}`}>{title}</p>
        <p className={`text-xs ${descCls}`}>{description}</p>
      </div>

      <div className="space-y-3">
        {extraFields}

        {/* Quick range */}
        <div>
          <label className={`block text-xs mb-1.5 ${labelCls}`}>Quick range</label>
          <div className="flex gap-2">
            {RANGE_OPTIONS.map(({ label, days }) => (
              <button key={label} className={quickCls} onClick={() => onQuick(days)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={`block text-xs mb-1 ${labelCls}`}>From</label>
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className={`block text-xs mb-1 ${labelCls}`}>To</label>
            <input type="date" className={inputCls} value={to}   onChange={(e) => setTo(e.target.value)}   />
          </div>
        </div>

        {/* Format + Download */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <label className={`block text-xs mb-1.5 ${labelCls}`}>Format</label>
            <div className="flex">
              {(["csv", "json"] as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFmt(f)}
                  className={`px-3 py-1.5 text-xs font-mono border first:rounded-l-lg last:rounded-r-lg transition-colors ${fmt === f ? fmtActive : fmtInact}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <button className={btnCls} onClick={onExport} disabled={state.loading}>
            {state.loading ? (
              <>
                <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 1v7M3 5l3 3 3-3M1 10h10" />
                </svg>
                Download {fmt.toUpperCase()}
              </>
            )}
          </button>
        </div>

        {state.error && (
          <p className="text-xs text-red-400 mt-1">{state.error}</p>
        )}
        {state.lastOk && !state.error && (
          <p className={`text-xs mt-1 ${isDark ? "text-green-400/70" : "text-green-600/70"}`}>
            Downloaded at{" "}
            {new Date(state.lastOk).toLocaleTimeString("en-US", {
              timeZone: "UTC", hour12: false,
            })}{" "}UTC
          </p>
        )}
      </div>
    </div>
  );
}

// ── Network Snapshots panel ───────────────────────────────────────────────────

function SnapshotsPanel({ network, isDark }: { network: string; isDark: boolean }) {
  const [from,  setFrom]  = useState(daysAgo(7));
  const [to,    setTo]    = useState(today());
  const [fmt,   setFmt]   = useState<ExportFormat>("csv");
  const [state, setState] = useState<DownloadState>({ loading: false, error: null, lastOk: null });

  async function handleExport() {
    setState({ loading: true, error: null, lastOk: null });
    try {
      const params = new URLSearchParams({
        network,
        from:   `${from}T00:00:00Z`,
        to:     `${to}T23:59:59Z`,
        format: fmt,
      });
      await triggerDownload(
        "/api/v1/export/snapshots",
        params,
        `shelby-snapshots-${network}-${from}-${to}.${fmt}`
      );
      setState({ loading: false, error: null, lastOk: new Date().toISOString() });
    } catch (err) {
      setState({ loading: false, error: (err as Error).message, lastOk: null });
    }
  }

  return (
    <ExportCard
      title="Network Snapshots"
      description="Time-series data: blob counts, storage bytes, SP count, block height."
      isDark={isDark}
      from={from} setFrom={setFrom}
      to={to}     setTo={setTo}
      fmt={fmt}   setFmt={setFmt}
      state={state}
      onQuick={(days) => { setFrom(daysAgo(days)); setTo(today()); }}
      onExport={handleExport}
    />
  );
}

// ── SP History panel ──────────────────────────────────────────────────────────

function SPHistoryPanel({ network, isDark }: { network: string; isDark: boolean }) {
  const [address, setAddress] = useState("");
  const [from,    setFrom]    = useState(daysAgo(30));
  const [to,      setTo]      = useState(today());
  const [fmt,     setFmt]     = useState<ExportFormat>("csv");
  const [state,   setState]   = useState<DownloadState>({ loading: false, error: null, lastOk: null });

  const inputCls = isDark
    ? "w-full rounded-lg border border-white/15 bg-white/5 text-white/80 placeholder-white/25 text-xs px-3 py-2 font-mono focus:outline-none focus:border-white/30"
    : "w-full rounded-lg border border-black/15 bg-black/5 text-black/80 placeholder-black/25 text-xs px-3 py-2 font-mono focus:outline-none focus:border-black/30";
  const labelCls = isDark ? "text-white/50" : "text-black/50";

  async function handleExport() {
    const trimmed = address.trim();
    if (!trimmed) {
      setState({ loading: false, error: "SP address is required.", lastOk: null });
      return;
    }
    setState({ loading: true, error: null, lastOk: null });
    try {
      const params = new URLSearchParams({
        network,
        address: trimmed,
        from:    `${from}T00:00:00Z`,
        to:      `${to}T23:59:59Z`,
        format:  fmt,
      });
      await triggerDownload(
        "/api/v1/export/sp-history",
        params,
        `sp-history-${trimmed.slice(0, 10)}-${from}-${to}.${fmt}`
      );
      setState({ loading: false, error: null, lastOk: new Date().toISOString() });
    } catch (err) {
      setState({ loading: false, error: (err as Error).message, lastOk: null });
    }
  }

  return (
    <ExportCard
      title="SP Health History"
      description="Per-provider health, AZ, and stake snapshots over time."
      isDark={isDark}
      from={from}  setFrom={setFrom}
      to={to}      setTo={setTo}
      fmt={fmt}    setFmt={setFmt}
      state={state}
      onQuick={(days) => { setFrom(daysAgo(days)); setTo(today()); }}
      onExport={handleExport}
      extraFields={
        <div>
          <label className={`block text-xs mb-1 ${labelCls}`}>SP Address</label>
          <input
            className={inputCls}
            placeholder="0x13e218..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
          />
        </div>
      }
    />
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function ExportPanel({ network = "shelbynet" }: { network?: string }) {
  const { isDark } = useTheme();
  const headCls  = isDark ? "text-white/80" : "text-black/75";
  const noteCls  = isDark ? "text-white/30" : "text-black/30";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className={`text-sm font-semibold ${headCls}`}>Data Export</h3>
        <span className={`text-xs font-mono ${noteCls}`}>1 download / hour / endpoint</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SnapshotsPanel network={network} isDark={isDark} />
        <SPHistoryPanel network={network} isDark={isDark} />
      </div>
    </div>
  );
}