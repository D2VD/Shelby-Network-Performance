// lib/use-bench-history.ts
// Manages benchmark history:
//   - Local: localStorage (fast, works offline, per browser)
//   - Server: GET /api/benchmark/results filtered by deviceId (cross-browser same device)
// The History tab shows LOCAL history (this browser only, honest count)
// Global Run History on Charts shows all server-side runs

"use client";

import { useState, useEffect, useCallback } from "react";
import { getDeviceId } from "./use-device-id";

export interface LocalHistoryEntry {
  id: number;
  mode: string;
  score: number;
  tier: string;
  avgUploadKbs: number;
  avgDownloadKbs: number;
  latency: { avg: number; min: number; max: number };
  tx: { submitTime: number; confirmTime: number; txHash: string | null };
  uploads: Array<{ bytes: number; elapsed: number; speedKbs: number; blobName: string; txHash: string | null }>;
  downloads: Array<{ bytes: number; elapsed: number; speedKbs: number }>;
  maxSuccessfulBytes?: number;
  runAt: string;
  runAtMs?: number;
  deviceId?: string;
}

const LOCAL_KEY    = "shelby_bench_history_v3";
const MAX_HISTORY  = 100; // raised from 10 — store more locally
const MAX_DISPLAY  = 50;  // show up to 50 in table

export function useBenchHistory() {
  const [history, setHistory] = useState<LocalHistoryEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const s = localStorage.getItem(LOCAL_KEY);
      if (s) {
        const parsed = JSON.parse(s) as LocalHistoryEntry[];
        setHistory(parsed);
      }
    } catch { /**/ }
  }, []);

  const saveRun = useCallback((res: any): LocalHistoryEntry => {
    const deviceId = getDeviceId();
    setHistory(prev => {
      const newId = (prev.length > 0 ? Math.max(...prev.map(h => h.id)) : 0) + 1;
      const entry: LocalHistoryEntry = {
        ...res,
        id: newId,
        runAtMs: Date.now(),
        deviceId,
      };
      const next = [...prev, entry].slice(-MAX_HISTORY);
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /**/ }
      return next;
    });
    return { ...res, id: 0, runAtMs: Date.now(), deviceId };
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try { localStorage.removeItem(LOCAL_KEY); } catch { /**/ }
  }, []);

  return { history, saveRun, clearHistory, displayHistory: history.slice(-MAX_DISPLAY).reverse() };
}