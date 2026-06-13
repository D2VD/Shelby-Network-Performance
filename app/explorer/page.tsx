"use client";
/**
 * app/explorer/page.tsx — v3.1
 *
 * Fixes vs v3.0:
 *  1. Pagination: page-number + seqNum math (was broken version-as-cursor)
 *  2. Sort newest-first: start=max(0, seqNum-(page+1)*PAGE), then .reverse()
 *  3. Font sizes increased throughout (body 14px, labels 12px)
 *  4. External links: hash → Aptos explorer, sender → Aptos account page
 *  5. Blob name search: accept "@0x…/path" → extract address; plain filename → helpful message
 *  6. SP Directory tab removed
 *  7. "All transactions loaded" message when reaching oldest page
 *  8. AbortController timeout with clearer loading UX
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface NormTx {
  version: string; hash: string; type: string; fullFn: string;
  sender: string; success: boolean; gasFeeApt: string;
  timestamp: string; isShelby: boolean;
}

interface BlobEvent {
  blobName: string; sizeBytes: number; sizeKB: string;
  encoding: string; chunksetCount: string;
  blobCommitment: string; expiryDate: string;
}

type Tab = "transactions";

const PAGE = 25;

// ─── Aptos explorer URLs ───────────────────────────────────────────────────────

function aptosExplorerTxn(hash: string, network: string): string {
  const net = network === "testnet" ? "testnet" : "mainnet";
  return `https://explorer.aptoslabs.com/txn/${hash}?network=${net}`;
}
function aptosExplorerAccount(addr: string, network: string): string {
  const net = network === "testnet" ? "testnet" : "mainnet";
  return `https://explorer.aptoslabs.com/account/${addr}?network=${net}`;
}

// ─── Small utilities ───────────────────────────────────────────────────────────

function short(s: string, head = 8, tail = 6): string {
  if (!s || s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
function fmtTime(microsStr: string): string {
  const ms = parseInt(microsStr ?? "0");
  if (!ms) return "—";
  return new Date(ms / 1000).toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => navigator.clipboard.writeText(value)
      .then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      style={{ background:"none", border:"none", cursor:"pointer", fontSize:13,
               color: done ? "#22c55e" : "var(--text-dim)", padding:"0 3px" }}
      title="Copy">{done ? "✓" : "⎘"}</button>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color:"#ff77c9", textDecoration:"none", display:"inline-flex",
               alignItems:"center", gap:3 }}
      title="Open in Aptos Explorer">
      {children}
      <span style={{ fontSize:10, opacity:0.7 }}>↗</span>
    </a>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span style={{ fontSize:11, fontFamily:"var(--font-mono,'Roboto Mono',monospace)",
                   fontWeight:700, padding:"3px 9px", borderRadius:5,
                   background: ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                   color: ok ? "#22c55e" : "#ef4444" }}>
      {ok ? "✓ Success" : "✗ Failed"}
    </span>
  );
}

function EmptyState({ icon, title, sub }: { icon:string; title:string; sub?:string }) {
  return (
    <div style={{ padding:"56px 24px", textAlign:"center" }}>
      <div style={{ fontSize:40, marginBottom:14 }}>{icon}</div>
      <div style={{ fontSize:17, fontWeight:700, color:"var(--text-primary)", marginBottom:8 }}>{title}</div>
      {sub && <div style={{ fontSize:14, color:"var(--text-muted)", maxWidth:420, margin:"0 auto",
                             lineHeight:1.6 }}>{sub}</div>}
    </div>
  );
}

function Spinner({ label="Loading…" }: { label?: string }) {
  return (
    <div style={{ padding:"56px 24px", textAlign:"center" }}>
      <div style={{ width:32, height:32, border:"2px solid var(--border)",
                    borderTopColor:"#ff77c9", borderRadius:"50%",
                    animation:"spin 0.8s linear infinite", margin:"0 auto 14px" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize:14, color:"var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// ─── Flow 1: Account transactions (newest-first, page-based pagination) ────────

function AccountPanel({ address, network, onVersionClick }: {
  address: string; network: string; onVersionClick: (v: string) => void;
}) {
  const [seqNum,  setSeqNum]  = useState<number>(0);
  const [txs,     setTxs]     = useState<NormTx[]>([]);
  const [page,    setPage]    = useState(0);   // 0 = most recent
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [allLoaded, setAllLoaded] = useState(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const mono: React.CSSProperties = { fontFamily:"var(--font-mono,'Roboto Mono',monospace)" };

  /** Load a page. pg=0 → newest PAGE txs; pg=1 → next older PAGE; etc. */
  const loadPage = useCallback(async (pg: number, totalSeq: number) => {
    if (!alive.current) return;
    setLoading(true); setError(null);

    // start = sequence number to begin fetching from
    // For newest-first: start at the last full-page boundary
    const startSeq = Math.max(0, totalSeq - (pg + 1) * PAGE);
    // Calculate actual limit (might be < PAGE on the oldest page)
    const pageLimit = Math.min(PAGE, totalSeq - pg * PAGE);

    try {
      const params = new URLSearchParams({
        address, network,
        limit:  String(pageLimit > 0 ? pageLimit : PAGE),
        cursor: String(startSeq),
      });
      const res   = await fetch(`/api/node/transactions?${params}`,
                                { signal: AbortSignal.timeout(20_000) });
      const j     = await res.json() as { ok:boolean; txs?:NormTx[]; error?:string; note?:string };
      if (!alive.current) return;
      if (!j.ok) throw new Error(j.error ?? "Failed to load transactions");

      const rows = (j.txs ?? []).slice().reverse(); // reverse → newest first in display
      setTxs(rows);
      setPage(pg);
      // Reached oldest when startSeq === 0 or no rows returned
      setAllLoaded(startSeq === 0 || rows.length === 0);
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [address, network]);

  /** Initial load: fetch account info → get seqNum → load page 0 */
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSeqNum(0); setTxs([]); setPage(0); setError(null); setAllLoaded(false);

    (async () => {
      try {
        const accRes  = await fetch(`/api/node/account?address=${address}&network=${network}`,
                                    { signal: AbortSignal.timeout(20_000) });
        const accJson = await accRes.json() as { ok:boolean; sequenceNumber?:string; error?:string; activated?:boolean };
        if (cancelled) return;

        if (!accJson.ok) {
          setError(accJson.error ?? "Account not found");
          setLoading(false);
          return;
        }

        const total = parseInt(accJson.sequenceNumber ?? "0");
        setSeqNum(total);

        if (total === 0) {
          setTxs([]); setAllLoaded(true); setLoading(false);
          return;
        }

        await loadPage(0, total);
      } catch (e: unknown) {
        if (!cancelled) {
          setError((e as Error).message.includes("abort")
            ? "Request timed out — the node may be slow, please retry."
            : (e as Error).message);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [address, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = seqNum > 0 ? Math.ceil(seqNum / PAGE) : 1;
  const hasPrev    = page > 0;                    // there is a newer page
  const hasNext    = page < totalPages - 1;       // there is an older page

  if (error) return <EmptyState icon="⚠️" title="Lookup failed" sub={error}/>;
  if (loading) return <Spinner label="Fetching transactions from the Shelby node…"/>;

  return (
    <div>
      {/* Account info bar */}
      <div style={{ display:"flex", alignItems:"center", gap:28, padding:"12px 20px",
                    background:"var(--bg-card)", borderBottom:"1px solid var(--border)",
                    flexWrap:"wrap" }}>
        <div>
          <div style={{ ...mono, fontSize:11, color:"var(--text-muted)", marginBottom:3, textTransform:"uppercase", letterSpacing:"0.08em" }}>ADDRESS</div>
          <div style={{ ...mono, fontSize:13, display:"flex", alignItems:"center", gap:4 }}>
            <ExternalLink href={aptosExplorerAccount(address, network)}>{short(address, 12, 10)}</ExternalLink>
            <CopyBtn value={address}/>
          </div>
        </div>
        <div>
          <div style={{ ...mono, fontSize:11, color:"var(--text-muted)", marginBottom:3, textTransform:"uppercase", letterSpacing:"0.08em" }}>TOTAL TXS</div>
          <div style={{ ...mono, fontSize:18, fontWeight:800, color:"#ff77c9" }}>
            {seqNum.toLocaleString("en-US")}
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 }}>
          <button
            onClick={() => loadPage(page, seqNum)}
            disabled={loading}
            title="Refresh current page"
            style={{ ...mono, fontSize:12, padding:"5px 12px", borderRadius:6,
                     border:"1px solid var(--border)", background:"var(--bg-card)",
                     color:"#ff77c9", cursor: loading ? "not-allowed" : "pointer",
                     opacity: loading ? 0.5 : 1, display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ display:"inline-block", animation: loading ? "spin 0.8s linear infinite" : "none" }}>⟳</span>
            Refresh
          </button>
          <span style={{ ...mono, fontSize:11, color:"var(--text-dim)" }}>
            Page {page + 1} of {totalPages} · click version to inspect blob data
          </span>
        </div>
      </div>

      {/* Tx table */}
      {txs.length === 0 ? (
        <EmptyState icon="📭" title="No transactions found"
          sub="This address has not submitted any transactions on this network."/>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:"var(--bg-card2)" }}>
                {["VERSION","TYPE","GAS (APT)","STATUS","TIME"].map(h => (
                  <th key={h} style={{ ...mono, fontSize:11, fontWeight:700, textTransform:"uppercase",
                                       letterSpacing:"0.08em", color:"var(--text-muted)",
                                       padding:"10px 14px", textAlign:"left",
                                       borderBottom:"1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txs.map((tx, i) => (
                <tr key={tx.version + i}
                    style={{ borderBottom:"1px solid var(--border)",
                             background: i % 2 ? "var(--bg-card2)" : "transparent" }}>
                  {/* Version — clickable for tx detail */}
                  <td style={{ padding:"11px 14px" }}>
                    <button onClick={() => onVersionClick(tx.version)}
                      style={{ ...mono, background:"none", border:"none", cursor:"pointer",
                               color:"#ff77c9", fontSize:14, fontWeight:700, padding:0,
                               textDecoration:"underline dotted" }}>
                      v{tx.version}
                    </button>
                  </td>
                  {/* Type */}
                  <td style={{ padding:"11px 14px" }}>
                    <span style={{ ...mono, fontSize:13,
                                   color: tx.isShelby ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {tx.type || "System"}
                    </span>
                    {tx.isShelby && (
                      <span style={{ marginLeft:7, fontSize:10, background:"rgba(255,119,201,0.15)",
                                     color:"#ff77c9", borderRadius:4, padding:"2px 6px", ...mono }}>
                        SHELBY
                      </span>
                    )}
                  </td>
                  {/* Gas */}
                  <td style={{ ...mono, padding:"11px 14px", fontSize:13, color:"var(--text-primary)" }}>
                    {tx.gasFeeApt === "0.00000000" ? <span style={{ color:"var(--text-dim)" }}>—</span> : tx.gasFeeApt}
                  </td>
                  {/* Status */}
                  <td style={{ padding:"11px 14px" }}><Badge ok={tx.success}/></td>
                  {/* Time */}
                  <td style={{ ...mono, padding:"11px 14px", fontSize:12, color:"var(--text-muted)" }}>
                    {fmtTime(tx.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    padding:"12px 20px", borderTop:"1px solid var(--border)" }}>
        {/* Prev = go to newer page (lower page number) */}
        <button onClick={() => loadPage(page - 1, seqNum)} disabled={!hasPrev || loading}
          style={{ ...mono, fontSize:13, padding:"7px 18px", borderRadius:7,
                   border:"1px solid var(--border)", background:"var(--bg-card)",
                   color: hasPrev ? "var(--text-primary)" : "var(--text-muted)",
                   cursor: hasPrev ? "pointer" : "not-allowed",
                   opacity: hasPrev ? 1 : 0.35 }}>
          ← Newer
        </button>

        <span style={{ ...mono, fontSize:12, color:"var(--text-muted)" }}>
          {allLoaded && page === totalPages - 1
            ? "✓ All transactions loaded (oldest page)"
            : `${Math.min((page + 1) * PAGE, seqNum)} of ${seqNum.toLocaleString("en-US")} shown`}
        </span>

        {/* Next = go to older page (higher page number) */}
        <button onClick={() => loadPage(page + 1, seqNum)} disabled={!hasNext || loading}
          style={{ ...mono, fontSize:13, padding:"7px 18px", borderRadius:7,
                   border:"1px solid var(--border)", background:"var(--bg-card)",
                   color: hasNext ? "var(--text-primary)" : "var(--text-muted)",
                   cursor: hasNext ? "pointer" : "not-allowed",
                   opacity: hasNext ? 1 : 0.35 }}>
          Older →
        </button>
      </div>
    </div>
  );
}

// ─── Flow 2: Single transaction detail + blob events ─────────────────────────

function TxDetailPanel({ version, network, onClose }: {
  version: string; network: string; onClose: () => void;
}) {
  const [tx,     setTx]     = useState<NormTx | null>(null);
  const [blobs,  setBlobs]  = useState<BlobEvent[]>([]);
  const [note,   setNote]   = useState("");
  const [loading,setLoading]= useState(true);
  const [error,  setError]  = useState<string | null>(null);
  const [tick,   setTick]   = useState(0); // increment to force re-fetch

  const refresh = useCallback(() => setTick(t => t + 1), []);

  const mono: React.CSSProperties = { fontFamily:"var(--font-mono,'Roboto Mono',monospace)" };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setTx(null); setBlobs([]); setNote("");
    fetch(`/api/node/transactions?version=${version}&network=${network}`,
          { signal: AbortSignal.timeout(20_000) })
      .then(r => r.json())
      .then((j: { ok:boolean; tx?:NormTx; blobEvents?:BlobEvent[]; note?:string; error?:string }) => {
        if (cancelled) return;
        if (!j.ok) { setError(j.error ?? "Not found"); return; }
        setTx(j.tx ?? null);
        setBlobs(j.blobEvents ?? []);
        setNote(j.note ?? "");
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version, network, tick]); // tick causes re-fetch on refresh

  if (loading) return (
    <div style={{ borderBottom:"2px solid rgba(255,119,201,0.3)" }}>
      <TxDetailHeader version={version} onClose={onClose} onRefresh={refresh} refreshing={true}/>
      <Spinner label={`Loading v${version}…`}/>
    </div>
  );
  if (error) return (
    <div style={{ borderBottom:"2px solid rgba(255,119,201,0.3)" }}>
      <TxDetailHeader version={version} onClose={onClose} onRefresh={refresh} refreshing={false}/>
      <EmptyState icon="⚠️" title="Transaction not found" sub={error}/>
    </div>
  );
  if (!tx) return null;

  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display:"flex", gap:16, padding:"10px 0",
                               borderBottom:"1px solid var(--border)" }}>
      <div style={{ ...mono, fontSize:11, fontWeight:700, textTransform:"uppercase",
                     letterSpacing:"0.08em", color:"var(--text-muted)", width:150, flexShrink:0 }}>{label}</div>
      <div style={{ ...mono, fontSize:13, color:"var(--text-primary)", wordBreak:"break-all",
                     lineHeight:1.5 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ borderBottom:"2px solid rgba(255,119,201,0.3)" }}>
      <TxDetailHeader version={version} onClose={onClose} onRefresh={refresh} refreshing={false}/>
      <div style={{ padding:"16px 20px" }}>
        {/* TX summary */}
        <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)",
                      borderRadius:12, padding:"16px 20px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <span style={{ ...mono, fontWeight:800, fontSize:16, color:"#ff77c9" }}>v{tx.version}</span>
            <Badge ok={tx.success}/>
            {tx.isShelby && (
              <span style={{ fontSize:11, background:"rgba(255,119,201,0.15)", color:"#ff77c9",
                             borderRadius:5, padding:"3px 9px", ...mono }}>SHELBY PROTOCOL</span>
            )}
          </div>
          {row("Hash",
            <>{short(tx.hash, 14, 8)} <CopyBtn value={tx.hash}/>
              <ExternalLink href={aptosExplorerTxn(tx.hash, network)}>View on Explorer</ExternalLink></>)}
          {row("Sender",
            <>{short(tx.sender, 12, 8)} <CopyBtn value={tx.sender}/>
              <ExternalLink href={aptosExplorerAccount(tx.sender, network)}>View Account</ExternalLink></>)}
          {row("Function",  <span style={{ fontSize:12 }}>{tx.fullFn || "System transaction"}</span>)}
          {row("Gas fee",   `${tx.gasFeeApt} APT`)}
          {row("Timestamp", fmtTime(tx.timestamp))}
          {note && (
            <div style={{ marginTop:12, padding:"10px 14px", background:"rgba(251,191,36,0.08)",
                          border:"1px solid rgba(251,191,36,0.3)", borderRadius:7,
                          ...mono, fontSize:13, color:"#fbbf24" }}>ℹ {note}</div>
          )}
        </div>

        {/* Blob events */}
        {blobs.length > 0 ? (
          <div>
            <div style={{ ...mono, fontSize:12, fontWeight:700, textTransform:"uppercase",
                          letterSpacing:"0.1em", color:"var(--text-muted)", marginBottom:12 }}>
              🗂 Blob Metadata — {blobs.length} blob{blobs.length > 1 ? "s" : ""} registered
            </div>
            {blobs.map((b, i) => (
              <div key={i} style={{ background:"var(--bg-card)",
                                     border:"1px solid rgba(255,119,201,0.25)",
                                     borderRadius:12, padding:"16px 20px", marginBottom:14 }}>
                <div style={{ ...mono, fontWeight:700, fontSize:14, color:"#ff77c9",
                               marginBottom:12, wordBreak:"break-all" }}>
                  {b.blobName || `Blob #${i + 1}`}
                </div>
                {row("Size",       `${b.sizeKB} KB (${b.sizeBytes.toLocaleString("en-US")} bytes)`)}
                {row("Encoding",   b.encoding)}
                {row("Chunksets",  b.chunksetCount)}
                {row("Commitment", <>{short(b.blobCommitment, 14, 8)} <CopyBtn value={b.blobCommitment}/></>)}
                {row("Expires",    b.expiryDate)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding:"14px 18px", background:"var(--bg-card2)", borderRadius:10,
                        ...mono, fontSize:13, color:"var(--text-muted)", textAlign:"center" }}>
            No BlobRegisteredEvent — this is a regular Shelby transaction (not a blob upload).
          </div>
        )}
      </div>
    </div>
  );
}

function TxDetailHeader({ version, onClose, onRefresh, refreshing }: {
  version: string; onClose: () => void; onRefresh: () => void; refreshing: boolean;
}) {
  const mono: React.CSSProperties = { fontFamily:"var(--font-mono,'Roboto Mono',monospace)" };
  return (
    <div style={{ ...mono, padding:"11px 20px", fontSize:12, fontWeight:700,
                   background:"rgba(255,119,201,0.06)",
                   textTransform:"uppercase", letterSpacing:"0.1em",
                   color:"#ff77c9", borderBottom:"1px solid var(--border)",
                   display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <span>⬢ Transaction Detail · v{version}</span>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <button onClick={onRefresh} disabled={refreshing}
          title="Refresh transaction data"
          style={{ background:"none", border:"1px solid rgba(255,119,201,0.3)", borderRadius:5,
                   color:"#ff77c9", cursor: refreshing ? "not-allowed" : "pointer",
                   fontSize:12, padding:"3px 10px", ...mono,
                   opacity: refreshing ? 0.5 : 1, display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ display:"inline-block", animation: refreshing ? "spin 0.8s linear infinite" : "none" }}>⟳</span>
          Refresh
        </button>
        <button onClick={onClose}
          style={{ background:"none", border:"none", color:"var(--text-muted)",
                   cursor:"pointer", fontSize:16, lineHeight:1 }}>✕</button>
      </div>
    </div>
  );
}

// ─── Main Explorer page ───────────────────────────────────────────────────────

export default function ExplorerPage() {
  const { network } = useNetwork();

  const [query,     setQuery]     = useState("");
  const [inputErr,  setInputErr]  = useState("");
  const [searchAddr,setSearchAddr]= useState("");
  const [selectedV, setSelectedV] = useState("");
  const [tab,       setTab]       = useState<Tab>("transactions");

  const networkLabel = network === "shelbynet" ? "Shelbynet" : "Testnet";
  const mono: React.CSSProperties = { fontFamily:"var(--font-mono,'Roboto Mono',monospace)" };

  /** Parse input and trigger the correct flow */
  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setInputErr("");

    // Flow 1: wallet address
    if (q.startsWith("0x") && q.length >= 10) {
      setSearchAddr(q); setSelectedV(""); setTab("transactions");
      return;
    }

    // Flow 1 via blob name: "@0x{address}/path" → extract address
    if (q.startsWith("@0x")) {
      const m = q.match(/^@(0x[0-9a-fA-F]{10,})\//);
      if (m) { setSearchAddr(m[1]); setSelectedV(""); setTab("transactions"); return; }
    }

    // Flow 2: transaction version number
    if (/^\d+$/.test(q)) {
      setSelectedV(q); setSearchAddr(""); setTab("transactions"); return;
    }

    // Filename / blob name without address prefix
    if (q.includes(".") || q.includes("/")) {
      setInputErr(
        "To search by blob name, paste the full blob path starting with @0x… (e.g. @0xabc…/myfile.jpg). " +
        "Filename-only search requires a running indexer (currently unavailable)."
      );
      return;
    }

    setInputErr("Invalid input — enter a wallet address (0x…), a transaction version number, or a blob path (@0x…/filename).");
  };

  const clearSearch = () => {
    setQuery(""); setSearchAddr(""); setSelectedV(""); setInputErr("");
  };

  const onVersionClick = (v: string) => {
    setSelectedV(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg-primary)",
                  fontFamily:"var(--font-body,'Inter',system-ui,sans-serif)" }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ padding:"28px 24px 0", borderBottom:"1px solid var(--border)" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
                      flexWrap:"wrap", gap:12, marginBottom:22 }}>
          <div>
            <h1 style={{ margin:0, fontSize:30, fontWeight:800, letterSpacing:-0.5,
                         fontFamily:"var(--font-headline,'Britti Sans','DM Sans',sans-serif)",
                         color:"var(--text-primary)" }}>Explorer</h1>
            <p style={{ margin:"5px 0 0", fontSize:14, color:"var(--text-muted)" }}>
              {networkLabel} · Browse transactions and blob data
            </p>
          </div>
          <span style={{ ...mono, fontSize:12, padding:"5px 14px", borderRadius:20,
                         background:"rgba(255,119,201,0.1)", color:"#ff77c9",
                         border:"1px solid rgba(255,119,201,0.2)", alignSelf:"flex-start" }}>
            {networkLabel}
          </span>
        </div>

        {/* Search */}
        <div style={{ maxWidth:760, marginBottom:18 }}>
          <div style={{ display:"flex", gap:8 }}>
            <input value={query}
              onChange={e => { setQuery(e.target.value); setInputErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Wallet address (0x…)  ·  Transaction version (12345)  ·  Blob path (@0x…/file.jpg)"
              style={{ flex:1, padding:"13px 16px", borderRadius:9,
                       border:`1px solid ${inputErr ? "#ef4444" : "var(--border)"}`,
                       background:"var(--bg-card)", color:"var(--text-primary)",
                       fontSize:14, outline:"none", ...mono }}
            />
            <button onClick={handleSearch} style={{
              padding:"13px 26px", borderRadius:9, border:"none",
              background:"#ff77c9", color:"#fff", fontWeight:800, fontSize:14,
              cursor:"pointer", ...mono,
            }}>Search</button>
          </div>

          {inputErr && (
            <div style={{ ...mono, fontSize:12, color:"#ef4444", marginTop:7, lineHeight:1.5 }}>
              ⚠ {inputErr}
            </div>
          )}

          {(searchAddr || selectedV) && !inputErr && (
            <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:9 }}>
              <span style={{ ...mono, fontSize:12, color:"var(--text-muted)" }}>
                {searchAddr ? "Address:" : "Version:"}
              </span>
              <span style={{ ...mono, fontSize:12, color:"#ff77c9" }}>
                {searchAddr ? short(searchAddr, 14, 10) : `v${selectedV}`}
              </span>
              <button onClick={clearSearch}
                style={{ ...mono, fontSize:11, background:"none", border:"none",
                         color:"var(--text-dim)", cursor:"pointer" }}>× clear</button>
            </div>
          )}
        </div>

        {/* Tab bar (single tab for now — kept for future extension) */}
        <div style={{ display:"flex" }}>
          <button style={{
            padding:"11px 22px", border:"none", background:"transparent", cursor:"pointer",
            fontSize:14, fontWeight:700, color:"#ff77c9",
            borderBottom:"2px solid #ff77c9", ...mono,
          }}>⚡ Transactions</button>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ background:"var(--bg-card)", minHeight:420 }}>
        {/* Flow 2: tx detail panel (shown above the list when a version is selected) */}
        {selectedV && (
          <TxDetailPanel version={selectedV} network={network} onClose={() => setSelectedV("")}/>
        )}

        {/* Flow 1: account transaction list */}
        {searchAddr && (
          <AccountPanel address={searchAddr} network={network} onVersionClick={onVersionClick}/>
        )}

        {/* Default state */}
        {!searchAddr && !selectedV && (
          <EmptyState icon="🔍" title="Search to explore"
            sub="Enter a wallet address to see its full transaction history with blob metadata, or enter a transaction version number to inspect a specific transaction directly."/>
        )}
      </div>

      <div style={{ padding:"10px 20px", borderTop:"1px solid var(--border)",
                    ...mono, fontSize:11, color:"var(--text-dim)", textAlign:"right" }}>
        Source: Aptos Node REST API · proxied server-side
      </div>
    </div>
  );
}