"use client";
/**
 * app/explorer/page.tsx — v3.5
 *
 * Changes vs v3.4:
 * - Tích hợp hệ thống quản lý Tab linh hoạt (Transactions, Blobs Explorer, Activity, Export).
 * - Bổ sung useBlobSearch hook hỗ trợ tự động nhận diện routing cấu trúc Blob ID / Owner / Name.
 * - Tích hợp Live Network Activity qua SSE Stream component ActivityFeed.
 * - Thêm tính năng kết xuất dữ liệu nhanh qua ExportPanel.
 */

import React, {
  useState, useEffect, useCallback, useRef, useMemo, Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useNetwork } from "@/components/network-context";

// ─── Imports từ EXPLORER_PAGE_PATCH v3.5 ──────────────────────────────────────
import { ActivityFeed }  from "@/components/activity-feed";
import { ExportPanel }   from "@/components/export-panel";
import { LeaderboardTab } from "@/components/leaderboard-tab";
import {
  BlobSearchBar,
  BlobStatusFilter,
  BlobTable,
  BlobPagination,
} from "@/components/blob-explorer";
import { useBlobSearch } from "@/hooks/use-blob-search";
import { useTheme }      from "@/components/theme-context";

// ─── Env / constants ──────────────────────────────────────────────────────────

const PAGE = 25;

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormTx {
  version: string; hash: string; type: string; fullFn: string;
  sender: string; success: boolean; gasFeeApt: string; gasFeeRaw: number;
  timestamp: string; isShelby: boolean;
}
interface BlobEvent {
  blobName: string; sizeBytes: number; sizeKB: string;
  encoding: string; chunksetCount: string;
  blobCommitment: string; expiryDate: string;
}
type SortKey = "newest" | "gas_desc" | "gas_asc";

// ─── Aptos Explorer URLs ──────────────────────────────────────────────────────

function aptosExplorerTxn(hash: string, network: string): string {
  const net = network === "shelbynet" ? "shelbynet" : "testnet";
  return `https://explorer.aptoslabs.com/txn/${hash}?network=${net}`;
}

