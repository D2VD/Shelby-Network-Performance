// hooks/use-blob-search.ts — v1.0
// Priority 4: Blob Explorer — search logic extracted into a hook
// Handles: blob_id exact lookup, owner address search, status filter, pagination
//
// Drop into app/explorer/page.tsx:
//   import { useBlobSearch } from "@/hooks/use-blob-search";
//   const blob = useBlobSearch({ network });

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BlobStatus = "all" | "active" | "pending" | "deleted";

export interface BlobRecord {
  blob_id:          string;
  owner_address:    string;
  size_bytes:       number;
  status:           string;
  registered_at:    string;
  expires_at:       string | null;
  placement_groups: string[] | null;
}

export interface BlobSearchState {
  results:    BlobRecord[];
  single:     BlobRecord | null;   // exact blob_id hit
  total:      number;
  page:       number;
  loading:    boolean;
  error:      string | null;
  isBlobId:   boolean;             // true when input matches blob_id pattern
}

export interface BlobSearchControls {
  query:     string;
  setQuery:  (v: string) => void;
  status:    BlobStatus;
  setStatus: (v: BlobStatus) => void;
  setPage:   (v: number) => void;
  refresh:   () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Detect a blob_id: 0x-prefixed 64-char hex OR bare 64-char hex
const BLOB_ID_RE = /^(0x)?[0-9a-f]{64}$/i;
const isBlobId = (s: string) => BLOB_ID_RE.test(s.trim());

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBlobSearch({
  network,
  pageSize = 20,
}: {
  network:   string;
  pageSize?: number;
}): [BlobSearchState, BlobSearchControls] {
  const [query,   setQuery]   = useState("");
  const [status,  setStatus]  = useState<BlobStatus>("all");
  const [page,    setPage]    = useState(1);
  const [state,   setState]   = useState<BlobSearchState>({
    results: [], single: null, total: 0, page: 1,
    loading: false, error: null, isBlobId: false,
  });

  const abortRef = useRef<AbortController | null>(null);

  const fetch_ = useCallback(async (q: string, s: BlobStatus, p: number) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const trimmed  = q.trim();
      const isId     = isBlobId(trimmed);
      const params   = new URLSearchParams({ network, limit: String(pageSize), page: String(p) });

      if (trimmed) {
        if (isId) {
          params.set("id", trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`);
        } else if (/^0x[0-9a-f]{62,66}$/i.test(trimmed)) {
          // Looks like an address (shorter than blob_id) — search by owner
          params.set("owner", trimmed);
        } else {
          // Treat as name/partial search
          params.set("name", trimmed);
        }
      }

      if (s !== "all") params.set("status", s);

      const res  = await fetch(`/api/network/blobs-data?${params}`, { signal: ac.signal });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        setState((prev) => ({
          ...prev, loading: false,
          error: (data["error"] as string | undefined) ?? "Request failed",
        }));
        return;
      }

      // Exact blob_id hit → { blob, network }
      if (data["blob"]) {
        setState({
          results: [], single: data["blob"] as BlobRecord,
          total: 1, page: p, loading: false, error: null, isBlobId: true,
        });
        return;
      }

      // List result → { blobs, total, page, limit }
      setState({
        results:  (data["blobs"] as BlobRecord[] | undefined) ?? [],
        single:   null,
        total:    (data["total"]  as number | undefined) ?? 0,
        page:     p,
        loading:  false,
        error:    null,
        isBlobId: isId,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev, loading: false, error: "Network error — please retry.",
      }));
    }
  }, [network, pageSize]);

  // Re-fetch when query / status / page changes (debounced for free-text)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = isBlobId(query) || query === "" ? 0 : 400;
    debounceRef.current = setTimeout(() => fetch_(query, status, page), delay);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, status, page, fetch_]);

  // Reset page when query/status changes
  const handleSetQuery  = (v: string) => { setPage(1); setQuery(v);  };
  const handleSetStatus = (v: BlobStatus) => { setPage(1); setStatus(v); };
  const refresh = () => fetch_(query, status, page);

  return [
    state,
    { query, setQuery: handleSetQuery, status, setStatus: handleSetStatus, setPage, refresh },
  ];
}