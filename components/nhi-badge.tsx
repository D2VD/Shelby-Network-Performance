// components/nhi-badge.tsx — v1.1
// CHANGES:
//   - Theme-aware color maps (light mode: darker text + opaque bg, dark mode: existing translucent)
//   - NHI card footer timestamp → UTC (matches dashboard header clock)
//   - useTheme import for isDark detection

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "./theme-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NHIData {
  nhi: number;
  label: "Healthy" | "Degraded" | "Critical";
  color: "green" | "yellow" | "red";
  components: {
    quorum:             { score: number; weight: number; activeProviders: number; maxProviders: number };
    blobAvailability:   { score: number; weight: number; activeBlobs: number; totalBlobs: number };
    epochHealth:        { score: number; weight: number };
    storageUtilization: { score: number; weight: number };
  };
  network: string;
  updatedAt: string;
}

type ColorKey = "green" | "yellow" | "red";

// ── Theme-aware color maps ────────────────────────────────────────────────────
// Dark: translucent tints work well on dark backgrounds
// Light: fully opaque tints + darker text for WCAG contrast

const DARK_COLOR: Record<ColorKey, { bg: string; border: string; text: string; dot: string }> = {
  green:  { bg: "bg-green-500/10",  border: "border-green-500/25",  text: "text-green-400",  dot: "bg-green-400"  },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/25", text: "text-yellow-400", dot: "bg-yellow-400" },
  red:    { bg: "bg-red-500/10",    border: "border-red-500/25",    text: "text-red-400",    dot: "bg-red-400"    },
};

const LIGHT_COLOR: Record<ColorKey, { bg: string; border: string; text: string; dot: string }> = {
  green:  { bg: "bg-green-50",  border: "border-green-300",  text: "text-green-700",  dot: "bg-green-500"  },
  yellow: { bg: "bg-amber-50",  border: "border-amber-300",  text: "text-amber-700",  dot: "bg-amber-500"  },
  red:    { bg: "bg-red-50",    border: "border-red-300",    text: "text-red-700",    dot: "bg-red-500"    },
};

// Progress bar: slightly more saturated in light mode for visibility
function scoreBarColor(score: number, isDark: boolean): string {
  if (isDark) {
    if (score >= 80) return "bg-green-400";
    if (score >= 60) return "bg-yellow-400";
    return "bg-red-400";
  } else {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-amber-500";
    return "bg-red-500";
  }
}

// ── UTC timestamp formatter ───────────────────────────────────────────────────

