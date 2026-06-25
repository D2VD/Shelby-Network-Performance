// components/nhi-badge.tsx — v1.3
// FIXES:
//   - Optional chaining on ALL data.components.*.score accesses
//     Prevents "Cannot read properties of undefined (reading 'score')"
//     crash when API shape differs or components object is incomplete
//   - Safe breakdown helper: returns 0 for any missing component score
//   - try/catch around breakdown array construction
//   - Retain v1.2 features: theme-aware colors, UTC timestamp, tooltip

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "./theme-context";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NHIComponents {
  quorum?:             { score?: number; weight?: number; healthySPs?: number; totalSPs?: number; faultySPs?: number; activeProviders?: number; maxProviders?: number };
  blobAvailability?:   { score?: number; weight?: number; activeBlobs?: number; totalBlobs?: number };
  epochHealth?:        { score?: number; weight?: number };
  storageUtilization?: { score?: number; weight?: number };
}

interface NHIData {
  nhi:        number;
  label:      string;
  color:      "green" | "yellow" | "red";
  components?: NHIComponents;
  network:    string;
  updatedAt:  string;
}

type ColorKey = "green" | "yellow" | "red";

// ── Safe component accessor — never throws ────────────────────────────────────

function safeScore(components: NHIComponents | undefined, key: keyof NHIComponents): number {
  return components?.[key]?.score ?? 0;
}

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

const VALID_COLORS: ColorKey[] = ["green", "yellow", "red"];
function safeColor(c: string | undefined): ColorKey {
  return VALID_COLORS.includes(c as ColorKey) ? (c as ColorKey) : "red";
}

function scoreBarColor(score: number, isDark: boolean): string {
  if (isDark) return score >= 80 ? "bg-green-400" : score >= 60 ? "bg-yellow-400" : "bg-red-400";
  return score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
}

function fmtUTC(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZone: "UTC", hour12: false,
    }) + " UTC";
  } catch { return "—"; }
}

async function fetchNHI(network: string): Promise<NHIData> {
  const res = await fetch(`/api/network/nhi?network=${encodeURIComponent(network)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<NHIData>;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function NHITooltip({ isDark }: { isDark: boolean }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setVisible(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [visible]);

  const tooltipBg    = isDark ? "bg-[#1a1f2e] border-white/15 text-white/80"  : "bg-white border-black/10 text-black/75";
  const tooltipHead  = isDark ? "text-white font-semibold"                      : "text-black font-semibold";
  const tooltipMuted = isDark ? "text-white/40"                                 : "text-black/40";
  const tooltipAccnt = isDark ? "text-white/60"                                 : "text-black/60";
  const btnCls       = isDark
    ? "w-4 h-4 rounded-full border border-white/20 bg-white/10 text-white/40 hover:text-white/70 hover:border-white/40 transition-colors flex items-center justify-center text-[10px] font-bold cursor-pointer select-none"
    : "w-4 h-4 rounded-full border border-black/15 bg-black/5 text-black/40 hover:text-black/70 hover:border-black/30 transition-colors flex items-center justify-center text-[10px] font-bold cursor-pointer select-none";
  const dividerStyle = { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)" };

  const rows = [
    { name: "SP Quorum",         weight: "30%", color: isDark ? "text-blue-400"    : "text-blue-600",    desc: "Network has ≥12 healthy SPs (min quorum). Starts at 100 once threshold is met; deducts for faulty SPs." },
    { name: "Blob Availability", weight: "25%", color: isDark ? "text-purple-400"  : "text-purple-600",  desc: "Are blobs stored? Active blobs → 100. Empty network → 80 (neutral). All blobs gone → 0." },
    { name: "Epoch Health",      weight: "25%", color: isDark ? "text-cyan-400"    : "text-cyan-600",    desc: "Is the monitoring pipeline running? Snapshot age < 30 min → 100, 30 min–2 h → 50, offline → 0." },
    { name: "Storage",           weight: "20%", color: isDark ? "text-emerald-400" : "text-emerald-600", desc: "Storage capacity. Defaults to 100 — on-chain capacity reporting is enabled at mainnet." },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        className={btnCls}
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onClick={() => setVisible((v) => !v)}
        aria-label="How is NHI calculated?"
      >?</button>

      {visible && (
        <div
          className={`absolute left-0 top-6 z-50 w-80 rounded-xl border shadow-xl p-4 text-xs ${tooltipBg}`}
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => setVisible(false)}
        >
          <p className={`text-sm mb-0.5 ${tooltipHead}`}>Network Health Index</p>
          <p className={`mb-3 leading-relaxed ${tooltipAccnt}`}>
            A composite 0–100 score. Four weighted components combined every 60 seconds.
          </p>
          <div className="space-y-3">
            {rows.map(({ name, weight, color, desc }) => (
              <div key={name}>
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className={`font-semibold ${color}`}>{name}</span>
                  <span className={tooltipMuted}>× {weight}</span>
                </div>
                <p className={`leading-relaxed ${tooltipAccnt}`}>{desc}</p>
              </div>
            ))}
          </div>
          <div className={`mt-3 pt-3 border-t flex gap-4 ${tooltipMuted}`} style={dividerStyle}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> ≥ 80 Healthy</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> 60–79 Degraded</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &lt; 60 Critical</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── NHIBadge ──────────────────────────────────────────────────────────────────

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
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-mono select-none"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)", color: "var(--text-muted)" }}>
        <span className="w-1.5 h-1.5 rounded-full opacity-30" style={{ background: "currentColor" }} />
        NHI —
      </div>
    );
  }

  const color = safeColor(data.color);
  const cls   = isDark ? DARK_COLOR[color] : LIGHT_COLOR[color];

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${cls.border} ${cls.bg} text-xs ${cls.text} font-mono cursor-default select-none`}
      title={`Network Health Index: ${data.nhi ?? 0}/100 — ${data.label ?? ""}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cls.dot} animate-pulse`} />
      NHI {data.nhi ?? 0}
    </div>
  );
}

