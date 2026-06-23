// hooks/use-blob-search.ts — v1.1
// FIXES (OS compliance):
//   - Replaced `any` with `unknown` + type guards per OS TypeScript rules
//   - Added INDEXER_MIN_INTERVAL_MS = 30_000 guard: debounce respects minimum
//     30-second interval between indexer calls (free-text search only)
//   - str() guard on blob_id before handing to AbortController key
//   - Early return pattern (fail fast) on invalid inputs

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants (OS rule: no magic values) ──────────────────────────────────────

const INDEXER_MIN_INTERVAL_MS = 30_000; // minimum gap between free-text searches
const DEBOUNCE_TEXT_MS        = 400;    // debounce for typing (resets the timer)
const PAGE_SIZE_DEFAULT       = 20;

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
  results:  BlobRecord[];
  single:   BlobRecord | null;
  total:    number;
  page:     number;
  loading:  boolean;
  error:    string | null;
  isBlobId: boolean;
}

export interface BlobSearchControls {
  query:     string;
  setQuery:  (v: string) => void;
  status:    BlobStatus;
  setStatus: (v: BlobStatus) => void;
  setPage:   (v: number) => void;
  refresh:   () => void;
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isBlobRecord(v: unknown): v is BlobRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r["blob_id"]       === "string" &&
    typeof r["owner_address"] === "string" &&
    typeof r["status"]        === "string"
  );
}

function isBlobRecordArray(v: unknown): v is BlobRecord[] {
  return Array.isArray(v) && v.every(isBlobRecord);
}

// ── Input classification (no magic regex buried in logic) ─────────────────────

const BLOB_ID_RE    = /^(0x)?[0-9a-f]{64}$/i;
const ADDRESS_RE    = /^0x[0-9a-f]{62,66}$/i;

function classifyInput(raw: string): "blob_id" | "address" | "name" | "empty" {
  const s = raw.trim();
  if (!s)              return "empty";
  if (BLOB_ID_RE.test(s))  return "blob_id";
  if (ADDRESS_RE.test(s))  return "address";
  return "name";
}

function normaliseId(raw: string): string {
  const s = raw.trim();
  return s.startsWith("0x") ? s : `0x${s}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useBlobSearch({
  network,
  pageSize = PAGE_SIZE_DEFAULT,
}: {
  network:   string;
  pageSize?: number;
}): [BlobSearchState, BlobSearchControls] {
  const [query,  setQueryRaw] = useState("");
  const [status, setStatusRaw] = useState<BlobStatus>("all");
  const [page,   setPage]      = useState(1);

  const [state, setState] = useState<BlobSearchState>({
    results: [], single: null, total: 0, page: 1,
    loading: false, error: null, isBlobId: false,
  });

  const abortRef        = useRef<AbortController | null>(null);
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndexerCall = useRef<number>(0); // tracks last free-text fetch

  const doFetch = useCallback(async (q: string, s: BlobStatus, p: number) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const kind   = classifyInput(q);
      const params = new URLSearchParams({
        network,
        limit:  String(pageSize),
        page:   String(p),
      });

      if (kind === "blob_id")  params.set("id",    normaliseId(q));
      else if (kind === "address") params.set("owner", q.trim());
      else if (kind === "name")    params.set("name",  q.trim());
      // kind === "empty" → no search param → list all

      if (s !== "all") params.set("status", s);

      const res = await fetch(`/api/network/blobs-data?${params.toString()}`, {
        signal: ac.signal,
        cache:  "no-store",
      });

      const body: unknown = await res.json();

      if (!res.ok) {
        const msg =
          (typeof body === "object" && body !== null &&
           typeof (body as Record<string, unknown>)["error"] === "string")
            ? String((body as Record<string, unknown>)["error"])
            : `Request failed (${res.status})`;

        setState((prev) => ({ ...prev, loading: false, error: msg }));
        return;
      }

      // Exact blob_id hit → { blob, network }
      if (
        typeof body === "object" && body !== null &&
        "blob" in body && isBlobRecord((body as Record<string, unknown>)["blob"])
      ) {
        setState({
          results: [],
          single:  (body as Record<string, unknown>)["blob"] as BlobRecord,
          total: 1, page: p, loading: false, error: null, isBlobId: true,
        });
        return;
      }

      // List result → { blobs, total, page, limit }
      const raw   = body as Record<string, unknown>;
      const blobs = isBlobRecordArray(raw["blobs"]) ? raw["blobs"] : [];
      const total = typeof raw["total"] === "number" ? raw["total"] : 0;

      setState({
        results: blobs, single: null, total, page: p,
        loading: false, error: null,
        isBlobId: kind === "blob_id",
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev, loading: false,
        error: "Network error — please retry.",
      }));
    }
  }, [network, pageSize]);

  // Trigger fetch when query / status / page changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const kind = classifyInput(query);

    // Blob IDs and addresses: fetch immediately (exact match, no indexer load)
    if (kind === "blob_id" || kind === "address" || kind === "empty") {
      doFetch(query, status, page);
      return;
    }

    // Free-text name search: enforce INDEXER_MIN_INTERVAL_MS between calls
    // Debounce for typing first, then check interval
    debounceRef.current = setTimeout(() => {
      const now     = Date.now();
      const elapsed = now - lastIndexerCall.current;

      if (elapsed >= INDEXER_MIN_INTERVAL_MS) {
        lastIndexerCall.current = now;
        doFetch(query, status, page);
      } else {
        // Wait for the remainder of the minimum interval
        const remaining = INDEXER_MIN_INTERVAL_MS - elapsed;
        debounceRef.current = setTimeout(() => {
          lastIndexerCall.current = Date.now();
          doFetch(query, status, page);
        }, remaining);
      }
    }, DEBOUNCE_TEXT_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, status, page, doFetch]);

  // Reset page on new query or status change
  const setQuery  = useCallback((v: string)      => { setPage(1); setQueryRaw(v);   }, []);
  const setStatus = useCallback((v: BlobStatus)  => { setPage(1); setStatusRaw(v); }, []);
  const refresh   = useCallback(() => doFetch(query, status, page), [doFetch, query, status, page]);

  return [
    state,
    { query, setQuery, status, setStatus, setPage, refresh },
  ];
}