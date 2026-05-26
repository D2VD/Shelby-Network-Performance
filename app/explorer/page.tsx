"use client";
// app/explorer/page.tsx — v7.0
// Fixes:
// 1. Blob search uses `owner` field in dedicated indexer (not account_address)
// 2. Transaction search uses account_transactions with user_transaction.sender filter
// 3. Address normalization: lowercase before all comparisons/queries
// 4. blob_name field shown in results (filename from indexer)
// 5. Events tab for wallet activity

import { useState, useCallback, useRef, useEffect } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface BlobResult {
  blob_id:      string;
  blob_name?:   string;
  owner?:       string;
  size?:        number;
  media_type?:  string;
  epoch?:       number;
  deletable?:   boolean;
  certified?:   boolean;
  created_at?:  string;
}

interface TxResult {
  version:    string;
  hash:       string;
  sender?:    string;
  type:       string;
  success:    boolean;
  gas_used?:  string;
  timestamp?: string;
  function?:  string;
}

interface EventResult {
  sequence_number: string;
  type:            string;
  data:            Record<string, unknown>;
  transaction_version: string;
  event_index?:    string;
}

type SearchType = "blob" | "address" | "tx" | "event";
type AddressTab = "blobs" | "transactions" | "events";

// ─────────────────────────────────────────────────────────────────
// Dedicated indexer endpoint + queries
// ─────────────────────────────────────────────────────────────────
const DEDICATED_INDEXER = "https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql";

async function gqlFetch<T>(endpoint: string, query: string, variables: Record<string,unknown>, apiKey?: string): Promise<T> {
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json() as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0]!.message);
  if (!json.data) throw new Error("No data returned");
  return json.data;
}

// Normalize address: lowercase, ensure 0x prefix
function normalizeAddress(addr: string): string {
  let a = addr.trim().toLowerCase();
  if (!a.startsWith("0x")) a = "0x" + a;
  return a;
}

// Query blobs by owner from dedicated indexer
const BLOBS_BY_OWNER_QUERY = `
  query BlobsByOwner($owner: String!, $limit: Int!, $offset: Int!) {
    blobs(
      where: { owner: { _eq: $owner } }
      limit: $limit
      offset: $offset
      order_by: { epoch: desc }
    ) {
      blob_id
      blob_name
      owner
      size
      media_type
      epoch
      deletable
      certified
      created_at
    }
    blobs_aggregate(where: { owner: { _eq: $owner } }) {
      aggregate { count }
    }
  }
`;

// Query blob by ID from dedicated indexer
const BLOB_BY_ID_QUERY = `
  query BlobById($blob_id: String!) {
    blobs(where: { blob_id: { _eq: $blob_id } }, limit: 1) {
      blob_id
      blob_name
      owner
      size
      media_type
      epoch
      deletable
      certified
      created_at
    }
  }
`;

// Query transactions by sender via proxy route (VPS)
const TX_BY_SENDER_LIMIT = 25;

// Query events from indexer
const EVENTS_BY_ACCOUNT_QUERY = `
  query EventsByAccount($addr: String!, $limit: Int!, $offset: Int!) {
    events(
      where: {
        _or: [
          { data: { _cast: { String: { _ilike: $addr } } } }
          { account_address: { _eq: $addr } }
        ]
      }
      limit: $limit
      offset: $offset
      order_by: { transaction_version: desc }
    ) {
      sequence_number
      type
      data
      transaction_version
      event_index
    }
  }
`;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function shortAddr(a: string) {
  if (!a || a.length < 12) return a;
  return `${a.slice(0,8)}…${a.slice(-6)}`;
}

function fmtBytes(b?: number) {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
  if (b < 1024*1024*1024) return `${(b/1024/1024).toFixed(2)} MB`;
  return `${(b/1024/1024/1024).toFixed(3)} GB`;
}

function fmtTime(ts?: string) {
  if (!ts) return "—";
  try {
    const n = Number(ts);
    const d = new Date(n > 1e12 ? n/1000 : n * 1000);
    return isNaN(d.getTime()) ? new Date(ts).toLocaleString() : d.toLocaleString();
  } catch { return ts; }
}

