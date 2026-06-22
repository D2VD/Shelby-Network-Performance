// components/nhi-badge.tsx
// Network Health Index — badge (nav) + card (landing/network page)
// Priority 1: Network Health Index

"use client";

import { useCallback, useEffect, useState } from "react";

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

// ── Shared helpers ────────────────────────────────────────────────────────────

const COLOR = {
  green:  { bg: "bg-green-500/10",  border: "border-green-500/25",  text: "text-green-400",  dot: "bg-green-400",  bar: "bg-green-400"  },
  yellow: { bg: "bg-yellow-500/10", border: "border-yellow-500/25", text: "text-yellow-400", dot: "bg-yellow-400", bar: "bg-yellow-400" },
  red:    { bg: "bg-red-500/10",    border: "border-red-500/25",    text: "text-red-400",    dot: "bg-red-400",    bar: "bg-red-400"    },
} as const;

function scoreColor(score: number): string {
  if (score >= 80) return "bg-green-400";
  if (score >= 60) return "bg-yellow-400";
  return "bg-red-400";
}

async function fetchNHI(network: string): Promise<NHIData> {
  const res = await fetch(`/api/network/nhi?network=${encodeURIComponent(network)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<NHIData>;
}

// ── NHIBadge — compact pill for nav bar ──────────────────────────────────────

export function NHIBadge({ network = "shelbynet" }: { network?: string }) {
  const [data, setData] = useState<NHIData | null>(null);

  const load = useCallback(async () => {
    try { setData(await fetchNHI(network)); } catch { /* keep stale */ }
  }, [network]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Skeleton
  if (!data) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-xs text-white/30 font-mono select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
        NHI —
      </div>
    );
  }

  const cls = COLOR[data.color];

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

  // Skeleton
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 animate-pulse">
        <div className="h-3 bg-white/10 rounded w-2/5 mb-4" />
        <div className="h-14 bg-white/10 rounded w-1/4 mb-6" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-2 bg-white/10 rounded w-3/4 mb-1" />
              <div className="h-1 bg-white/10 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-xs text-white/40 uppercase tracking-wider mb-1">Network Health Index</p>
        <p className="text-white/30 text-sm">Unavailable</p>
      </div>
    );
  }

  const cls = COLOR[data.color];

  const breakdown = [
    {
      label:  "SP Quorum",
      score:  data.components.quorum.score,
      weight: "30%",
      detail: `${data.components.quorum.activeProviders}/${data.components.quorum.maxProviders} active`,
    },
    {
      label:  "Blob Availability",
      score:  data.components.blobAvailability.score,
      weight: "25%",
      detail: `${data.components.blobAvailability.activeBlobs.toLocaleString("en-US")} active`,
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
          <p className="text-xs text-white/50 uppercase tracking-wider mb-1.5">
            Network Health Index
          </p>
          <div className={`text-5xl font-bold font-mono leading-none ${cls.text}`}>
            {data.nhi}
          </div>
          <p className={`text-sm mt-1.5 font-medium ${cls.text}`}>{data.label}</p>
        </div>
        <span className={`w-2.5 h-2.5 rounded-full ${cls.dot} animate-pulse mt-0.5 shrink-0`} />
      </div>

      {/* Component breakdown */}
      <div className="space-y-3">
        {breakdown.map(({ label, score, weight, detail }) => (
          <div key={label}>
            <div className="flex justify-between items-baseline mb-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-white/60">{label}</span>
                {detail && (
                  <span className="text-xs text-white/30">— {detail}</span>
                )}
              </div>
              <span className="text-xs font-mono text-white/50">
                {score}
                <span className="text-white/25"> ×{weight}</span>
              </span>
            </div>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${scoreColor(score)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="text-xs text-white/25 mt-4 font-mono">
        {new Date(data.updatedAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </p>
    </div>
  );
}