// hooks/use-activity-stream.ts — v1.0
//
// Headless variant of the connection logic in components/activity-feed.tsx.
// Lets a consumer (e.g. the Blobs Explorer table) react to live events without
// rendering the visual event-log widget. Single EventSource connection, same
// endpoint contract as ActivityFeed.

"use client";

import { useEffect, useRef, useState } from "react";

export type ActivityEventKind =
  | "connected"
  | "sp_health_change"
  | "sp_joined"
  | "sp_left"
  | "epoch_transition"
  | "blob_registered"
  | "blob_pending"
  | "blob_deleted"
  | "heartbeat";

export interface ActivityStreamEvent {
  kind:    ActivityEventKind;
  payload: Record<string, unknown>;
}

const VPS_BASE =
  typeof process !== "undefined"
    ? process.env["NEXT_PUBLIC_VPS_API_URL"] ?? "https://api.shelbyanalytics.site"
    : "https://api.shelbyanalytics.site";

const KINDS: ActivityEventKind[] = [
  "connected", "sp_health_change", "sp_joined", "sp_left",
  "epoch_transition", "blob_registered", "blob_pending", "blob_deleted", "heartbeat",
];

export function useActivityStream(
  network: string,
  onEvent: (e: ActivityStreamEvent) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let mounted = true;
    const url = `${VPS_BASE}/api/v1/activity/stream?network=${encodeURIComponent(network)}`;
    const es  = new EventSource(url);

    es.onopen  = () => { if (mounted) setConnected(true); };
    es.onerror = () => { if (mounted) setConnected(false); };

    const listeners = KINDS.map((kind) => {
      const handler = (e: MessageEvent) => {
        if (!mounted) return;
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(e.data); } catch { payload = { raw: e.data }; }
        onEventRef.current({ kind, payload });
      };
      es.addEventListener(kind, handler as EventListener);
      return { kind, handler };
    });

    return () => {
      mounted = false;
      listeners.forEach(({ kind, handler }) =>
        es.removeEventListener(kind, handler as EventListener));
      es.close();
    };
  }, [network]);

  return { connected };
}