// components/nhi-badge.tsx — v1.2
// CHANGES:
//   - Hover tooltip explaining NHI formula (? icon next to title)
//   - Theme-aware colors (light + dark)
//   - UTC timestamps

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "./theme-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NHIData {
  nhi: number;
  label: "Healthy" | "Degraded" | "Critical";
  color: "green" | "yellow" | "red";
  components: {
    quorum:             { score: number; weight: number; activeProviders: number; maxProviders: number; healthySPs?: number; totalSPs?: number; faultySPs?: number; minQuorum?: number };
    blobAvailability:   { score: number; weight: number; activeBlobs: number; totalBlobs: number };
    epochHealth:        { score: number; weight: number };
    storageUtilization: { score: number; weight: number };
  };
  network: string;
  updatedAt: string;
}

type ColorKey = "green" | "yellow" | "red";

// ── Color maps ────────────────────────────────────────────────────────────────

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

function scoreBarColor(score: number, isDark: boolean): string {
  if (isDark) {
    return score >= 80 ? "bg-green-400" : score >= 60 ? "bg-yellow-400" : "bg-red-400";
  }
  return score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
}

function fmtUTC(iso: string): string {
  return (
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "UTC", hour12: false,
    }) + " UTC"
  );
}

async function fetchNHI(network: string): Promise<NHIData> {
  const res = await fetch(`/api/network/nhi?network=${encodeURIComponent(network)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<NHIData>;
}

// ── NHI Tooltip ───────────────────────────────────────────────────────────────

function NHITooltip({ isDark }: { isDark: boolean }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setVisible(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  const tooltipBg     = isDark ? "bg-[#1a1f2e] border-white/15 text-white/80"   : "bg-white border-black/10 text-black/75";
  const tooltipHead   = isDark ? "text-white font-semibold"                       : "text-black font-semibold";
  const tooltipMuted  = isDark ? "text-white/40"                                  : "text-black/40";
  const tooltipAccent = isDark ? "text-white/60"                                  : "text-black/60";
  const btnCls        = isDark
    ? "w-4 h-4 rounded-full border border-white/20 bg-white/10 text-white/40 hover:text-white/70 hover:border-white/40 transition-colors flex items-center justify-center text-[10px] font-bold cursor-pointer select-none"
    : "w-4 h-4 rounded-full border border-black/15 bg-black/5 text-black/40 hover:text-black/70 hover:border-black/30 transition-colors flex items-center justify-center text-[10px] font-bold cursor-pointer select-none";

  const rows = [
    {
      name:   "SP Quorum",
      weight: "30%",
      color:  isDark ? "text-blue-400" : "text-blue-600",
      desc:   "Network has ≥12 healthy SPs (min quorum). Starts at 100 once the threshold is met; each faulty SP reduces the score.",
    },
    {
      name:   "Blob Availability",
      weight: "25%",
      color:  isDark ? "text-purple-400" : "text-purple-600",
      desc:   "Are blobs stored on the network? Active blobs present → 100. New/empty network → 80 (neutral). All blobs gone → 0.",
    },
    {
      name:   "Epoch Health",
      weight: "25%",
      color:  isDark ? "text-cyan-400" : "text-cyan-600",
      desc:   "Is the monitoring pipeline running? Measures how recently epoch data was recorded. Fresh < 30 min → 100, stale 30 min–2 h → 50, offline → 0.",
    },
    {
      name:   "Storage",
      weight: "20%",
      color:  isDark ? "text-emerald-400" : "text-emerald-600",
      desc:   "Storage capacity utilization. Defaults to 100 — on-chain capacity reporting is enabled at mainnet.",
    },
  ];

  return (
    <div className="relative" ref={ref}>
      {/* ? button */}
      <button
        className={btnCls}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible((v) => !v)}
        aria-label="How is NHI calculated?"
      >
        ?
      </button>

      {/* Tooltip panel */}
      {visible && (
        <div
          className={`absolute left-0 top-6 z-50 w-80 rounded-xl border shadow-xl p-4 text-xs ${tooltipBg}`}
          // Keep visible when mouse moves into the panel
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => setVisible(false)}
        >
          {/* Header */}
          <p className={`text-sm mb-0.5 ${tooltipHead}`}>Network Health Index</p>
          <p className={`mb-3 leading-relaxed ${tooltipAccent}`}>
            A composite 0–100 score. Four weighted components are combined every 60 seconds.
          </p>

          {/* Components */}
          <div className="space-y-3">
            {rows.map(({ name, weight, color, desc }) => (
              <div key={name}>
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className={`font-semibold ${color}`}>{name}</span>
                  <span className={`${tooltipMuted}`}>× {weight}</span>
                </div>
                <p className={`leading-relaxed ${tooltipAccent}`}>{desc}</p>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className={`mt-3 pt-3 border-t flex gap-4 ${tooltipMuted}`} style={{ borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> ≥ 80 Healthy</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 60–79 Degraded</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"   /> &lt; 60 Critical</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── NHIBadge — compact pill for nav bar ──────────────────────────────────────

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
      title={`Network Health Index: ${data.nhi}/100 — ${data.label}`}
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

  if (loading) {
    return (
      <div className="rounded-2xl border p-6 animate-pulse" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
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

  if (error || !data) {
    return (
      <div className="rounded-2xl border p-6" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Network Health Index</p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Unavailable</p>
      </div>
    );
  }

  const cls       = isDark ? DARK_COLOR[data.color] : LIGHT_COLOR[data.color];
  const labelMod  = isDark ? "opacity-90" : "opacity-80";
  const detailCls = isDark ? "text-white/30" : "text-black/35";
  const scoreCls  = isDark ? "text-white/50" : "text-black/50";
  const multCls   = isDark ? "text-white/25" : "text-black/25";
  const trackSty  = isDark ? { background: "rgba(255,255,255,0.08)" } : { background: "rgba(0,0,0,0.08)" };
  const footerCls = isDark ? "text-white/25" : "text-black/35";

  // ── Quorum detail ──
  const q           = data.components.quorum as Record<string, unknown>;
  const healthySPs  = (q["healthySPs"]  as number | undefined) ?? (q["activeProviders"] as number | undefined) ?? 0;
  const totalSPs    = (q["totalSPs"]    as number | undefined) ?? healthySPs;
  const faultySPs   = (q["faultySPs"]   as number | undefined) ?? Math.max(0, totalSPs - healthySPs);
  const quorumDetail = faultySPs > 0
    ? `${healthySPs} healthy · ${faultySPs} faulty`
    : `${healthySPs}/${totalSPs} healthy`;

  // ── Blob detail ──
  const activeBlobs = data.components.blobAvailability.activeBlobs;
  const totalBlobs  = data.components.blobAvailability.totalBlobs;
  const blobDetail =
    activeBlobs > 0 ? `${activeBlobs.toLocaleString("en-US")} active` :
    totalBlobs  === 0 ? "no blobs registered" :
    "0 active blobs";

  const breakdown = [
    { label: "SP Quorum",         score: data.components.quorum.score,             weight: "30%", detail: quorumDetail },
    { label: "Blob Availability", score: data.components.blobAvailability.score,   weight: "25%", detail: blobDetail   },
    { label: "Epoch Health",      score: data.components.epochHealth.score,         weight: "25%", detail: null         },
    { label: "Storage",           score: data.components.storageUtilization.score,  weight: "20%", detail: null         },
  ];

  return (
    <div className={`rounded-2xl border ${cls.border} ${cls.bg} p-6`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex-1">
          {/* Title row with ? tooltip */}
          <div className="flex items-center gap-2 mb-1.5">
            <p className={`text-xs uppercase tracking-wider ${cls.text} ${labelMod}`}>
              Network Health Index
            </p>
            <NHITooltip isDark={isDark} />
          </div>
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
                <span className={`text-xs ${cls.text} ${labelMod}`}>{label}</span>
                {detail && <span className={`text-xs ${detailCls}`}>— {detail}</span>}
              </div>
              <span className={`text-xs font-mono ${scoreCls}`}>
                {score}<span className={multCls}> ×{weight}</span>
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={trackSty}>
              <div
                className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(score, isDark)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className={`text-xs mt-4 font-mono ${footerCls}`}>
        Updated {fmtUTC(data.updatedAt)}
      </p>
    </div>
  );
}