function isAddress(s: string) { return /^0x[0-9a-fA-F]{1,64}$/.test(s.trim()); }
function isTxHash(s: string)  { return /^0x[0-9a-fA-F]{64}$/.test(s.trim()); }
function isBlobId(s: string)  { return /^[0-9a-fA-F]{64,}$/.test(s.trim()) || (/^0x/i.test(s.trim()) && s.trim().length > 20); }

function detectType(input: string): SearchType {
  const s = input.trim();
  if (!s) return "address";
  if (isAddress(s) && isTxHash(s)) return "tx"; // 0x + 64 hex = likely tx hash
  if (isAddress(s)) return "address";
  if (isBlobId(s)) return "blob";
  return "blob";
}

// ─────────────────────────────────────────────────────────────────
// Small UI pieces
// ─────────────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}
      title="Copy"
      style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:ok?"#22c55e":"var(--text-dim)", padding:"0 3px", lineHeight:1, flexShrink:0 }}>
      {ok ? "✓" : "⧉"}
    </button>
  );
}

function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span style={{ display:"inline-block", padding:"2px 8px", borderRadius:5, fontSize:10, fontWeight:600, background: color ? `${color}22` : "var(--bg-card2)", color: color ?? "var(--text-muted)", border: `1px solid ${color ? color + "44" : "var(--border)"}`, whiteSpace:"nowrap" }}>
      {label}
    </span>
  );
}

function Skeleton({ w=120, h=13 }: { w?:number; h?:number }) {
  return <div className="skeleton" style={{ width:w, height:h, borderRadius:4 }}/>;
}

// ─────────────────────────────────────────────────────────────────
// Blob card / row
// ─────────────────────────────────────────────────────────────────

