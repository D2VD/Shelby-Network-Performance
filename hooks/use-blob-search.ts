// hooks/use-blob-search.ts — v1.2
// CHANGES: Updated BlobRecord to match actual blob_registry schema.
//   blob_id → blob_name, owner_address → owner,
//   removed placement_groups, added tx_hash/tx_version/num_slices/content_hash/content_type
//   Input classification: 0x+64hex → tx_hash exact lookup (?tx_hash=)

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const INDEXER_MIN_INTERVAL_MS = 30_000;
const DEBOUNCE_TEXT_MS        = 400;
const PAGE_SIZE_DEFAULT       = 20;

// ── Types — match actual blob_registry schema ─────────────────────────────────

export type BlobStatus = "all" | "active" | "pending" | "deleted";

export interface BlobRecord {
  blob_name:     string;
  owner:         string;
  size_bytes:    number | null;
  status:        string;
  registered_at: string;
  expires_at:    string | null;
  tx_hash:       string;
  tx_version:    number;
  num_slices:    number | null;
  content_hash:  string;
  content_type:  string;
}

export interface BlobSearchState {
  results:  BlobRecord[];
  single:   BlobRecord | null;
  total:    number;
  page:     number;
  loading:  boolean;
  error:    string | null;
  isTxHash: boolean; // true when input was an exact tx_hash lookup
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
  return typeof r["blob_name"] === "string" && typeof r["owner"] === "string";
}

function isBlobRecordArray(v: unknown): v is BlobRecord[] {
  return Array.isArray(v) && v.every(isBlobRecord);
}

// ── Input classification ──────────────────────────────────────────────────────
// 0x + 64 hex chars  → Aptos tx_hash  → ?tx_hash= (exact)
// 0x + 62–66 hex     → wallet address → ?owner=   (filter)
// anything else      → blob name      → ?name=    (ILIKE, rate-limited)

const TX_HASH_RE = /^(0x)?[0-9a-f]{64}$/i;
const ADDRESS_RE = /^0x[0-9a-f]{62,66}$/i;

type InputKind = "tx_hash" | "address" | "name" | "empty";

function classifyInput(raw: string): InputKind {
  const s = raw.trim();
  if (!s)                return "empty";
  if (TX_HASH_RE.test(s)) return "tx_hash";
  if (ADDRESS_RE.test(s)) return "address";
  return "name";
}

function normaliseHex(raw: string): string {
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
  const [query,    setQueryRaw]  = useState("");
  const [status,   setStatusRaw] = useState<BlobStatus>("all");
  const [page,     setPage]      = useState(1);

  const [state, setState] = useState<BlobSearchState>({
    results: [], single: null, total: 0, page: 1,
    loading: false, error: null, isTxHash: false,
  });

  const abortRef        = useRef<AbortController | null>(null);
  const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndexerCall = useRef<number>(0);

  const doFetch = useCallback(async (q: string, s: BlobStatus, p: number) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const kind   = classifyInput(q);
      const params = new URLSearchParams({
        network,
        limit: String(pageSize),
        page:  String(p),
      });

      if      (kind === "tx_hash") params.set("tx_hash", normaliseHex(q));
      else if (kind === "address") params.set("owner",   q.trim());
      else if (kind === "name")    params.set("name",    q.trim());
      // "empty" → no search param → list all

      if (s !== "all") params.set("status", s);

      const res  = await fetch(`/api/network/blobs-data?${params}`, {
        signal: ac.signal,
        cache:  "no-store",
      });

      const body: unknown = await res.json();

      if (!res.ok) {
        const errMsg =
          typeof body === "object" && body !== null &&
          typeof (body as Record<string, unknown>)["error"] === "string"
            ? String((body as Record<string, unknown>)["error"])
            : `Request failed (${res.status})`;
        setState((prev) => ({ ...prev, loading: false, error: errMsg }));
        return;
      }

      // Exact tx_hash hit → { blob, network }
      if (
        typeof body === "object" && body !== null &&
        "blob" in body &&
        isBlobRecord((body as Record<string, unknown>)["blob"])
      ) {
        setState({
          results: [],
          single:  (body as Record<string, unknown>)["blob"] as BlobRecord,
          total: 1, page: p, loading: false, error: null, isTxHash: true,
        });
        return;
      }

      // List → { blobs, total, page, limit }
      const raw   = body as Record<string, unknown>;
      const blobs = isBlobRecordArray(raw["blobs"]) ? raw["blobs"] : [];
      const total = typeof raw["total"] === "number" ? raw["total"] : 0;

      setState({
        results: blobs, single: null, total, page: p,
        loading: false, error: null, isTxHash: kind === "tx_hash",
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState((prev) => ({
        ...prev, loading: false, error: "Network error — please retry.",
      }));
    }
  }, [network, pageSize]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const kind = classifyInput(query);

    // Exact-match inputs: fetch immediately (no indexer load)
    if (kind === "tx_hash" || kind === "address" || kind === "empty") {
      doFetch(query, status, page);
      return;
    }

    // Name search: debounce + enforce INDEXER_MIN_INTERVAL_MS
    debounceRef.current = setTimeout(() => {
      const elapsed = Date.now() - lastIndexerCall.current;
      if (elapsed >= INDEXER_MIN_INTERVAL_MS) {
        lastIndexerCall.current = Date.now();
        doFetch(query, status, page);
      } else {
        debounceRef.current = setTimeout(() => {
          lastIndexerCall.current = Date.now();
          doFetch(query, status, page);
        }, INDEXER_MIN_INTERVAL_MS - elapsed);
      }
    }, DEBOUNCE_TEXT_MS);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, status, page, doFetch]);

  const setQuery  = useCallback((v: string)     => { setPage(1); setQueryRaw(v);   }, []);
  const setStatus = useCallback((v: BlobStatus) => { setPage(1); setStatusRaw(v); }, []);
  const refresh   = useCallback(() => doFetch(query, status, page), [doFetch, query, status, page]);

  return [state, { query, setQuery, status, setStatus, setPage, refresh }];
}