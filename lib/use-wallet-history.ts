// lib/use-wallet-history.ts
"use client";
// Replaces the old localStorage-only useBenchHistory for the History tab.
// Fetches GET /api/benchmark/results/mine, which the backend filters
// server-side by the verified wallet session — no results at all if not
// connected/verified (device-id-only history is retired, see benchmark.ts
// header FIX 1).

import { useCallback, useEffect, useState } from "react";

export interface WalletHistoryEntry {
  id: string;
  mode: string;
  score: number;
  tier: string;
  avgUploadKbs: number;
  avgDownloadKbs: number;
  latency: { avg: number };
  tx: { confirmTime: number };
  maxSuccessfulBytes?: number;
  runAt: string;
}

export function useWalletHistory(sessionToken: string | null) {
  const [history, setHistory] = useState<WalletHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionToken) { setHistory([]); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/benchmark/results/mine?limit=100", {
        headers: { "x-wallet-session": sessionToken },
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        const mapped: WalletHistoryEntry[] = (j.results ?? []).map((rec: any) => ({
          id: rec.id,
          mode: rec.mode,
          score: rec.score,
          tier: rec.tier,
          avgUploadKbs: rec.avgUploadKbs,
          avgDownloadKbs: rec.avgDownloadKbs,
          latency: { avg: rec.latencyAvg ?? 0 },
          tx: { confirmTime: rec.txConfirmMs ?? 0 },
          maxSuccessfulBytes: rec.maxBytes,
          runAt: rec.ts ? new Date(rec.ts).toLocaleString() : "",
        }));
        setHistory(mapped);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [sessionToken]);

  useEffect(() => { refresh(); }, [refresh]);

  return { history, loading, refresh, displayHistory: [...history].reverse() };
}