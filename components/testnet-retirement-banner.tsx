"use client";
/**
 * components/testnet-retirement-banner.tsx — v1.0
 *
 * Shelby announced (2026-07-30, via Discord) that Early Access testnet shuts
 * down Monday, August 3, 2026 at 12:00 PDT, and the testnet explorer becomes
 * a static graduation page after that. Shelbynet remains online.
 *
 * This replaces the previous static purple "Live data from Aptos Testnet
 * RPC + Indexer V3" badge on /network (page.tsx line ~904), which becomes a
 * false claim the moment testnet actually goes dark. This component instead
 * shows a live-computed state relative to the cutoff:
 *   - Before cutoff: warning + countdown, prompts exporting any needed data.
 *   - After cutoff: clearly states testnet is retired and data is a frozen
 *     snapshot, points at shelbynet as the live network.
 *
 * Only renders when isTestnet is true — no-op on shelbynet.
 *
 * Countdown ticks once a minute (day/hour granularity is enough here,
 * unlike the second-level EpochCountdown elsewhere in this codebase).
 */

import { useEffect, useState } from "react";

// Monday, August 3, 2026, 12:00 PDT (UTC-7) — per Shelby's Early Access
// graduation announcement.
const TESTNET_SHUTDOWN_MS = new Date("2026-08-03T12:00:00-07:00").getTime();

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "0m";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const days    = Math.floor(totalMinutes / 1440);
  const hours   = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0)    parts.push(`${days}d`);
  if (hours > 0)    parts.push(`${hours}h`);
  if (days === 0)   parts.push(`${minutes}m`); // only show minutes once under a day, keeps it compact
  return parts.join(" ");
}

export function TestnetRetirementBanner({ isTestnet }: { isTestnet: boolean }) {
  const [now, setNow] = useState<number | null>(null); // null until mounted, avoids SSR/client clock mismatch

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!isTestnet) return null;
  if (now === null) return null; // first client render only, avoids hydration flicker

  const retired = now >= TESTNET_SHUTDOWN_MS;

  if (retired) {
    return (
      <div style={{
        background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13,
        color: "#f87171", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      }}>
        <span>⛔</span>
        <span>
          Shelby testnet was retired on August 3, 2026 as Early Access graduated to production.
          Data shown below is a frozen snapshot from before shutdown, not live.
        </span>
        <span style={{ color: "var(--text-muted)" }}>— Shelbynet remains live; switch networks to view current data.</span>
      </div>
    );
  }

  const msLeft = TESTNET_SHUTDOWN_MS - now;
  const urgent = msLeft < 24 * 60 * 60 * 1000; // final day gets a stronger color

  return (
    <div style={{
      background: urgent ? "rgba(239,68,68,0.08)" : "rgba(147,51,234,0.07)",
      border: `1px solid ${urgent ? "rgba(239,68,68,0.3)" : "rgba(147,51,234,0.25)"}`,
      borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13,
      color: urgent ? "#f87171" : "#c084fc", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    }}>
      <span>⚗</span>
      <span>Shelby Testnet · Live data from Aptos Testnet RPC + Indexer V3</span>
      <span style={{ color: "var(--text-muted)" }}>
        — Retiring in <strong style={{ color: urgent ? "#f87171" : "#c084fc" }}>{formatCountdown(msLeft)}</strong>{" "}
        (Mon Aug 3, 12:00 PDT). Export any testnet data you need before then.
      </span>
    </div>
  );
}