function aptosExplorerAccount(addr: string, network: string): string {
  const net = network === "shelbynet" ? "shelbynet" : "testnet";
  return `https://explorer.aptoslabs.com/account/${addr}?network=${net}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono,'Roboto Mono',monospace)",
};

function short(s: string, h = 8, t = 6): string {
  if (!s || s.length <= h + t + 3) return s;
  return `${s.slice(0, h)}…${s.slice(-t)}`;
}
function fmtTime(us: string): string {
  const ms = parseInt(us ?? "0");
  if (!ms) return "—";
  return new Date(ms / 1000).toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value)
        .then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      style={{ background: "none", border: "none", cursor: "pointer",
               fontSize: 13, color: done ? "#22c55e" : "var(--text-dim)", padding: "0 3px" }}
      title="Copy">
      {done ? "✓" : "⎘"}
    </button>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       style={{ color: "#ff77c9", textDecoration: "none",
                display: "inline-flex", alignItems: "center", gap: 3 }}
       title="Open in Aptos Explorer">
      {children}<span style={{ fontSize: 10, opacity: 0.7 }}>↗</span>
    </a>
  );
}

function OurExplorerLink({ addr, label, onClick }: {
  addr: string; label?: string; onClick: (addr: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(addr)}
      style={{ ...MONO, background: "none", border: "none", cursor: "pointer",
               color: "#ff77c9", fontSize: 12, padding: 0,
               textDecoration: "underline dotted", display: "inline-flex",
               alignItems: "center", gap: 3 }}
      title="View in Shelby Explorer">
      {label ?? short(addr, 10, 8)} <span style={{ fontSize: 10 }}>→</span>
    </button>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span style={{ ...MONO, fontSize: 11, fontWeight: 700, padding: "3px 9px",
                   borderRadius: 5,
                   background: ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                   color: ok ? "#22c55e" : "#ef4444" }}>
      {ok ? "✓ Success" : "✗ Failed"}
    </span>
  );
}
function EmptyState({ icon, title, sub, mono }: { icon: string; title: string; sub?: string; mono?: boolean }) {
  return (
    <div style={{ padding: "56px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 14 }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{title}</div>
      {sub && (
        <div style={mono
          ? { fontSize: 12, color: "var(--text-muted)", maxWidth: 480, margin: "0 auto",
              lineHeight: 1.7, whiteSpace: "pre-line", textAlign: "left", ...MONO }
          : { fontSize: 14, color: "var(--text-muted)", maxWidth: 440, margin: "0 auto",
              lineHeight: 1.6 }
        }>{sub}</div>
      )}
    </div>
  );
}
function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div style={{ padding: "56px 24px", textAlign: "center" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 32, height: 32, border: "2px solid var(--border)",
                    borderTopColor: "#ff77c9", borderRadius: "50%",
                    animation: "spin 0.8s linear infinite", margin: "0 auto 14px" }}/>
      <div style={{ fontSize: 14, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

// ─── Sender balance widget ────────────────────────────────────────────────────

function SenderBalance({ address, network, onAddressClick }: {
  address: string; network: string; onAddressClick: (addr: string) => void;
}) {
  const [bal,   setBal]   = useState<string | null>(null);
  const [seq,   setSeq]   = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/node/account?address=${address}&network=${network}`)
      .then(r => r.json())
      .then((j: { ok: boolean; sequenceNumber?: string;
                  balanceApt?: string; activated?: boolean }) => {
        if (!j.ok) return;
        setSeq(j.sequenceNumber ?? null);
        setBal(j.balanceApt ?? null);
        setReady(true);
      })
      .catch(() => {});
  }, [address, network]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <OurExplorerLink addr={address} onClick={onAddressClick}/>
      <CopyBtn value={address}/>
      <ExtLink href={aptosExplorerAccount(address, network)}>Aptos ↗</ExtLink>
      {ready && (
        <>
          {bal !== null && (
            <span style={{ ...MONO, fontSize: 11, padding: "2px 8px",
                           borderRadius: 4, background: "rgba(255,119,201,0.1)",
                           color: "#ff77c9" }}>
              {bal} APT
            </span>
          )}
          {seq !== null && (
            <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
              {parseInt(seq).toLocaleString("en-US")} txs
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Flow 1: Account transactions with filters ────────────────────────────────

type FilterShelby = "all" | "shelby";

function AccountPanel({ address, network, onVersionClick, onAddressClick }: {
  address: string; network: string;
  onVersionClick: (v: string) => void;
  onAddressClick: (addr: string) => void;
}) {
  const [seqNum,    setSeqNum]    = useState(0);
  const [rawTxs,    setRawTxs]    = useState<NormTx[]>([]);
  const [page,      setPage]      = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [allLoaded, setAllLoaded] = useState(false);
  const [sortKey,   setSortKey]   = useState<SortKey>("newest");
  const [filter,    setFilter]    = useState<FilterShelby>("all");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const displayTxs = useMemo(() => {
    let rows = filter === "shelby" ? rawTxs.filter(t => t.isShelby) : rawTxs;
    if (sortKey === "gas_desc") rows = [...rows].sort((a, b) => b.gasFeeRaw - a.gasFeeRaw);
    if (sortKey === "gas_asc")  rows = [...rows].sort((a, b) => a.gasFeeRaw - b.gasFeeRaw);
    return rows;
  }, [rawTxs, sortKey, filter]);

  const loadPage = useCallback(async (pg: number, totalSeq: number) => {
    if (!alive.current) return;
    setLoading(true); setError(null);
    const startSeq  = Math.max(0, totalSeq - (pg + 1) * PAGE);
    const pageLimit = Math.min(PAGE, totalSeq - pg * PAGE);
    try {
      const params = new URLSearchParams({
        address, network,
        limit:  String(pageLimit > 0 ? pageLimit : PAGE),
        cursor: String(startSeq),
      });
      const j = await fetch(`/api/node/transactions?${params}`,
                            { signal: AbortSignal.timeout(20_000) })
                  .then(r => r.json()) as {
                    ok: boolean; txs?: NormTx[]; error?: string;
                  };
      if (!alive.current) return;
      if (!j.ok) throw new Error(j.error ?? "Failed");
      const rows = (j.txs ?? []).slice().reverse();
      setRawTxs(rows);
      setPage(pg);
      setAllLoaded(startSeq === 0 || rows.length === 0);
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [address, network]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSeqNum(0); setRawTxs([]); setPage(0);
    setError(null); setAllLoaded(false);
    (async () => {
      try {
        const accJson = await fetch(
          `/api/node/account?address=${address}&network=${network}`,
          { signal: AbortSignal.timeout(20_000) }
        ).then(r => r.json()) as {
          ok: boolean; sequenceNumber?: string; error?: string; activated?: boolean;
        };
        if (cancelled) return;
        if (!accJson.ok) { setError(accJson.error ?? "Account not found"); setLoading(false); return; }
        const total = parseInt(accJson.sequenceNumber ?? "0");
        setSeqNum(total);
        if (total === 0) { setAllLoaded(true); setLoading(false); return; }
        await loadPage(0, total);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = (e as Error).message;
          setError(msg.includes("abort") ? "Request timed out — please retry." : msg);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [address, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = seqNum > 0 ? Math.ceil(seqNum / PAGE) : 1;
  const hasPrev    = page > 0;
  const hasNext    = page < totalPages - 1;

  if (error) return <EmptyState icon="⚠️" title="Lookup failed" sub={error}/>;
  if (loading) return <Spinner label="Fetching transactions…"/>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "12px 20px",
                    background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
                    flexWrap: "wrap" }}>
        <div>
          <div style={{ ...MONO, fontSize: 11, color: "var(--text-muted)", marginBottom: 3,
                         textTransform: "uppercase", letterSpacing: "0.08em" }}>ADDRESS</div>
          <SenderBalance address={address} network={network} onAddressClick={onAddressClick}/>
        </div>
        <div>
          <div style={{ ...MONO, fontSize: 11, color: "var(--text-muted)", marginBottom: 3,
                         textTransform: "uppercase", letterSpacing: "0.08em" }}>TOTAL TXS</div>
          <div style={{ ...MONO, fontSize: 18, fontWeight: 800, color: "#ff77c9" }}>
            {seqNum.toLocaleString("en-US")}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => loadPage(page, seqNum)} disabled={loading}
            style={{ ...MONO, fontSize: 12, padding: "5px 12px", borderRadius: 6,
                     border: "1px solid var(--border)", background: "var(--bg-card)",
                     color: "#ff77c9", cursor: loading ? "not-allowed" : "pointer",
                     opacity: loading ? 0.5 : 1 }}>
            ⟳ Refresh
          </button>
          <span style={{ ...MONO, fontSize: 11, color: "var(--text-dim)" }}>
            Page {page + 1}/{totalPages}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 20px",
                    background: "var(--bg-card2)", borderBottom: "1px solid var(--border)",
                    flexWrap: "wrap" }}>
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)" }}>Filter:</span>
        {(["all","shelby"] as FilterShelby[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ ...MONO, fontSize: 11, padding: "4px 11px", borderRadius: 5,
                     border: `1px solid ${filter===f ? "#ff77c9" : "var(--border)"}`,
                     background: filter===f ? "rgba(255,119,201,0.12)" : "var(--bg-card)",
                     color: filter===f ? "#ff77c9" : "var(--text-muted)", cursor: "pointer" }}>
            {f === "all" ? "All" : "Shelby only"}
          </button>
        ))}
        <span style={{ ...MONO, fontSize: 11, color: "var(--text-muted)", marginLeft: 12 }}>Sort:</span>
        {([["newest","Newest first"],["gas_desc","Gas ↓"],["gas_asc","Gas ↑"]] as [SortKey,string][])
          .map(([k, lbl]) => (
            <button key={k} onClick={() => setSortKey(k)}
              style={{ ...MONO, fontSize: 11, padding: "4px 11px", borderRadius: 5,
                       border: `1px solid ${sortKey===k ? "#ff77c9" : "var(--border)"}`,
                       background: sortKey===k ? "rgba(255,119,201,0.12)" : "var(--bg-card)",
                       color: sortKey===k ? "#ff77c9" : "var(--text-muted)", cursor: "pointer" }}>
              {lbl}
            </button>
        ))}
        <span style={{ ...MONO, fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>
          {displayTxs.length} of {rawTxs.length} shown · filters apply to current page
        </span>
      </div>

      {displayTxs.length === 0 ? (
        <EmptyState icon="📭" title="No transactions match"
          sub={rawTxs.length === 0
            ? "This address has not submitted any transactions on this network."
            : "No transactions match the current filter on this page."}/>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)" }}>
                {["VERSION","TYPE","GAS (APT)","STATUS","TIME"].map(h => (
                  <th key={h} style={{ ...MONO, fontSize: 11, fontWeight: 700,
                                       textTransform: "uppercase", letterSpacing: "0.08em",
                                       color: "var(--text-muted)", padding: "10px 14px",
                                       textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayTxs.map((tx, i) => (
                <tr key={tx.version + i}
                    style={{ borderBottom: "1px solid var(--border)",
                             background: i % 2 ? "var(--bg-card2)" : "transparent" }}>
                  <td style={{ padding: "11px 14px" }}>
                    <button onClick={() => onVersionClick(tx.version)}
                      style={{ ...MONO, background: "none", border: "none", cursor: "pointer",
                               color: "#ff77c9", fontSize: 14, fontWeight: 700,
                               padding: 0, textDecoration: "underline dotted" }}>
                      v{tx.version}
                    </button>
                  </td>
                  <td style={{ padding: "11px 14px" }}>
                    <span style={{ ...MONO, fontSize: 13,
                                   color: tx.isShelby ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {tx.type || "System"}
                    </span>
                    {tx.isShelby && (
                      <span style={{ marginLeft: 7, fontSize: 10,
                                     background: "rgba(255,119,201,0.15)",
                                     color: "#ff77c9", borderRadius: 4,
                                     padding: "2px 6px", ...MONO }}>SHELBY</span>
                    )}
                  </td>
                  <td style={{ ...MONO, padding: "11px 14px", fontSize: 13 }}>
                    {tx.gasFeeApt === "0.00000000"
                      ? <span style={{ color: "var(--text-dim)" }}>—</span>
                      : tx.gasFeeApt}
                  </td>
                  <td style={{ padding: "11px 14px" }}><Badge ok={tx.success}/></td>
                  <td style={{ ...MONO, padding: "11px 14px", fontSize: 12,
                               color: "var(--text-muted)" }}>
                    {fmtTime(tx.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
        <button onClick={() => loadPage(page - 1, seqNum)} disabled={!hasPrev || loading}
          style={{ ...MONO, fontSize: 13, padding: "7px 18px", borderRadius: 7,
                   border: "1px solid var(--border)", background: "var(--bg-card)",
                   color: hasPrev ? "var(--text-primary)" : "var(--text-muted)",
                   cursor: hasPrev ? "pointer" : "not-allowed",
                   opacity: hasPrev ? 1 : 0.35 }}>← Newer</button>
        <span style={{ ...MONO, fontSize: 12, color: "var(--text-muted)" }}>
          {allLoaded && !hasNext
            ? "✓ All transactions loaded"
            : `${Math.min((page + 1) * PAGE, seqNum).toLocaleString()} of ${seqNum.toLocaleString()} total`}
        </span>
        <button onClick={() => loadPage(page + 1, seqNum)} disabled={!hasNext || loading}
          style={{ ...MONO, fontSize: 13, padding: "7px 18px", borderRadius: 7,
                   border: "1px solid var(--border)", background: "var(--bg-card)",
                   color: hasNext ? "var(--text-primary)" : "var(--text-muted)",
                   cursor: hasNext ? "pointer" : "not-allowed",
                   opacity: hasNext ? 1 : 0.35 }}>Older →</button>
      </div>
    </div>
  );
}

// ─── Flow 2: Transaction detail panel ────────────────────────────────────────

function TxDetailPanel({ version, network, onClose, onAddressClick }: {
  version: string; network: string;
  onClose: () => void; onAddressClick: (addr: string) => void;
}) {
  const [tx,      setTx]      = useState<NormTx | null>(null);
  const [blobs,   setBlobs]   = useState<BlobEvent[]>([]);
  const [note,    setNote]    = useState("");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setTx(null); setBlobs([]); setNote("");
    fetch(`/api/node/transactions?version=${version}&network=${network}`,
          { signal: AbortSignal.timeout(20_000) })
      .then(r => r.json())
      .then((j: { ok: boolean; tx?: NormTx; blobEvents?: BlobEvent[];
                  note?: string; error?: string }) => {
        if (cancelled) return;
        if (!j.ok) { setError(j.error ?? "Not found"); return; }
        setTx(j.tx ?? null); setBlobs(j.blobEvents ?? []); setNote(j.note ?? "");
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version, network, tick]);

  const header = (
    <div style={{ ...MONO, padding: "11px 20px", fontSize: 12, fontWeight: 700,
                   background: "rgba(255,119,201,0.06)",
                   textTransform: "uppercase", letterSpacing: "0.1em",
                   color: "#ff77c9", borderBottom: "1px solid var(--border)",
                   display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>⬢ Transaction Detail · v{version}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={refresh} disabled={loading}
          style={{ ...MONO, background: "none", border: "1px solid rgba(255,119,201,0.35)",
                   borderRadius: 5, color: "#ff77c9", cursor: loading ? "not-allowed" : "pointer",
                   fontSize: 12, padding: "3px 10px", opacity: loading ? 0.5 : 1 }}>
          ⟳ Refresh
        </button>
        <button onClick={onClose}
          style={{ background: "none", border: "none", color: "var(--text-muted)",
                   cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
    </div>
  );

  if (loading) return <div style={{ borderBottom: "2px solid rgba(255,119,201,0.3)" }}>{header}<Spinner label={`Loading v${version}…`}/></div>;
  if (error)   return <div style={{ borderBottom: "2px solid rgba(255,119,201,0.3)" }}>{header}<EmptyState icon="⚠️" title="Not found" sub={error}/></div>;
  if (!tx)     return null;

  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: "flex", gap: 16, padding: "10px 0",
                               borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...MONO, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                     letterSpacing: "0.08em", color: "var(--text-muted)",
                     width: 150, flexShrink: 0 }}>{label}</div>
      <div style={{ ...MONO, fontSize: 13, color: "var(--text-primary)",
                     wordBreak: "break-all", lineHeight: 1.5 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ borderBottom: "2px solid rgba(255,119,201,0.3)" }}>
      {header}
      <div style={{ padding: "16px 20px" }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)",
                      borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ ...MONO, fontWeight: 800, fontSize: 16, color: "#ff77c9" }}>v{tx.version}</span>
            <Badge ok={tx.success}/>
            {tx.isShelby && (
              <span style={{ fontSize: 11, background: "rgba(255,119,201,0.15)",
                             color: "#ff77c9", borderRadius: 5, padding: "3px 9px", ...MONO }}>
                SHELBY PROTOCOL
              </span>
            )}
          </div>
          {row("Hash",
            <>{short(tx.hash, 14, 8)}{" "}<CopyBtn value={tx.hash}/>
              <ExtLink href={aptosExplorerTxn(tx.hash, network)}>Aptos ↗</ExtLink></>)}
          {row("Sender",
            <SenderBalance address={tx.sender} network={network} onAddressClick={onAddressClick}/>)}
          {row("Function",  <span style={{ fontSize: 12 }}>{tx.fullFn || "System transaction"}</span>)}
          {row("Gas fee",   `${tx.gasFeeApt} APT`)}
          {row("Timestamp", fmtTime(tx.timestamp))}
          {note && (
            <div style={{ marginTop: 12, padding: "10px 14px",
                          background: "rgba(251,191,36,0.08)",
                          border: "1px solid rgba(251,191,36,0.3)", borderRadius: 7,
                          ...MONO, fontSize: 13, color: "#fbbf24" }}>ℹ {note}</div>
          )}
        </div>

        {blobs.length > 0 ? (
          <div>
            <div style={{ ...MONO, fontSize: 12, fontWeight: 700, textTransform: "uppercase",
                          letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 12 }}>
              🗂 Blob Metadata — {blobs.length} blob{blobs.length > 1 ? "s" : ""} registered
            </div>
            {blobs.map((b, i) => (
              <div key={i} style={{ background: "var(--bg-card)",
                                     border: "1px solid rgba(255,119,201,0.25)",
                                     borderRadius: 12, padding: "16px 20px", marginBottom: 14 }}>
                <div style={{ ...MONO, fontWeight: 700, fontSize: 14, color: "#ff77c9",
                               marginBottom: 12, wordBreak: "break-all" }}>
                  {b.blobName || `Blob #${i + 1}`}
                </div>
                {row("Size",       `${b.sizeKB} KB (${b.sizeBytes.toLocaleString("en-US")} bytes)`)}
                {row("Encoding",   b.encoding)}
                {row("Chunksets",  b.chunksetCount)}
                {row("Commitment", <>{short(b.blobCommitment, 14, 8)}{" "}<CopyBtn value={b.blobCommitment}/></>)}
                {row("Expires",    b.expiryDate)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "14px 18px", background: "var(--bg-card2)", borderRadius: 10,
                        ...MONO, fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            No BlobRegisteredEvent — regular Shelby transaction (not a blob upload).
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Blob name search result ──────────────────────────────────────────────────

function BlobSearchPanel({ blobName, network, onVersionClick }: {
  blobName: string; network: string; onVersionClick: (v: string) => void;
}) {
  const [blobs,   setBlobs]   = useState<{ txVersion: string; owner: string; registeredAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const params = new URLSearchParams({ network, name: blobName, limit: "20" });
    fetch(`/api/network/blobs-data?${params}`, { signal: AbortSignal.timeout(15_000) })
      .then(async r => {
        const ct = r.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) {
          throw new Error(`Server returned ${r.status} — blob search endpoint unavailable`);
        }
        return r.json();
      })
      .then((j: { ok: boolean; blobs?: typeof blobs; error?: string; note?: string; detail?: string[] }) => {
        if (cancelled) return;
        if (!j.ok) {
          const msg = [j.error, j.note, ...(j.detail ?? [])].filter(Boolean).join("\n");
          throw new Error(msg || "Search failed");
        }
        setBlobs(j.blobs ?? []);
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [blobName, network]);

  if (loading) return <Spinner label={`Searching for "${blobName}"…`}/>;
  if (error)   return <EmptyState icon="⚠️" title="Search failed" sub={error} mono/>;
  if (!blobs.length) return <EmptyState icon="🔍" title="Blob not found" sub={`No blob matching "${blobName}" was found in the indexed data.`}/>;

  return (
    <div>
      <div style={{ ...MONO, padding: "10px 20px", fontSize: 12, color: "var(--text-muted)",
                    borderBottom: "1px solid var(--border)", background: "var(--bg-card2)" }}>
        Found {blobs.length} result{blobs.length > 1 ? "s" : ""} for "{blobName}"
      </div>
      {blobs.map((b, i) => (
        <div key={i} style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)",
                               display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => onVersionClick(b.txVersion)}
            style={{ ...MONO, background: "none", border: "none", cursor: "pointer",
                     color: "#ff77c9", fontSize: 14, fontWeight: 700, padding: 0,
                     textDecoration: "underline dotted" }}>
            v{b.txVersion}
          </button>
          <span style={{ ...MONO, fontSize: 12, color: "var(--text-muted)" }}>
            Owner: {short(b.owner, 10, 8)}
          </span>
          <span style={{ ...MONO, fontSize: 12, color: "var(--text-dim)" }}>
            {fmtTime(b.registeredAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ExplorerContent() {
  const { network } = useNetwork();
  const router       = useRouter();
  const searchParams = useSearchParams();

  // ── Khởi tạo hook & theme theo hướng dẫn bản vá ──────────────────────────
  const themeCtx = (() => { try { return useTheme(); } catch { return { isDark: false }; } })();
  const isDark = themeCtx.isDark;
  const [blobState, blobCtrl] = useBlobSearch({ network });

  // ── Quản lý phân vùng Tab điều hướng ──────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("transactions");

  const [query,      setQuery]      = useState("");
  const [inputErr,   setInputErr]   = useState("");
  const [searchAddr, setSearchAddr] = useState("");
  const [selectedV,  setSelectedV]  = useState("");
  const [blobSearch, setBlobSearch] = useState("");

  const networkLabel = network === "shelbynet" ? "Shelbynet" : "Testnet";

  // ── Restore state from URL on mount / URL change ───────────────────────────
  useEffect(() => {
    const q = searchParams.get("q") ?? "";
    const v = searchParams.get("v") ?? "";
    const b = searchParams.get("b") ?? "";
    if (q.startsWith("0x")) { setSearchAddr(q); setQuery(q); }
    else if (/^\d+$/.test(q)) { setSelectedV(q); setQuery(q); }
    if (v) setSelectedV(v);
    if (b) { setBlobSearch(b); setQuery(b); }
  }, [searchParams]);

  // ── Input parser (Fail Fast) ───────────────────────────────────────────────
  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setInputErr("");

    // Wallet address
    if (q.startsWith("0x") && q.length >= 10) {
      setSearchAddr(q); setSelectedV(""); setBlobSearch("");
      setActiveTab("transactions");
      router.push(`/explorer?q=${encodeURIComponent(q)}`);
      return;
    }
    // "@0x…/path" blob path
    if (q.startsWith("@0x")) {
      const m = q.match(/^@(0x[0-9a-fA-F]{10,})\//);
      if (m) {
        setSearchAddr(m[1]); setSelectedV(""); setBlobSearch("");
        setActiveTab("transactions");
        router.push(`/explorer?q=${encodeURIComponent(m[1])}`);
        return;
      }
    }
    // Version number
    if (/^\d+$/.test(q)) {
      setSelectedV(q); setSearchAddr(""); setBlobSearch("");
      setActiveTab("transactions");
      router.push(`/explorer?q=${encodeURIComponent(q)}`);
      return;
    }
    // Plain blob name / filename
    if (q.includes(".") || q.includes("/") || q.length > 3) {
      setBlobSearch(q); setSearchAddr(""); setSelectedV("");
      setActiveTab("transactions");
      router.push(`/explorer?b=${encodeURIComponent(q)}`);
      return;
    }
    setInputErr("Enter a wallet address (0x…), a version number, or a blob/file name.");
  };

  const clearSearch = () => {
    setQuery(""); setSearchAddr(""); setSelectedV(""); setBlobSearch(""); setInputErr("");
    router.push("/explorer");
  };

  const onVersionClick = (v: string) => {
    setSelectedV(v);
    const base = searchAddr ? `?q=${encodeURIComponent(searchAddr)}&v=${v}` : `?q=${v}`;
    router.push(`/explorer${base}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onAddressClick = (addr: string) => {
    setSearchAddr(addr); setQuery(addr); setSelectedV(""); setBlobSearch("");
    router.push(`/explorer?q=${encodeURIComponent(addr)}`);
  };

  const showContent = searchAddr || selectedV || blobSearch;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)",
                  fontFamily: "var(--font-body,'Inter',system-ui,sans-serif)" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 940, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ padding: "36px 0 0", marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: -0.8,
                         fontFamily: "var(--font-headline,'Britti Sans','DM Sans',sans-serif)",
                         color: "var(--text-primary)" }}>Explorer</h1>
            <span style={{ ...MONO, fontSize: 12, padding: "5px 14px", borderRadius: 20,
                           background: "rgba(255,119,201,0.1)", color: "#ff77c9",
                           border: "1px solid rgba(255,119,201,0.2)" }}>
              {networkLabel}
            </span>
          </div>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: "var(--text-muted)" }}>
            {networkLabel} · Browse transactions and blob data
          </p>

          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setInputErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Wallet address (0x…)  ·  Version number  ·  Blob name or file.jpg"
              style={{ flex: 1, padding: "13px 16px", borderRadius: 9,
                       border: `1px solid ${inputErr ? "#ef4444" : "var(--border)"}`,
                       background: "var(--bg-card)", color: "var(--text-primary)",
                       fontSize: 14, outline: "none", ...MONO }}
            />
            <button onClick={handleSearch}
              style={{ padding: "13px 26px", borderRadius: 9, border: "none",
                       background: "#ff77c9", color: "#fff", fontWeight: 800,
                       fontSize: 14, cursor: "pointer", ...MONO }}>
              Search
            </button>
          </div>
          {inputErr && (
            <div style={{ ...MONO, fontSize: 12, color: "#ef4444", marginBottom: 8, lineHeight: 1.5 }}>
              ⚠ {inputErr}
            </div>
          )}
          {showContent && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...MONO, fontSize: 12, color: "var(--text-muted)" }}>
                {searchAddr ? "Address:" : selectedV ? "Version:" : "Blob:"}
              </span>
              <span style={{ ...MONO, fontSize: 12, color: "#ff77c9" }}>
                {searchAddr ? short(searchAddr, 14, 10) : selectedV ? `v${selectedV}` : blobSearch}
              </span>
              <button onClick={clearSearch}
                style={{ ...MONO, fontSize: 11, background: "none", border: "none",
                         color: "var(--text-dim)", cursor: "pointer" }}>× clear</button>
            </div>
          )}

          {/* ── Tích hợp Tab bar từ bản vá (STEP 4 & 5) ────────────────────── */}
          <div style={{ display: "flex", marginTop: 20, borderBottom: "1px solid var(--border)", gap: 8 }}>
            {[
              { id: "transactions", label: "⚡ Transactions" },
              { id: "blobs", label: "🗂 Blobs Explorer" },
              { id: "activity", label: "📈 Activity" },
              { id: "export", label: "↓ Export" },
              { id: "leaderboard", label: "🏆 Leaderboard" }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "10px 20px", fontSize: 14, fontWeight: 700,
                  color: activeTab === tab.id ? "#ff77c9" : "var(--text-muted)",
                  borderBottom: activeTab === tab.id ? "2px solid #ff77c9" : "2px solid transparent",
                  background: "none", border: "none", cursor: "pointer", ...MONO
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Vùng hiển thị nội dung động theo Tab ─────────────────────────── */}
      <div style={{ background: "var(--bg-card)", minHeight: 400 }}>
        <div style={{ maxWidth: 940, margin: "0 auto" }}>
          
          {/* TAB 1: TRANSACTIONS (Logic cũ được giữ nguyên) */}
          {activeTab === "transactions" && (
            <>
              {selectedV && (
                <TxDetailPanel
                  version={selectedV} network={network}
                  onClose={() => {
                    setSelectedV("");
                    const back = searchAddr ? `/explorer?q=${encodeURIComponent(searchAddr)}` : "/explorer";
                    router.push(back);
                  }}
                  onAddressClick={onAddressClick}
                />
              )}

              {searchAddr && !selectedV && (
                <AccountPanel
                  address={searchAddr} network={network}
                  onVersionClick={onVersionClick}
                  onAddressClick={onAddressClick}
                />
              )}

              {blobSearch && !selectedV && (
                <BlobSearchPanel
                  blobName={blobSearch} network={network}
                  onVersionClick={onVersionClick}
                />
              )}

              {!showContent && (
                <EmptyState icon="🔍" title="Search to explore"
                  sub="Enter a wallet address to view its transaction history, a version number to inspect a specific transaction and its blob data, or a file name to search blob uploads."/>
              )}
            </>
          )}

          {/* TAB 2: BLOBS EXPLORER (Thay thế nội dung theo STEP 3) */}
          {activeTab === "blobs" && (
            <div style={{ padding: "24px 20px" }}>
              {/* ── Blob search controls ─────────────────────────── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                <BlobSearchBar
                  query={blobCtrl.query}
                  onChange={blobCtrl.setQuery}
                  loading={blobState.loading}
                  isDark={isDark}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <BlobStatusFilter
                    status={blobCtrl.status}
                    onChange={blobCtrl.setStatus}
                    isDark={isDark}
                  />
                  {blobState.loading && (
                    <span style={{ fontSize: 12, opacity: 0.4, ...MONO }}>Loading…</span>
                  )}
                </div>
              </div>

              {/* ── Results ────────────────────────────────────────── */}
              <BlobTable state={blobState} isDark={isDark} />
              <div style={{ marginTop: 16 }}>
                <BlobPagination
                  state={blobState}
                  onPage={blobCtrl.setPage}
                  pageSize={20}
                  isDark={isDark}
                />
              </div>
            </div>
          )}

          {/* TAB 3: LIVE NETWORK ACTIVITY (STEP 4) */}
          {activeTab === "activity" && (
            <div style={{ padding: "24px 20px" }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text-primary)", ...MONO }}>
                Live Network Activity
              </h3>
              <ActivityFeed network={network} height={500} />
            </div>
          )}

          {/* TAB 4: EXPORT PANEL (STEP 5) */}
          {activeTab === "export" && (
            <div style={{ padding: "24px 20px" }}>
              <ExportPanel network={network} />
            </div>
          )}

          {/* TAB 5: SP LEADERBOARD (Phase 3 Week 4 — B1) */}
          {activeTab === "leaderboard" && (
            <div style={{ padding: "24px 20px" }}>
              <LeaderboardTab initialNetwork={network as "shelbynet" | "testnet"} />
            </div>
          )}

        </div>
      </div>

      <div style={{ maxWidth: 940, margin: "0 auto", padding: "10px 24px" }}>
        <div style={{ ...MONO, fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
          Source: Aptos Node REST API · proxied server-side
        </div>
      </div>
    </div>
  );
}

// ─── Suspense wrapper ──────────────────────────────────────────────────────────

function ExplorerFallback() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spinner label="Loading Explorer…"/>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<ExplorerFallback/>}>
      <ExplorerContent/>
    </Suspense>
  );
}