// ── NHICard ───────────────────────────────────────────────────────────────────

export function NHICard({ network = "shelbynet" }: { network?: string }) {
  const { isDark } = useTheme();
  const [data,    setData]    = useState<NHIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const load = useCallback(async () => {
    try { setData(await fetchNHI(network)); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [network]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border p-6 animate-pulse"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <div className="h-3 rounded w-2/5 mb-4" style={{ background: "var(--bg-hover)" }} />
        <div className="h-14 rounded w-1/4 mb-6" style={{ background: "var(--bg-hover)" }} />
        {[1,2,3,4].map((i) => (
          <div key={i} className="mb-3">
            <div className="h-2 rounded w-3/4 mb-1" style={{ background: "var(--bg-hover)" }} />
            <div className="h-1 rounded-full"        style={{ background: "var(--bg-hover)" }} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border p-6"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>Network Health Index</p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Unavailable</p>
      </div>
    );
  }

  const color     = safeColor(data.color);
  const cls       = isDark ? DARK_COLOR[color] : LIGHT_COLOR[color];
  const labelMod  = isDark ? "opacity-90" : "opacity-80";
  const detailCls = isDark ? "text-white/30" : "text-black/35";
  const scoreCls  = isDark ? "text-white/50" : "text-black/50";
  const multCls   = isDark ? "text-white/25" : "text-black/25";
  const trackSty  = isDark ? { background: "rgba(255,255,255,0.08)" } : { background: "rgba(0,0,0,0.08)" };
  const footerCls = isDark ? "text-white/25" : "text-black/35";

  // ── Safe quorum detail (never throws) ──
  const healthySPs   = data.components?.quorum?.healthySPs   ?? data.components?.quorum?.activeProviders ?? 0;
  const totalSPs     = data.components?.quorum?.totalSPs     ?? healthySPs;
  const faultySPs    = data.components?.quorum?.faultySPs    ?? Math.max(0, totalSPs - healthySPs);
  const quorumDetail = faultySPs > 0
    ? `${healthySPs} healthy · ${faultySPs} faulty`
    : `${healthySPs}/${totalSPs} healthy`;

  const activeBlobs = data.components?.blobAvailability?.activeBlobs ?? 0;
  const totalBlobs  = data.components?.blobAvailability?.totalBlobs  ?? 0;
  const blobDetail  =
    activeBlobs > 0    ? `${activeBlobs.toLocaleString("en-US")} active` :
    totalBlobs  === 0  ? "no blobs registered"                           :
    "0 active blobs";

  // ── Breakdown uses safeScore — never throws ──
  const breakdown = [
    { label: "SP Quorum",         score: safeScore(data.components, "quorum"),             weight: "30%", detail: quorumDetail },
    { label: "Blob Availability", score: safeScore(data.components, "blobAvailability"),   weight: "25%", detail: blobDetail   },
    { label: "Epoch Health",      score: safeScore(data.components, "epochHealth"),         weight: "25%", detail: null         },
    { label: "Storage",           score: safeScore(data.components, "storageUtilization"),  weight: "20%", detail: null         },
  ];

  return (
    <div className={`rounded-2xl border ${cls.border} ${cls.bg} p-6`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <p className={`text-xs uppercase tracking-wider ${cls.text} ${labelMod}`}>
              Network Health Index
            </p>
            <NHITooltip isDark={isDark} />
          </div>
          <div className={`text-5xl font-bold font-mono leading-none ${cls.text}`}>
            {data.nhi ?? 0}
          </div>
          <p className={`text-sm mt-1.5 font-semibold ${cls.text}`}>
            {data.label ?? "Unknown"}
          </p>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${cls.dot} animate-pulse mt-0.5 shrink-0`} />
      </div>

      {/* Breakdown */}
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
        Updated {fmtUTC(data.updatedAt ?? "")}
      </p>
    </div>
  );
}