function fmtUTC(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour:       "2-digit",
    minute:     "2-digit",
    second:     "2-digit",
    timeZone:   "UTC",
    hour12:     false,
  }) + " UTC";
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchNHI(network: string): Promise<NHIData> {
  const res = await fetch(`/api/network/nhi?network=${encodeURIComponent(network)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<NHIData>;
}

// ── NHIBadge — compact pill for nav bar ──────────────────────────────────────
// Note: nav.tsx has its own inline NhiBadge; this export is for other consumers.

export function NHIBadge({ network = "shelbynet" }: { network?: string }) {
  const { isDark } = useTheme();
  const [data, setData] = useState<NHIData | null>(null);

  const load = useCallback(async () => {
    try { setData(await fetchNHI(network)); } catch { /* keep stale */ }
  }, [network]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (!data) {
    return (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono select-none"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-muted)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full opacity-30" style={{ background: "currentColor" }} />
        NHI —
      </div>
    );
  }

  const cls = isDark ? DARK_COLOR[data.color] : LIGHT_COLOR[data.color];

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${cls.border} ${cls.bg} text-xs ${cls.text} font-mono cursor-default select-none`}
      title={`Network Health Index: ${data.nhi}/100 — ${data.label}\n\nSP Quorum: ${data.components.quorum.score}/100\nBlob Availability: ${data.components.blobAvailability.score}/100\nEpoch Health: ${data.components.epochHealth.score}/100\nStorage: ${data.components.storageUtilization.score}/100`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cls.dot} animate-pulse`} />
      NHI {data.nhi}
    </div>
  );
}

// ── NHICard — full stat card for landing / network page ──────────────────────

export function NHICard({ network = "shelbynet" }: { network?: string }) {
  const { isDark } = useTheme();
  const [data,    setData]    = useState<NHIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchNHI(network));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Skeleton — uses CSS vars so it respects both themes
  if (loading) {
    return (
      <div
        className="rounded-2xl border p-6 animate-pulse"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <div className="h-3 rounded w-2/5 mb-4" style={{ background: "var(--bg-hover)" }} />
        <div className="h-14 rounded w-1/4 mb-6" style={{ background: "var(--bg-hover)" }} />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-2 rounded w-3/4 mb-1" style={{ background: "var(--bg-hover)" }} />
              <div className="h-1 rounded-full" style={{ background: "var(--bg-hover)" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error
  if (error || !data) {
    return (
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
          Network Health Index
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Unavailable</p>
      </div>
    );
  }

  const cls = isDark ? DARK_COLOR[data.color] : LIGHT_COLOR[data.color];

  // Label row text: slightly muted variant relative to the accent color
  const labelTextCls  = isDark ? "opacity-90" : "opacity-80";
  // Detail sub-text
  const detailCls     = isDark ? "text-white/30" : "text-black/35";
  // Score meta text
  const scoreCls      = isDark ? "text-white/50" : "text-black/50";
  const scoreMultiCls = isDark ? "text-white/25" : "text-black/25";
  // Track background
  const trackStyle    = isDark ? { background: "rgba(255,255,255,0.08)" } : { background: "rgba(0,0,0,0.08)" };
  // Footer text
  const footerCls     = isDark ? "text-white/25" : "text-black/35";

  // ── Quorum detail: "16 healthy / 2 faulty" ──
  const q = data.components.quorum as Record<string, unknown>;
  const healthySPs = (q["healthySPs"] as number | undefined) ?? (q["activeProviders"] as number | undefined) ?? 0;
  const totalSPs   = (q["totalSPs"]   as number | undefined) ?? healthySPs;
  const faultySPs  = (q["faultySPs"]  as number | undefined) ?? (totalSPs - healthySPs);
  const quorumDetail =
    faultySPs > 0
      ? `${healthySPs} healthy · ${faultySPs} faulty`
      : `${healthySPs}/${totalSPs} healthy`;

  // ── Blob detail: show count or "no blobs" ──
  const activeBlobs = data.components.blobAvailability.activeBlobs;
  const totalBlobs  = data.components.blobAvailability.totalBlobs;
  const blobDetail =
    activeBlobs > 0
      ? `${activeBlobs.toLocaleString("en-US")} active`
      : totalBlobs === 0
        ? "no blobs registered"
        : "0 active blobs";

  const breakdown = [
    {
      label:  "SP Quorum",
      score:  data.components.quorum.score,
      weight: "30%",
      detail: quorumDetail,
    },
    {
      label:  "Blob Availability",
      score:  data.components.blobAvailability.score,
      weight: "25%",
      detail: blobDetail,
    },
    {
      label:  "Epoch Health",
      score:  data.components.epochHealth.score,
      weight: "25%",
      detail: null,
    },
    {
      label:  "Storage",
      score:  data.components.storageUtilization.score,
      weight: "20%",
      detail: null,
    },
  ];

  return (
    <div className={`rounded-2xl border ${cls.border} ${cls.bg} p-6`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className={`text-xs uppercase tracking-wider mb-1.5 ${cls.text} ${labelTextCls}`}>
            Network Health Index
          </p>
          <div className={`text-5xl font-bold font-mono leading-none ${cls.text}`}>
            {data.nhi}
          </div>
          <p className={`text-sm mt-1.5 font-semibold ${cls.text}`}>{data.label}</p>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${cls.dot} animate-pulse mt-0.5 shrink-0`} />
      </div>

      {/* Component breakdown */}
      <div className="space-y-3">
        {breakdown.map(({ label, score, weight, detail }) => (
          <div key={label}>
            <div className="flex justify-between items-baseline mb-1">
              <div className="flex items-baseline gap-1.5">
                <span className={`text-xs ${cls.text} ${labelTextCls}`}>{label}</span>
                {detail && (
                  <span className={`text-xs ${detailCls}`}>— {detail}</span>
                )}
              </div>
              <span className={`text-xs font-mono ${scoreCls}`}>
                {score}
                <span className={scoreMultiCls}> ×{weight}</span>
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={trackStyle}>
              <div
                className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score, isDark)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer — UTC timestamp to match dashboard header */}
      <p className={`text-xs mt-4 font-mono ${footerCls}`}>
        Updated {fmtUTC(data.updatedAt)}
      </p>
    </div>
  );
}