"use client";
/**
 * app/explorer/page.tsx — v3.0
 *
 * Two-flow architecture (pure Aptos Node REST API — no indexer required):
 *
 * FLOW 1 — 0x address (≥66 chars):
 *   1.1 GET /api/node/account?address=&network=   → sequence_number (total tx count)
 *   1.2 GET /api/node/transactions?address=&network=&limit=&cursor=  → tx list
 *   Gas fee = (gas_used × gas_unit_price) / 100_000_000 APT
 *
 * FLOW 2 — version number (pure digits):
 *   GET /api/node/transactions?version=&network=  → single tx + BlobRegisteredEvent parse
 *   Also triggered by clicking any version link in Flow 1 results.
 *
 * Input rules (Fail Fast):
 *   • starts with "0x" AND length ≥ 10  → Flow 1
 *   • pure digits                        → Flow 2
 *   • anything else                      → validation error
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NormTx {
  version:   string;
  hash:      string;
  type:      string;
  fullFn:    string;
  sender:    string;
  success:   boolean;
  gasFeeApt: string;
  timestamp: string;
  isShelby:  boolean;
}

interface BlobEvent {
  blobName:       string;
  sizeBytes:      number;
  sizeKB:         string;
  encoding:       string;
  chunksetCount:  string;
  blobCommitment: string;
  expiryDate:     string;
}

interface SpRecord {
  address: string; addressShort: string; az: string;
  health: string; state: string; blsKey?: string;
  ip?: string; geo?: { city?: string; countryCode?: string } | null;
}

type Tab = "transactions" | "blobs" | "directory";

const PAGE = 25;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    <button
      onClick={() => { navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11,
               color: done ? "#22c55e" : "var(--text-dim)", padding: "0 3px" }}
      title="Copy full value"
    >{done ? "✓" : "⎘"}</button>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return (
    <span style={{ fontSize: 10, fontFamily: "var(--font-mono,'Roboto Mono',monospace)",
                   fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                   background: ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                   color: ok ? "#22c55e" : "#ef4444" }}>
      {ok ? "Success" : "Failed"}
    </span>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 380, margin: "0 auto" }}>{sub}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{ width: 28, height: 28, border: "2px solid var(--border)",
                    borderTopColor: "#ff77c9", borderRadius: "50%",
                    animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
    </div>
  );
}

// ─── Flow 1: Account + Transactions ──────────────────────────────────────────

function AccountPanel({ address, network, onVersionClick }: {
  address: string;
  network: string;
  onVersionClick: (v: string) => void;
}) {
  const [seqNum,  setSeqNum]  = useState<string | null>(null);
  const [txs,     setTxs]     = useState<NormTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [cursor,  setCursor]  = useState("");
  const [nextCursor, setNext] = useState("");
  const [cursorHistory, setHistory] = useState<string[]>([""]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (cur: string) => {
    if (!alive.current) return;
    setLoading(true); setError(null);
    try {
      // 1.1 — account info (sequence_number)
      const accRes  = await fetch(`/api/node/account?address=${address}&network=${network}`);
      const accJson = await accRes.json() as { ok: boolean; sequenceNumber?: string; error?: string; activated?: boolean };
      if (!alive.current) return;

      if (!accJson.ok && accJson.activated === false) {
        setError(accJson.error ?? "Account not activated");
        setLoading(false);
        return;
      }
      if (accJson.ok) setSeqNum(accJson.sequenceNumber ?? null);

      // 1.2 — transaction list
      const params = new URLSearchParams({ address, network, limit: String(PAGE) });
      if (cur) params.set("cursor", cur);
      const txRes  = await fetch(`/api/node/transactions?${params}`);
      const txJson = await txRes.json() as { ok: boolean; txs?: NormTx[]; nextCursor?: string; note?: string; error?: string };
      if (!alive.current) return;

      if (!txJson.ok) throw new Error(txJson.error ?? "Failed to load transactions");
      setTxs(txJson.txs ?? []);
      setNext(txJson.nextCursor ?? "");
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [address, network]);

  useEffect(() => { setSeqNum(null); setTxs([]); setCursor(""); setNext(""); setHistory([""]); load(""); },
    [address, network]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = () => {
    if (!nextCursor) return;
    setHistory(h => [...h, nextCursor]);
    setCursor(nextCursor);
    load(nextCursor);
  };
  const goPrev = () => {
    const prev = cursorHistory.at(-2) ?? "";
    setHistory(h => h.slice(0, -1));
    setCursor(prev);
    load(prev);
  };

  if (error) return <EmptyState icon="⚠️" title="Account lookup failed" sub={error}/>;
  if (loading) return <Spinner/>;

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono,'Roboto Mono',monospace)" };

  return (
    <div>
      {/* Account info bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "10px 16px",
                    background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
                    flexWrap: "wrap" }}>
        <div>
          <div style={{ ...mono, fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>ADDRESS</div>
          <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4 }}>
            {short(address, 10, 8)}<CopyBtn value={address}/>
          </div>
        </div>
        {seqNum !== null && (
          <div>
            <div style={{ ...mono, fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>TOTAL TXS</div>
            <div style={{ ...mono, fontSize: 14, fontWeight: 700, color: "#ff77c9" }}>
              {parseInt(seqNum).toLocaleString("en-US")}
            </div>
          </div>
        )}
        <div style={{ marginLeft: "auto", ...mono, fontSize: 10, color: "var(--text-muted)" }}>
          Showing last {PAGE} · click version to inspect blob data
        </div>
      </div>

      {/* Transaction table */}
      {txs.length === 0 ? (
        <EmptyState icon="📭" title="No transactions found"
          sub="This address has not submitted any transactions on this network."/>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg-card2)" }}>
                {["VERSION","TYPE","GAS (APT)","STATUS","TIME"].map(h => (
                  <th key={h} style={{ ...mono, fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                                       letterSpacing: "0.07em", color: "var(--text-muted)",
                                       padding: "8px 12px", textAlign: "left",
                                       borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txs.map((tx, i) => (
                <tr key={tx.version}
                    style={{ borderBottom: "1px solid var(--border)",
                             background: i % 2 ? "var(--bg-card2)" : "transparent" }}>
                  <td style={{ padding: "9px 12px" }}>
                    <button onClick={() => onVersionClick(tx.version)}
                      style={{ ...mono, background: "none", border: "none", cursor: "pointer",
                               color: "#ff77c9", fontSize: 12, fontWeight: 600, padding: 0,
                               textDecoration: "underline dotted" }}>
                      v{tx.version}
                    </button>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ ...mono, fontSize: 11,
                                   color: tx.isShelby ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {tx.type || "System Block"}
                    </span>
                    {tx.isShelby && (
                      <span style={{ marginLeft: 6, fontSize: 9, background: "rgba(255,119,201,0.15)",
                                     color: "#ff77c9", borderRadius: 3, padding: "1px 5px", ...mono }}>
                        SHELBY
                      </span>
                    )}
                  </td>
                  <td style={{ ...mono, padding: "9px 12px", fontSize: 11, color: "var(--text-primary)" }}>
                    {tx.gasFeeApt === "0.00000000" ? "—" : tx.gasFeeApt}
                  </td>
                  <td style={{ padding: "9px 12px" }}><Badge ok={tx.success}/></td>
                  <td style={{ ...mono, padding: "9px 12px", fontSize: 10, color: "var(--text-muted)" }}>
                    {fmtTime(tx.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 16px",
                    borderTop: "1px solid var(--border)" }}>
        <button onClick={goPrev} disabled={cursorHistory.length <= 1}
          style={{ ...mono, fontSize: 11, padding: "5px 14px", borderRadius: 6,
                   border: "1px solid var(--border)", background: "var(--bg-card)",
                   color: "var(--text-muted)", cursor: cursorHistory.length <= 1 ? "not-allowed" : "pointer",
                   opacity: cursorHistory.length <= 1 ? 0.4 : 1 }}>← Prev</button>
        <button onClick={goNext} disabled={!nextCursor}
          style={{ ...mono, fontSize: 11, padding: "5px 14px", borderRadius: 6,
                   border: "1px solid var(--border)", background: "var(--bg-card)",
                   color: "var(--text-muted)", cursor: !nextCursor ? "not-allowed" : "pointer",
                   opacity: !nextCursor ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

// ─── Flow 2: Single Transaction + Blob Events ─────────────────────────────────

function TxDetailPanel({ version, network }: { version: string; network: string }) {
  const [tx,     setTx]     = useState<NormTx | null>(null);
  const [blobs,  setBlobs]  = useState<BlobEvent[]>([]);
  const [note,   setNote]   = useState("");
  const [loading,setLoading]= useState(true);
  const [error,  setError]  = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setTx(null); setBlobs([]); setNote("");
    fetch(`/api/node/transactions?version=${version}&network=${network}`)
      .then(r => r.json())
      .then((j: { ok: boolean; tx?: NormTx; blobEvents?: BlobEvent[]; note?: string; error?: string }) => {
        if (cancelled) return;
        if (!j.ok) { setError(j.error ?? "Failed"); return; }
        setTx(j.tx ?? null);
        setBlobs(j.blobEvents ?? []);
        setNote(j.note ?? "");
      })
      .catch(e => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version, network]);

  if (loading) return <Spinner/>;
  if (error)   return <EmptyState icon="⚠️" title="Transaction not found" sub={error}/>;
  if (!tx)     return null;

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono,'Roboto Mono',monospace)" };
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} style={{ display: "flex", gap: 12, padding: "8px 0",
                               borderBottom: "1px solid var(--border)" }}>
      <div style={{ ...mono, fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                     letterSpacing: "0.07em", color: "var(--text-muted)", width: 140, flexShrink: 0 }}>{label}</div>
      <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)", wordBreak: "break-all" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      {/* TX summary card */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)",
                    borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ ...mono, fontWeight: 700, fontSize: 14, color: "#ff77c9" }}>v{tx.version}</span>
          <Badge ok={tx.success}/>
          {tx.isShelby && (
            <span style={{ fontSize: 10, background: "rgba(255,119,201,0.15)", color: "#ff77c9",
                           borderRadius: 4, padding: "2px 7px", ...mono }}>SHELBY PROTOCOL</span>
          )}
        </div>
        {row("Hash",      <>{short(tx.hash, 12, 8)}<CopyBtn value={tx.hash}/></>)}
        {row("Sender",    <>{short(tx.sender, 10, 8)}<CopyBtn value={tx.sender}/></>)}
        {row("Function",  tx.fullFn || "System transaction")}
        {row("Gas fee",   `${tx.gasFeeApt} APT`)}
        {row("Timestamp", fmtTime(tx.timestamp))}
        {note && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(251,191,36,0.08)",
                        border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6,
                        ...mono, fontSize: 11, color: "#fbbf24" }}>ℹ {note}</div>
        )}
      </div>

      {/* Blob events */}
      {blobs.length > 0 ? (
        <div>
          <div style={{ ...mono, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 10 }}>
            🗂 Blob Metadata ({blobs.length} blob{blobs.length > 1 ? "s" : ""} registered)
          </div>
          {blobs.map((b, i) => (
            <div key={i} style={{ background: "var(--bg-card)", border: "1px solid rgba(255,119,201,0.25)",
                                   borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ ...mono, fontWeight: 700, fontSize: 13, color: "#ff77c9", marginBottom: 10 }}>
                {b.blobName || `Blob #${i + 1}`}
              </div>
              {row("Size",        `${b.sizeKB} KB (${b.sizeBytes.toLocaleString("en-US")} bytes)`)}
              {row("Encoding",    b.encoding)}
              {row("Chunksets",   b.chunksetCount)}
              {row("Commitment",  <>{short(b.blobCommitment, 12, 8)}<CopyBtn value={b.blobCommitment}/></>)}
              {row("Expires",     b.expiryDate)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: "16px", background: "var(--bg-card2)", borderRadius: 8,
                      ...mono, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
          No BlobRegisteredEvent found — this is a regular Shelby transaction.
        </div>
      )}
    </div>
  );
}

// ─── SP Directory Tab (unchanged logic) ───────────────────────────────────────

function DirectoryTab({ network }: { network: string }) {
  const [sps,     setSps]     = useState<SpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(15_000) })
      .then(r => r.json())
      .then((j: { ok: boolean; providers?: SpRecord[]; error?: string }) => {
        if (!alive.current) return;
        if (!j.ok) throw new Error(j.error ?? "Failed");
        setSps(j.providers ?? []);
      })
      .catch(e => { if (alive.current) setError((e as Error).message); })
      .finally(() => { if (alive.current) setLoading(false); });
  }, [network]);

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono,'Roboto Mono',monospace)" };

  if (error)   return <EmptyState icon="⚠️" title="Failed to load providers" sub={error}/>;
  if (loading) return <Spinner/>;
  if (!sps.length) return <EmptyState icon="📭" title="No storage providers found"/>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--bg-card2)" }}>
            {["ADDRESS","LOCATION","AZ","HEALTH","STATE","BLS KEY"].map(h => (
              <th key={h} style={{ ...mono, fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                                    letterSpacing: "0.07em", color: "var(--text-muted)",
                                    padding: "8px 12px", textAlign: "left",
                                    borderBottom: "1px solid var(--border)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sps.map((sp, i) => (
            <tr key={sp.address} style={{ borderBottom: "1px solid var(--border)",
                                           background: i % 2 ? "var(--bg-card2)" : "transparent" }}>
              <td style={{ padding: "9px 12px" }}>
                <div style={{ ...mono, fontSize: 12, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, display: "inline-block", transform: "rotate(45deg)",
                                  background: sp.health === "Healthy" ? "#22c55e" : sp.health === "Faulty" ? "#ef4444" : "#a855f7",
                                  flexShrink: 0 }}/>
                  {sp.addressShort ?? short(sp.address)}
                  <CopyBtn value={sp.address}/>
                </div>
              </td>
              <td style={{ ...mono, padding: "9px 12px", fontSize: 11, color: "var(--text-muted)" }}>
                {sp.geo?.city ?? "—"}{sp.geo?.countryCode ? `, ${sp.geo.countryCode}` : ""}
              </td>
              <td style={{ ...mono, padding: "9px 12px", fontSize: 10, color: "var(--text-muted)" }}>
                {sp.az ?? "—"}
              </td>
              <td style={{ padding: "9px 12px" }}>
                <span style={{ ...mono, fontSize: 11, fontWeight: 600,
                               color: sp.health === "Healthy" ? "#22c55e" : sp.health === "Faulty" ? "#ef4444" : "#a855f7" }}>
                  ◆ {sp.health}
                </span>
              </td>
              <td style={{ padding: "9px 12px" }}>
                <span style={{ ...mono, fontSize: 11, color: sp.state === "Active" ? "#22c55e" : "var(--text-muted)" }}>
                  ◆ {sp.state}
                </span>
              </td>
              <td style={{ ...mono, padding: "9px 12px", fontSize: 10, color: "var(--text-dim)" }}>
                {sp.blsKey ? <>{short(sp.blsKey, 8, 4)}<CopyBtn value={sp.blsKey}/></> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Explorer Page ───────────────────────────────────────────────────────

export default function ExplorerPage() {
  const { network }  = useNetwork();
  const { isDark }   = useTheme();

  const [query,   setQuery]   = useState("");
  const [input,   setInput]   = useState("");
  const [tab,     setTab]     = useState<Tab>("directory");
  const [inputErr,setInputErr]= useState("");

  // Flow 1 state
  const [searchAddr, setSearchAddr] = useState("");

  // Flow 2 state — version selected (from input OR by clicking a tx row)
  const [selectedVersion, setSelectedVersion] = useState("");

  const networkLabel = network === "shelbynet" ? "Shelbynet" : "Testnet";

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setInputErr("");

    // Classify input
    if (q.startsWith("0x") && q.length >= 10) {
      // Flow 1 — wallet address
      setSearchAddr(q);
      setSelectedVersion("");
      setTab("transactions");
    } else if (/^\d+$/.test(q)) {
      // Flow 2 — transaction version number
      setSelectedVersion(q);
      setSearchAddr("");
      setTab("transactions");
    } else {
      // Invalid — fail fast
      setInputErr("Invalid input — enter a wallet address (0x…) or a transaction version number.");
    }
  };

  const onVersionClick = (v: string) => {
    setSelectedVersion(v);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearSearch = () => {
    setQuery(""); setSearchAddr(""); setSelectedVersion(""); setInputErr("");
  };

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono,'Roboto Mono',monospace)" };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "transactions", label: "Transactions", icon: "⚡" },
    { id: "directory",    label: "SP Directory", icon: "◎" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)",
                  fontFamily: "var(--font-body,'Inter',system-ui,sans-serif)" }}>
      {/* Header */}
      <div style={{ padding: "28px 24px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                      flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: -0.5,
                         fontFamily: "var(--font-headline,'Britti Sans','DM Sans',sans-serif)",
                         color: "var(--text-primary)" }}>Explorer</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              {networkLabel} · Browse transactions, blobs, and providers
            </p>
          </div>
          <span style={{ ...mono, fontSize: 11, padding: "4px 12px", borderRadius: 20,
                         background: "rgba(255,119,201,0.1)", color: "#ff77c9",
                         border: "1px solid rgba(255,119,201,0.2)" }}>
            {networkLabel}
          </span>
        </div>

        {/* Search bar */}
        <div style={{ maxWidth: 720, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setInputErr(""); }}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Wallet address (0x…) or transaction version number…"
              style={{ flex: 1, padding: "11px 14px", borderRadius: 8,
                       border: `1px solid ${inputErr ? "#ef4444" : "var(--border)"}`,
                       background: "var(--bg-card)", color: "var(--text-primary)",
                       fontSize: 13, outline: "none",
                       fontFamily: "var(--font-mono,'Roboto Mono',monospace)" }}
            />
            <button onClick={handleSearch} style={{
              padding: "11px 22px", borderRadius: 8, border: "none",
              background: "#ff77c9", color: "#fff", fontWeight: 700, fontSize: 13,
              cursor: "pointer", whiteSpace: "nowrap",
              fontFamily: "var(--font-mono,'Roboto Mono',monospace)",
            }}>Search</button>
          </div>
          {inputErr && (
            <div style={{ ...mono, fontSize: 11, color: "#ef4444", marginTop: 6 }}>⚠ {inputErr}</div>
          )}
          {(searchAddr || selectedVersion) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>
                {searchAddr ? `Address: ` : `Version: `}
              </span>
              <span style={{ ...mono, fontSize: 11, color: "#ff77c9" }}>
                {searchAddr ? short(searchAddr, 12, 10) : `v${selectedVersion}`}
              </span>
              <button onClick={clearSearch}
                style={{ ...mono, fontSize: 10, background: "none", border: "none",
                         color: "var(--text-dim)", cursor: "pointer", padding: "0 4px" }}>
                × clear
              </button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 20px", border: "none", background: "transparent",
              cursor: "pointer", fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? "#ff77c9" : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid #ff77c9" : "2px solid transparent",
              fontFamily: "var(--font-mono,'Roboto Mono',monospace)",
              transition: "color 0.15s",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background: "var(--bg-card)", minHeight: 400 }}>
        {tab === "transactions" && (
          <>
            {/* Flow 2: single tx detail view */}
            {selectedVersion && (
              <div style={{ borderBottom: "2px solid rgba(255,119,201,0.3)" }}>
                <div style={{ ...mono, padding: "10px 16px", fontSize: 11, fontWeight: 700,
                               background: "rgba(255,119,201,0.06)",
                               textTransform: "uppercase", letterSpacing: "0.1em",
                               color: "#ff77c9", borderBottom: "1px solid var(--border)" }}>
                  ⬢ Transaction Detail · v{selectedVersion}
                  <button onClick={() => setSelectedVersion("")}
                    style={{ float: "right", background: "none", border: "none",
                             color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
                    ✕ close
                  </button>
                </div>
                <TxDetailPanel version={selectedVersion} network={network}/>
              </div>
            )}

            {/* Flow 1: account tx list */}
            {searchAddr && (
              <AccountPanel address={searchAddr} network={network} onVersionClick={onVersionClick}/>
            )}

            {/* Default: no search yet */}
            {!searchAddr && !selectedVersion && (
              <EmptyState icon="🔍" title="Search to explore"
                sub="Enter a wallet address to see its transaction history, or a version number to inspect a specific transaction and its blob data."/>
            )}
          </>
        )}

        {tab === "directory" && <DirectoryTab network={network}/>}
      </div>

      {/* Footer attribution */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)",
                    ...mono, fontSize: 10, color: "var(--text-dim)", textAlign: "right" }}>
        Source: Aptos Node REST API · proxied server-side
      </div>
    </div>
  );
}