function BlobRow({ blob, onSelect }: { blob: BlobResult; onSelect: (b: BlobResult) => void }) {
  return (
    <tr onClick={() => onSelect(blob)} style={{ borderBottom:"1px solid var(--border-soft)", cursor:"pointer" }}>
      <td style={{ padding:"10px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>
            {blob.blob_name || shortAddr(blob.blob_id)}
          </span>
          {blob.blob_name && <CopyBtn value={blob.blob_id}/>}
        </div>
        {blob.blob_name && (
          <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-dim)", marginTop:2 }}>
            {shortAddr(blob.blob_id)}
          </div>
        )}
      </td>
      <td style={{ padding:"10px 10px" }}>
        <span style={{ fontSize:12, color:"var(--text-secondary)" }}>{fmtBytes(blob.size)}</span>
      </td>
      <td style={{ padding:"10px 10px" }}>
        {blob.media_type ? <Pill label={blob.media_type}/> : <span style={{ color:"var(--text-dim)", fontSize:11 }}>—</span>}
      </td>
      <td style={{ padding:"10px 10px" }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>
          {blob.epoch != null ? `Epoch ${blob.epoch}` : "—"}
        </span>
      </td>
      <td style={{ padding:"10px 10px" }}>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {blob.certified && <Pill label="Certified" color="#22c55e"/>}
          {blob.deletable  && <Pill label="Deletable" color="#f59e0b"/>}
        </div>
      </td>
      <td style={{ padding:"10px 14px" }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-dim)" }}>{fmtTime(blob.created_at)}</span>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tx row
// ─────────────────────────────────────────────────────────────────

function TxRow({ tx, onSelect }: { tx: TxResult; onSelect:(t:TxResult)=>void }) {
  const fn = tx.function?.split("::")?.slice(-2).join("::") ?? "";
  return (
    <tr onClick={() => onSelect(tx)} style={{ borderBottom:"1px solid var(--border-soft)", cursor:"pointer" }}>
      <td style={{ padding:"10px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>
            {shortAddr(tx.hash)}
          </span>
          <CopyBtn value={tx.hash}/>
        </div>
        <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-dim)", marginTop:2 }}>v{tx.version}</div>
      </td>
      <td style={{ padding:"10px 10px" }}>
        <Pill label={tx.success ? "Success" : "Failed"} color={tx.success ? "#22c55e" : "#ef4444"}/>
      </td>
      <td style={{ padding:"10px 10px" }}>
        {fn ? <Pill label={fn}/> : <span style={{ color:"var(--text-dim)", fontSize:11 }}>{tx.type}</span>}
      </td>
      <td style={{ padding:"10px 10px" }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>
          {tx.gas_used != null ? Number(tx.gas_used).toLocaleString() : "—"}
        </span>
      </td>
      <td style={{ padding:"10px 14px" }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-dim)" }}>{fmtTime(tx.timestamp)}</span>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────
// Event row
// ─────────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: EventResult }) {
  const typeName = ev.type?.split("::")?.slice(-1)[0] ?? ev.type;
  return (
    <tr style={{ borderBottom:"1px solid var(--border-soft)" }}>
      <td style={{ padding:"10px 14px" }}>
        <div style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-primary)", fontWeight:600 }}>{typeName}</div>
        <div style={{ fontFamily:"monospace", fontSize:9, color:"var(--text-dim)", marginTop:2 }}>{ev.type}</div>
      </td>
      <td style={{ padding:"10px 10px" }}>
        <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>v{ev.transaction_version}</span>
      </td>
      <td style={{ padding:"10px 10px" }}>
        <span style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-dim)" }}>#{ev.sequence_number}</span>
      </td>
      <td style={{ padding:"10px 14px", maxWidth:340 }}>
        <pre style={{ fontFamily:"monospace", fontSize:9, color:"var(--text-muted)", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {JSON.stringify(ev.data)}
        </pre>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────
// Blob detail modal
// ─────────────────────────────────────────────────────────────────

function BlobModal({ blob, onClose }: { blob: BlobResult; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const rows: [string, React.ReactNode][] = [
    ["Blob ID",    <span style={{ fontFamily:"monospace", fontSize:12, wordBreak:"break-all" }}>{blob.blob_id}<CopyBtn value={blob.blob_id}/></span>],
    ["Name",       blob.blob_name || "—"],
    ["Owner",      blob.owner ? <span style={{ fontFamily:"monospace", fontSize:12 }}>{blob.owner}<CopyBtn value={blob.owner}/></span> : "—"],
    ["Size",       fmtBytes(blob.size)],
    ["Media Type", blob.media_type || "—"],
    ["Epoch",      blob.epoch != null ? `${blob.epoch}` : "—"],
    ["Certified",  blob.certified ? "Yes" : "No"],
    ["Deletable",  blob.deletable ? "Yes" : "No"],
    ["Created",    fmtTime(blob.created_at)],
  ];

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:24, maxWidth:560, width:"100%", maxHeight:"80vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
          <div>
            <h3 style={{ fontFamily:"var(--font-display)", fontSize:16, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Blob Detail</h3>
            {blob.blob_name && <div style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)", marginTop:2 }}>{blob.blob_name}</div>}
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:"var(--text-muted)", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <tbody>
            {rows.map(([label, val]) => (
              <tr key={label} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                <td style={{ padding:"9px 0", fontFamily:"monospace", fontSize:11, fontWeight:600, color:"var(--text-muted)", width:110, verticalAlign:"top" }}>{label}</td>
                <td style={{ padding:"9px 0 9px 12px", fontSize:13, color:"var(--text-primary)", verticalAlign:"top" }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tx detail modal
// ─────────────────────────────────────────────────────────────────

function TxModal({ tx, onClose }: { tx: TxResult; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const rows: [string, React.ReactNode][] = [
    ["Hash",     <span style={{ fontFamily:"monospace", fontSize:12, wordBreak:"break-all" }}>{tx.hash}<CopyBtn value={tx.hash}/></span>],
    ["Version",  tx.version],
    ["Status",   <Pill label={tx.success?"Success":"Failed"} color={tx.success?"#22c55e":"#ef4444"}/>],
    ["Type",     tx.type],
    ["Function", tx.function || "—"],
    ["Gas Used", tx.gas_used != null ? Number(tx.gas_used).toLocaleString() : "—"],
    ["Sender",   tx.sender ? <span style={{ fontFamily:"monospace", fontSize:12 }}>{tx.sender}<CopyBtn value={tx.sender}/></span> : "—"],
    ["Time",     fmtTime(tx.timestamp)],
  ];

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.72)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, padding:24, maxWidth:560, width:"100%", maxHeight:"80vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
          <h3 style={{ fontFamily:"var(--font-display)", fontSize:16, fontWeight:700, color:"var(--text-primary)", margin:0 }}>Transaction Detail</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:"var(--text-muted)", lineHeight:1, padding:"0 4px" }}>×</button>
        </div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <tbody>
            {rows.map(([label, val]) => (
              <tr key={label} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                <td style={{ padding:"9px 0", fontFamily:"monospace", fontSize:11, fontWeight:600, color:"var(--text-muted)", width:110, verticalAlign:"top" }}>{label}</td>
                <td style={{ padding:"9px 0 9px 12px", fontSize:13, color:"var(--text-primary)", verticalAlign:"top" }}>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Address view — blobs + transactions + events tabs
// ─────────────────────────────────────────────────────────────────

function AddressView({ address, network }: { address: string; network: string }) {
  const [tab,        setTab]        = useState<AddressTab>("blobs");
  const [blobs,      setBlobs]      = useState<BlobResult[]>([]);
  const [txs,        setTxs]        = useState<TxResult[]>([]);
  const [events,     setEvents]     = useState<EventResult[]>([]);
  const [blobCount,  setBlobCount]  = useState<number | null>(null);
  const [blobPage,   setBlobPage]   = useState(0);
  const [txPage,     setTxPage]     = useState(0);
  const [evPage,     setEvPage]     = useState(0);
  const [loadingB,   setLoadingB]   = useState(false);
  const [loadingT,   setLoadingT]   = useState(false);
  const [loadingE,   setLoadingE]   = useState(false);
  const [errorB,     setErrorB]     = useState<string | null>(null);
  const [errorT,     setErrorT]     = useState<string | null>(null);
  const [errorE,     setErrorE]     = useState<string | null>(null);
  const [selBlob,    setSelBlob]    = useState<BlobResult | null>(null);
  const [selTx,      setSelTx]      = useState<TxResult | null>(null);
  const PAGE = 20;

  const norm = normalizeAddress(address);

  const loadBlobs = useCallback(async (page: number) => {
    setLoadingB(true); setErrorB(null);
    try {
      const data = await gqlFetch<{ blobs: BlobResult[]; blobs_aggregate: { aggregate: { count: number } } }>(
        DEDICATED_INDEXER, BLOBS_BY_OWNER_QUERY,
        { owner: norm, limit: PAGE, offset: page * PAGE }
      );
      setBlobs(data.blobs);
      setBlobCount(data.blobs_aggregate.aggregate.count);
    } catch (e: any) { setErrorB(e.message ?? "Failed to load blobs"); }
    finally { setLoadingB(false); }
  }, [norm]);

  const loadTxs = useCallback(async (page: number) => {
    setLoadingT(true); setErrorT(null);
    try {
      const res = await fetch(
        `/api/network/transactions?address=${encodeURIComponent(norm)}&network=${network}&limit=${TX_BY_SENDER_LIMIT}&offset=${page * TX_BY_SENDER_LIMIT}`,
        { signal: AbortSignal.timeout(20_000) }
      );
      const d = await res.json() as any;
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
      const raw: any[] = d?.data?.transactions ?? d?.transactions ?? [];
      setTxs(raw.map(t => ({
        version:   String(t.version ?? t.sequence_number ?? ""),
        hash:      String(t.hash ?? ""),
        sender:    String(t.sender ?? norm),
        type:      String(t.type ?? "user_transaction"),
        success:   Boolean(t.success),
        gas_used:  t.gas_used != null ? String(t.gas_used) : undefined,
        timestamp: t.timestamp != null ? String(t.timestamp) : undefined,
        function:  t.payload?.function ?? t.function ?? "",
      })));
    } catch (e: any) { setErrorT(e.message ?? "Failed to load transactions"); }
    finally { setLoadingT(false); }
  }, [norm, network]);

  const loadEvents = useCallback(async (page: number) => {
    setLoadingE(true); setErrorE(null);
    try {
      // Try shelbynet indexer for events
      const endpoint = network === "testnet"
        ? "https://api.testnet.aptoslabs.com/v1/graphql"
        : "https://api.shelbynet.shelby.xyz/v1/graphql";
      const data = await gqlFetch<{ events: EventResult[] }>(
        endpoint, EVENTS_BY_ACCOUNT_QUERY,
        { addr: norm, limit: PAGE, offset: page * PAGE }
      );
      setEvents(data.events);
    } catch (e: any) { setErrorE(e.message ?? "Failed to load events"); }
    finally { setLoadingE(false); }
  }, [norm, network]);

  // Load on mount
  useEffect(() => { loadBlobs(0); }, [loadBlobs]);
  useEffect(() => { if (tab === "transactions") loadTxs(txPage); }, [tab, txPage, loadTxs]);
  useEffect(() => { if (tab === "events")       loadEvents(evPage); }, [tab, evPage, loadEvents]);

  const TABS: Array<{ key: AddressTab; label: string }> = [
    { key:"blobs",        label:`Blobs${blobCount != null ? ` (${blobCount})` : ""}` },
    { key:"transactions", label:"Transactions" },
    { key:"events",       label:"Events" },
  ];

  return (
    <div>
      {selBlob && <BlobModal blob={selBlob} onClose={() => setSelBlob(null)}/>}
      {selTx   && <TxModal  tx={selTx}     onClose={() => setSelTx(null)}/>}

      {/* Address header */}
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 20px", marginBottom:16, display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Wallet Address</div>
          <div style={{ fontFamily:"monospace", fontSize:13, color:"var(--text-primary)", wordBreak:"break-all", display:"flex", alignItems:"center", gap:6 }}>
            {norm}
            <CopyBtn value={norm}/>
          </div>
        </div>
        {blobCount != null && (
          <div style={{ textAlign:"right" }}>
            <div style={{ fontFamily:"monospace", fontSize:22, fontWeight:800, color:"#ff77c9" }}>{blobCount}</div>
            <div style={{ fontSize:11, color:"var(--text-muted)" }}>blobs stored</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:1, background:"var(--bg-card2)", borderRadius:9, padding:3, border:"1px solid var(--border)", marginBottom:16, width:"fit-content" }}>
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} style={{ padding:"6px 16px", borderRadius:7, border:"none", fontSize:12, fontWeight:tab===key?600:400, background:tab===key?"var(--bg-card)":"transparent", color:tab===key?"var(--text-primary)":"var(--text-muted)", boxShadow:tab===key?"0 1px 3px var(--shadow-color)":"none", cursor:"pointer" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Blobs tab ── */}
      {tab === "blobs" && (
        <div>
          {errorB && <ErrorBar msg={errorB} onRetry={() => loadBlobs(blobPage)}/>}
          <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
                  {["NAME / ID","SIZE","TYPE","EPOCH","FLAGS","CREATED"].map(h => (
                    <th key={h} style={{ padding:"9px 10px 9px 14px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingB && blobs.length === 0
                  ? Array.from({length:5}).map((_,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                        {[160,60,80,60,80,100].map((w,j) => (
                          <td key={j} style={{ padding:"11px 10px 11px 14px" }}><Skeleton w={w}/></td>
                        ))}
                      </tr>
                    ))
                  : blobs.length === 0
                  ? <tr><td colSpan={6} style={{ padding:"44px", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>No blobs found for this address</td></tr>
                  : blobs.map(b => <BlobRow key={b.blob_id} blob={b} onSelect={setSelBlob}/>)
                }
              </tbody>
            </table>
          </div>
          {blobCount != null && blobCount > PAGE && (
            <Pagination page={blobPage} total={blobCount} perPage={PAGE} onChange={p => { setBlobPage(p); loadBlobs(p); }} loading={loadingB}/>
          )}
        </div>
      )}

      {/* ── Transactions tab ── */}
      {tab === "transactions" && (
        <div>
          {errorT && <ErrorBar msg={errorT} onRetry={() => loadTxs(txPage)}/>}
          <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
                  {["HASH / VERSION","STATUS","FUNCTION","GAS USED","TIME"].map(h => (
                    <th key={h} style={{ padding:"9px 10px 9px 14px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingT && txs.length === 0
                  ? Array.from({length:5}).map((_,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                        {[160,70,120,70,100].map((w,j) => (
                          <td key={j} style={{ padding:"11px 10px 11px 14px" }}><Skeleton w={w}/></td>
                        ))}
                      </tr>
                    ))
                  : txs.length === 0
                  ? <tr><td colSpan={5} style={{ padding:"44px", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>No transactions found for this address</td></tr>
                  : txs.map(t => <TxRow key={t.hash||t.version} tx={t} onSelect={setSelTx}/>)
                }
              </tbody>
            </table>
          </div>
          {txs.length === TX_BY_SENDER_LIMIT && (
            <Pagination page={txPage} total={(txPage+2)*TX_BY_SENDER_LIMIT} perPage={TX_BY_SENDER_LIMIT} onChange={p => { setTxPage(p); loadTxs(p); }} loading={loadingT}/>
          )}
        </div>
      )}

      {/* ── Events tab ── */}
      {tab === "events" && (
        <div>
          {errorE && <ErrorBar msg={errorE} onRetry={() => loadEvents(evPage)}/>}
          <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
                  {["EVENT TYPE","TX VERSION","SEQ #","DATA"].map(h => (
                    <th key={h} style={{ padding:"9px 10px 9px 14px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingE && events.length === 0
                  ? Array.from({length:5}).map((_,i) => (
                      <tr key={i} style={{ borderBottom:"1px solid var(--border-soft)" }}>
                        {[140,80,60,200].map((w,j) => (
                          <td key={j} style={{ padding:"11px 10px 11px 14px" }}><Skeleton w={w}/></td>
                        ))}
                      </tr>
                    ))
                  : events.length === 0
                  ? <tr><td colSpan={4} style={{ padding:"44px", textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>No events found for this address</td></tr>
                  : events.map((ev, i) => <EventRow key={`${ev.transaction_version}-${ev.sequence_number}-${i}`} ev={ev}/>)
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Blob by ID view
// ─────────────────────────────────────────────────────────────────

function BlobIdView({ blobId }: { blobId: string }) {
  const [blob,    setBlob]    = useState<BlobResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [selBlob, setSelBlob] = useState<BlobResult | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const data = await gqlFetch<{ blobs: BlobResult[] }>(
          DEDICATED_INDEXER, BLOB_BY_ID_QUERY, { blob_id: blobId }
        );
        setBlob(data.blobs[0] ?? null);
      } catch (e: any) { setError(e.message ?? "Failed to load blob"); }
      finally { setLoading(false); }
    })();
  }, [blobId]);

  if (loading) return <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)" }}>Loading blob…</div>;
  if (error)   return <ErrorBar msg={error} onRetry={() => {}}/>;
  if (!blob)   return <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>Blob not found</div>;

  return (
    <div>
      {selBlob && <BlobModal blob={selBlob} onClose={() => setSelBlob(null)}/>}
      <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["NAME / ID","SIZE","TYPE","EPOCH","FLAGS","CREATED"].map(h => (
                <th key={h} style={{ padding:"9px 14px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <BlobRow blob={blob} onSelect={setSelBlob}/>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Tx by hash view (via VPS proxy)
// ─────────────────────────────────────────────────────────────────

function TxHashView({ hash, network }: { hash: string; network: string }) {
  const [tx,      setTx]      = useState<TxResult | null>(null);
  const [selTx,   setSelTx]   = useState<TxResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/network/transaction?hash=${encodeURIComponent(hash)}&network=${network}`, { signal: AbortSignal.timeout(20_000) });
        const d = await res.json() as any;
        if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
        const t = d?.data ?? d;
        setTx({
          version:   String(t.version ?? ""),
          hash:      String(t.hash ?? hash),
          sender:    String(t.sender ?? ""),
          type:      String(t.type ?? "user_transaction"),
          success:   Boolean(t.success),
          gas_used:  t.gas_used != null ? String(t.gas_used) : undefined,
          timestamp: t.timestamp != null ? String(t.timestamp) : undefined,
          function:  t.payload?.function ?? t.function ?? "",
        });
      } catch (e: any) { setError(e.message ?? "Failed to load transaction"); }
      finally { setLoading(false); }
    })();
  }, [hash, network]);

  if (loading) return <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)" }}>Loading transaction…</div>;
  if (error)   return <ErrorBar msg={error} onRetry={() => {}}/>;
  if (!tx)     return <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)", fontSize:13 }}>Transaction not found</div>;

  return (
    <div>
      {selTx && <TxModal tx={selTx} onClose={() => setSelTx(null)}/>}
      <div style={{ borderRadius:10, border:"1px solid var(--border)", overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
              {["HASH / VERSION","STATUS","FUNCTION","GAS USED","TIME"].map(h => (
                <th key={h} style={{ padding:"9px 14px", textAlign:"left", fontSize:10, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TxRow tx={tx} onSelect={setSelTx}/>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

function ErrorBar({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ marginBottom:12, padding:"9px 14px", borderRadius:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.3)", fontSize:12, color:"#ef4444", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span>⚠ {msg}</span>
      <button onClick={onRetry} style={{ background:"none", border:"none", color:"#ef4444", cursor:"pointer", fontSize:11, textDecoration:"underline", padding:0 }}>Retry</button>
    </div>
  );
}

function Pagination({ page, total, perPage, onChange, loading }: { page:number; total:number; perPage:number; onChange:(p:number)=>void; loading:boolean }) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 4px 4px", gap:8 }}>
      <button onClick={() => onChange(Math.max(0, page-1))} disabled={page===0||loading} style={{ padding:"5px 12px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:12, color:"var(--text-muted)", cursor:"pointer", opacity:(page===0||loading)?0.4:1 }}>← Prev</button>
      <span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>Page {page+1} of {pages}</span>
      <button onClick={() => onChange(Math.min(pages-1, page+1))} disabled={page>=pages-1||loading} style={{ padding:"5px 12px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:12, color:"var(--text-muted)", cursor:"pointer", opacity:(page>=pages-1||loading)?0.4:1 }}>Next →</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Recent blobs sidebar (landing state)
// ─────────────────────────────────────────────────────────────────

function RecentBlobs({ onSelect }: { onSelect: (id: string) => void }) {
  const [blobs,   setBlobs]   = useState<BlobResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await gqlFetch<{ blobs: BlobResult[] }>(
          DEDICATED_INDEXER,
          `query RecentBlobs { blobs(limit: 12, order_by: { epoch: desc }) { blob_id blob_name owner size media_type epoch certified } }`,
          {}
        );
        setBlobs(data.blobs);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div style={{ marginTop:24 }}>
      <div style={{ fontSize:12, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:10 }}>Recent Blobs</div>
      {loading
        ? Array.from({length:6}).map((_,i) => <div key={i} style={{ marginBottom:6 }}><Skeleton w={i%3===0?180:i%3===1?130:160} h={12}/></div>)
        : blobs.map(b => (
            <button key={b.blob_id} onClick={() => onSelect(b.blob_id)} style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", cursor:"pointer", padding:"6px 0", borderBottom:"1px solid var(--border-soft)" }}>
              <div style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>
                {b.blob_name || shortAddr(b.blob_id)}
              </div>
              <div style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-dim)", marginTop:1, display:"flex", gap:8 }}>
                <span>{fmtBytes(b.size)}</span>
                {b.epoch != null && <span>Epoch {b.epoch}</span>}
                {b.media_type && <span>{b.media_type}</span>}
              </div>
            </button>
          ))
      }
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────

export default function ExplorerPage() {
  const { network } = useNetwork();
  const { isDark }  = useTheme();
  const [input,     setInput]     = useState("");
  const [submitted, setSubmitted] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("address");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(() => {
    const s = input.trim();
    if (!s) return;
    const t = detectType(s);
    setSearchType(t);
    setSubmitted(s);
  }, [input]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleRecent = (id: string) => {
    setInput(id);
    setSearchType("blob");
    setSubmitted(id);
  };

  const clear = () => { setInput(""); setSubmitted(""); inputRef.current?.focus(); };

  const placeholder = "Search by wallet address, blob ID, or transaction hash…";

  const renderResult = () => {
    if (!submitted) return null;
    const s = submitted.trim();
    if (searchType === "address") return <AddressView address={s} network={network}/>;
    if (searchType === "tx")      return <TxHashView  hash={s}    network={network}/>;
    return <BlobIdView blobId={s}/>;
  };

  return (
    <div style={{ minHeight:"calc(100vh - 60px)", background:"var(--bg-primary)" }}>
      <div style={{ maxWidth:1100, margin:"0 auto", padding:"28px 20px 60px" }}>

        {/* Header */}
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontFamily:"var(--font-display)", fontSize:26, fontWeight:800, color:"var(--text-primary)", margin:0, letterSpacing:-0.5 }}>
            Shelby Explorer
          </h1>
          <p style={{ fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)", margin:"5px 0 0" }}>
            Search blobs, wallets, and transactions on the Shelby Protocol
          </p>
        </div>

        {/* Search bar */}
        <div style={{ display:"flex", gap:8, marginBottom:24, position:"relative" }}>
          <div style={{ flex:1, position:"relative" }}>
            <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", fontSize:15, color:"var(--text-dim)", pointerEvents:"none" }}>🔍</span>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder}
              style={{ width:"100%", boxSizing:"border-box", padding:"12px 44px 12px 42px", borderRadius:11, border:"1.5px solid var(--border)", background:"var(--bg-card)", color:"var(--text-primary)", fontSize:14, fontFamily:"monospace", outline:"none", transition:"border-color 0.15s" }}
              onFocus={e => (e.target.style.borderColor="#ff77c9")}
              onBlur={e  => (e.target.style.borderColor="var(--border)")}
            />
            {input && (
              <button onClick={clear} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:16, color:"var(--text-dim)", lineHeight:1, padding:"0 2px" }}>×</button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={!input.trim()}
            style={{ padding:"12px 24px", borderRadius:11, border:"none", background:"#ff77c9", color:"#fff", fontSize:14, fontWeight:700, cursor:input.trim()?"pointer":"not-allowed", opacity:input.trim()?1:0.5, whiteSpace:"nowrap", transition:"all 0.15s", boxShadow:"0 2px 12px rgba(255,119,201,0.4)" }}>
            Search
          </button>
        </div>

        {/* Auto-detect hint */}
        {input.trim() && !submitted && (
          <div style={{ marginBottom:14, fontFamily:"monospace", fontSize:11, color:"var(--text-dim)" }}>
            Detected: <span style={{ color:"#ff77c9", fontWeight:600 }}>{
              (() => {
                const t = detectType(input.trim());
                return t === "address" ? "Wallet Address" : t === "tx" ? "Transaction Hash" : "Blob ID";
              })()
            }</span>
            {" — "}press Enter or Search
          </div>
        )}

        {/* Quick search suggestions */}
        {!submitted && (
          <div style={{ display:"flex", gap:7, flexWrap:"wrap", marginBottom:28 }}>
            {[
              { label:"Core contract",  value:"0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a" },
              { label:"Example wallet", value:"0xbd5ae0a90f3bba86048c90f0f380d3268ebf4acc46924b586f8a9e2b03627efa" },
            ].map(s => (
              <button key={s.label} onClick={() => { setInput(s.value); setSearchType("address"); setSubmitted(s.value); }} style={{ padding:"5px 12px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:11, color:"var(--text-muted)", cursor:"pointer", fontFamily:"monospace", whiteSpace:"nowrap" }}>
                {s.label} →
              </button>
            ))}
          </div>
        )}

        {/* Main content */}
        <div style={{ display:"grid", gridTemplateColumns:submitted ? "1fr" : "1fr 280px", gap:24, alignItems:"start" }}>
          <div>
            {submitted ? renderResult() : (
              <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:12, padding:"28px 24px", textAlign:"center" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>🔎</div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:16, fontWeight:700, color:"var(--text-primary)", marginBottom:6 }}>Search the Shelby Network</div>
                <div style={{ fontSize:13, color:"var(--text-muted)", lineHeight:1.6 }}>
                  Enter a <strong>wallet address</strong> to view its blobs, transactions, and events.<br/>
                  Enter a <strong>blob ID</strong> to inspect a specific blob.<br/>
                  Enter a <strong>transaction hash</strong> to view a transaction.
                </div>
              </div>
            )}
          </div>
          {!submitted && (
            <div>
              <RecentBlobs onSelect={handleRecent}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}