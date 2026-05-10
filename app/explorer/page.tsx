"use client";
/**
 * app/explorer/page.tsx — v1.0
 * Blob Explorer MVP — Week 2 deliverable
 *
 * Tabs:
 *   1. Recent Transactions (Shelbynet: Dedicated Indexer / Testnet: Aptos V3)
 *   2. Blobs (active, pending, deleted filter)
 *   3. SP Leaderboard (address, AZ, health, state)
 *
 * Features:
 *   - Unified search bar: blob_id | tx_hash | owner_address prefix
 *   - Cursor-based pagination (no library)
 *   - Theme-aware (CSS variables)
 *   - Network-aware (Shelbynet vs Testnet)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TxRecord {
  hash:        string;
  type:        string;
  sender:      string;
  success:     boolean;
  timestamp:   string;
  version:     string;
  gasUsed?:    number;
  blobCount?:  number;
}

interface BlobRecord {
  blobId:       string;
  owner:        string;
  size:         number;
  status:       "active" | "pending" | "deleted" | "unknown";
  registeredAt: string;
  expiresAt?:   string;
}

interface SpRecord {
  address:     string;
  addressShort:string;
  az:          string;
  health:      string;
  state:       string;
  stake?:      number;
  blsKey?:     string;
  ip?:         string;
  geo?:        { city?: string; countryCode?: string } | null;
}

type ExplorerTab = "transactions" | "blobs" | "leaderboard";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const CORE = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function num(v: unknown, fb = 0): number {
  const n = Number(v ?? fb);
  return isFinite(n) ? n : fb;
}

function str(v: unknown): string {
  if (v == null)             return "—";
  if (typeof v === "string") return v || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return "—";
}

function fmtBytes(b: number): string {
  if (!b || b <= 0) return "—";
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

function fmtDate(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts.slice(0, 16);
  }
}

function addrShort(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-5)}`;
}

function txTypeLabel(type: string): { label: string; color: string } {
  if (type.includes("register_multiple_blobs")) return { label: "multi-blob", color: "#2563eb" };
  if (type.includes("register_blob"))          return { label: "register",   color: "#16a34a" };
  if (type.includes("stage_code_chunk"))       return { label: "stage",      color: "#9333ea" };
  if (type.includes("delete") || type.includes("unregister")) return { label: "delete", color: "#ef4444" };
  if (type.includes("update_epoch"))           return { label: "epoch",      color: "#d97706" };
  if (type.includes("join") || type.includes("register_sp")) return { label: "join SP", color: "#0891b2" };
  return { label: type.split("::").pop()?.slice(0, 16) ?? type.slice(0, 16), color: "#6b7280" };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchShelbynetTxs(cursor = ""): Promise<{ txs: TxRecord[]; nextCursor: string }> {
  // Query Shelbynet dedicated indexer for recent account_transactions
  const query = `{
    txs: account_transactions(
      where: { account_address: { _eq: "${CORE}" } }
      order_by: { transaction_version: desc }
      limit: ${PAGE_SIZE}
      ${cursor ? `offset: ${cursor}` : ""}
    ) {
      transaction_version
      user_transaction {
        entry_function_id_str
        sender
        timestamp
        success
        gas_used
      }
    }
  }`;

  const r = await fetch("https://api.shelbynet.shelby.xyz/v1/graphql", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query }),
    signal:  AbortSignal.timeout(12_000),
  });

  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  const rows = ((j as any)?.data?.txs ?? []) as Record<string, unknown>[];

  const txs: TxRecord[] = rows.map(row => {
    const ut = (row.user_transaction ?? {}) as Record<string, unknown>;
    return {
      hash:      `v${row.transaction_version}`,
      version:   String(row.transaction_version ?? ""),
      type:      String(ut.entry_function_id_str ?? ""),
      sender:    String(ut.sender ?? ""),
      success:   Boolean(ut.success ?? true),
      timestamp: String(ut.timestamp ?? ""),
      gasUsed:   num(ut.gas_used),
    };
  });

  const newOffset = rows.length > 0
    ? String(num(cursor) + rows.length)
    : "";

  return { txs, nextCursor: rows.length >= PAGE_SIZE ? newOffset : "" };
}

async function fetchTestnetTxs(cursor = ""): Promise<{ txs: TxRecord[]; nextCursor: string }> {
  const query = `{
    txs: account_transactions(
      where: { account_address: { _eq: "${CORE}" } }
      order_by: { transaction_version: desc }
      limit: ${PAGE_SIZE}
      ${cursor ? `offset: ${cursor}` : ""}
    ) {
      transaction_version
      user_transaction {
        entry_function_id_str
        sender
        timestamp
        success
        gas_used
      }
    }
  }`;

  const r = await fetch("https://api.testnet.aptoslabs.com/v1/graphql", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query }),
    signal:  AbortSignal.timeout(12_000),
  });

  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  const rows = ((j as any)?.data?.txs ?? []) as Record<string, unknown>[];

  const txs: TxRecord[] = rows.map(row => {
    const ut = (row.user_transaction ?? {}) as Record<string, unknown>;
    return {
      hash:      `v${row.transaction_version}`,
      version:   String(row.transaction_version ?? ""),
      type:      String(ut.entry_function_id_str ?? ""),
      sender:    String(ut.sender ?? ""),
      success:   Boolean(ut.success ?? true),
      timestamp: String(ut.timestamp ?? ""),
      gasUsed:   num(ut.gas_used),
    };
  });

  const newOffset = rows.length >= PAGE_SIZE
    ? String(num(cursor) + rows.length)
    : "";

  return { txs, nextCursor: newOffset };
}

async function fetchBlobs(network: string, statusFilter: string, cursor = ""): Promise<{ blobs: BlobRecord[]; nextCursor: string }> {
  if (network === "testnet") {
    // Testnet: no dedicated indexer — use account_transactions to infer blobs
    // Return empty with note
    return { blobs: [], nextCursor: "" };
  }

  // Shelbynet: dedicated indexer blobs table
  let whereClause = "";
  if (statusFilter === "active")  whereClause = `_and: [{ is_written: { _eq: 1 } }, { is_deleted: { _eq: 0 } }]`;
  if (statusFilter === "pending") whereClause = `_and: [{ is_written: { _eq: 0 } }, { is_deleted: { _eq: 0 } }]`;
  if (statusFilter === "deleted") whereClause = `is_deleted: { _eq: 1 }`;
  if (!whereClause)               whereClause = `is_written: { _eq: 1 }`;

  const query = `{
    blobs(
      where: { ${whereClause} }
      order_by: { id: desc }
      limit: ${PAGE_SIZE}
      ${cursor ? `offset: ${cursor}` : ""}
    ) {
      id
      owner
      size
      is_written
      is_deleted
      created_at
    }
  }`;

  try {
    const r = await fetch("https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query }),
      signal:  AbortSignal.timeout(12_000),
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as Record<string, unknown>;
    const rows = ((j as any)?.data?.blobs ?? []) as Record<string, unknown>[];

    const blobs: BlobRecord[] = rows.map(row => {
      const isWritten = Boolean(row.is_written);
      const isDeleted = Boolean(row.is_deleted);
      let status: BlobRecord["status"] = "unknown";
      if (isDeleted)                        status = "deleted";
      else if (isWritten && !isDeleted)     status = "active";
      else if (!isWritten && !isDeleted)    status = "pending";

      return {
        blobId:       String(row.id ?? ""),
        owner:        String(row.owner ?? ""),
        size:         num(row.size),
        status,
        registeredAt: String(row.created_at ?? ""),
      };
    });

    const newOffset = rows.length >= PAGE_SIZE
      ? String(num(cursor) + rows.length)
      : "";

    return { blobs, nextCursor: newOffset };
  } catch {
    return { blobs: [], nextCursor: "" };
  }
}

async function fetchSPList(network: string): Promise<SpRecord[]> {
  try {
    const r = await fetch(`/api/network/providers?network=${network}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as Record<string, unknown>;
    const raw = ((j as any)?.data?.providers ?? []) as Record<string, unknown>[];

    return raw.map(sp => ({
      address:      String(sp.address ?? ""),
      addressShort: String(sp.addressShort ?? addrShort(String(sp.address ?? ""))),
      az:           String(sp.availabilityZone ?? "unknown"),
      health:       String(sp.health ?? "Unknown"),
      state:        String(sp.state ?? "Active"),
      stake:        sp.stake ? num(sp.stake) : undefined,
      blsKey:       sp.blsKey ? String(sp.blsKey) : undefined,
      ip:           sp.ipAddress ? String(sp.ipAddress) : undefined,
      geo:          (sp.geo && typeof sp.geo === "object") ? sp.geo as { city?: string; countryCode?: string } : null,
    }));
  } catch {
    return [];
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {});
      }}
      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: ok ? "#22c55e" : "var(--text-dim)", padding: "0 3px" }}
    >
      {ok ? "✓" : "⧉"}
    </button>
  );
}

function StatusChip({ status }: { status: BlobRecord["status"] }) {
  const MAP = {
    active:  { bg: "rgba(34,197,94,0.1)",   color: "#22c55e", label: "Active"  },
    pending: { bg: "rgba(245,158,11,0.1)",  color: "#f59e0b", label: "Pending" },
    deleted: { bg: "rgba(239,68,68,0.1)",   color: "#ef4444", label: "Deleted" },
    unknown: { bg: "rgba(100,116,139,0.1)", color: "#94a3b8", label: "?"       },
  };
  const s = MAP[status] ?? MAP.unknown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, display: "inline-block", flexShrink: 0 }} />
      {s.label}
    </span>
  );
}

function HealthChip({ health }: { health: string }) {
  const color =
    health === "Healthy"             ? "#22c55e" :
    health === "Faulty" || health === "Unhealthy" ? "#ef4444" :
    health === "Awaiting Activation" ? "#f59e0b" :
    health === "Frozen"              ? "#3b82f6" :
    "#9ca3af";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: `${color}18`, color, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {str(health)}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "exspin 0.8s linear infinite" }} />
      <style>{`@keyframes exspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 360, margin: "0 auto" }}>{sub}</div>}
    </div>
  );
}

function Pager({ hasPrev, hasNext, onPrev, onNext, loading }: {
  hasPrev: boolean; hasNext: boolean;
  onPrev: () => void; onNext: () => void; loading: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
      <button onClick={onPrev} disabled={!hasPrev || loading} style={btnStyle(!hasPrev || loading)}>← Previous</button>
      <button onClick={onNext} disabled={!hasNext || loading} style={btnStyle(!hasNext || loading)}>Next →</button>
    </div>
  );
}

function btnStyle(disabled: boolean) {
  return {
    padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg-card)", color: disabled ? "var(--text-dim)" : "var(--text-primary)",
    fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────
function TransactionsTab({ network }: { network: string }) {
  const [txs,     setTxs]     = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const cursorStack = useRef<string[]>([""]);
  const [cursorIdx, setCursorIdx] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (cursor: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      const fetcher = network === "testnet" ? fetchTestnetTxs : fetchShelbynetTxs;
      const { txs: rows, nextCursor } = await fetcher(cursor);
      if (!alive.current) return;
      setTxs(rows);
      // push next cursor only if not already there
      setCursorIdx(prev => {
        if (nextCursor && cursorStack.current[prev + 1] !== nextCursor) {
          cursorStack.current = [...cursorStack.current.slice(0, prev + 1), nextCursor];
        }
        return prev;
      });
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    cursorStack.current = [""];
    setCursorIdx(0);
    setTxs([]);
    load("");
  }, [network, load]);

  const hasNext = !!cursorStack.current[cursorIdx + 1];
  const hasPrev = cursorIdx > 0;

  const goNext = () => {
    const next = cursorStack.current[cursorIdx + 1];
    if (next !== undefined) { setCursorIdx(i => i + 1); load(next); }
  };
  const goPrev = () => {
    const prev = cursorStack.current[cursorIdx - 1];
    if (prev !== undefined) { setCursorIdx(i => i - 1); load(prev); }
  };

  if (loading && txs.length === 0) return <Spinner />;
  if (error) return <EmptyState icon="⚠️" title="Failed to load transactions" sub={error} />;
  if (!txs.length) return <EmptyState icon="📭" title="No transactions found" sub="The indexer may still be syncing." />;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
              {["VERSION", "TYPE", "SENDER", "STATUS", "GAS", "TIME"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txs.map((tx, i) => {
              const { label, color } = txTypeLabel(tx.type);
              return (
                <tr key={tx.version || i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>v{tx.version}</span>
                      <CopyBtn text={tx.version} />
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${color}18`, color }}>{label}</span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{addrShort(tx.sender)}</span>
                      {tx.sender && <CopyBtn text={tx.sender} />}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: tx.success ? "#22c55e" : "#ef4444" }}>
                      {tx.success ? "✓ OK" : "✗ Fail"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>
                    {tx.gasUsed ? tx.gasUsed.toLocaleString("en-US") : "—"}
                  </td>
                  <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {tx.timestamp ? fmtDate(tx.timestamp) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager hasPrev={hasPrev} hasNext={hasNext} onPrev={goPrev} onNext={goNext} loading={loading} />
    </div>
  );
}

// ─── Blobs Tab ────────────────────────────────────────────────────────────────
function BlobsTab({ network }: { network: string }) {
  const [blobs,        setBlobs]        = useState<BlobRecord[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const cursorStack = useRef<string[]>([""]);
  const [cursorIdx,    setCursorIdx]    = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (cursor: string, sf: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      const { blobs: rows, nextCursor } = await fetchBlobs(network, sf, cursor);
      if (!alive.current) return;
      setBlobs(rows);
      setCursorIdx(prev => {
        if (nextCursor && cursorStack.current[prev + 1] !== nextCursor) {
          cursorStack.current = [...cursorStack.current.slice(0, prev + 1), nextCursor];
        }
        return prev;
      });
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    cursorStack.current = [""];
    setCursorIdx(0);
    setBlobs([]);
    load("", statusFilter);
  }, [network, statusFilter, load]);

  const hasNext = !!cursorStack.current[cursorIdx + 1];
  const hasPrev = cursorIdx > 0;

  if (network === "testnet") {
    return <EmptyState icon="⚗" title="Blob table not available on Testnet" sub="Testnet uses the generic Aptos V3 indexer which does not have a blobs table. Switch to Shelbynet to explore blobs." />;
  }

  return (
    <div>
      {/* Filter row */}
      <div style={{ display: "flex", gap: 4, padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)" }}>
        {(["active", "pending", "deleted", "all"] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)} style={{
            padding: "5px 13px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: statusFilter === f ? 700 : 400,
            cursor: "pointer", background: statusFilter === f ? "var(--accent)" : "transparent",
            color: statusFilter === f ? "#fff" : "var(--text-muted)", textTransform: "capitalize",
          }}>{f}</button>
        ))}
      </div>

      {loading && blobs.length === 0 ? <Spinner /> : error ? (
        <EmptyState icon="⚠️" title="Failed to load blobs" sub={error} />
      ) : !blobs.length ? (
        <EmptyState icon="📭" title={`No ${statusFilter} blobs found`} sub="The indexer may still be syncing, or there are no blobs matching this filter." />
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
                  {["BLOB ID", "OWNER", "SIZE", "STATUS", "REGISTERED"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {blobs.map((blob, i) => (
                  <tr key={blob.blobId || i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--accent)" }}>{addrShort(blob.blobId)}</span>
                        {blob.blobId && <CopyBtn text={blob.blobId} />}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{addrShort(blob.owner)}</span>
                        {blob.owner && <CopyBtn text={blob.owner} />}
                      </div>
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>
                      {fmtBytes(blob.size)}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <StatusChip status={blob.status} />
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>
                      {fmtDate(blob.registeredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager hasPrev={hasPrev} hasNext={hasNext} onPrev={() => { const p = cursorStack.current[cursorIdx - 1]; if (p !== undefined) { setCursorIdx(i => i - 1); load(p, statusFilter); } }} onNext={() => { const n = cursorStack.current[cursorIdx + 1]; if (n !== undefined) { setCursorIdx(i => i + 1); load(n, statusFilter); } }} loading={loading} />
        </>
      )}
    </div>
  );
}

// ─── SP Leaderboard Tab ───────────────────────────────────────────────────────
function LeaderboardTab({ network }: { network: string }) {
  const [sps,     setSps]     = useState<SpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sort,    setSort]    = useState<"az" | "health" | "state">("az");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (alive.current) { setLoading(true); setError(null); setSps([]); }
    fetchSPList(network)
      .then(rows => { if (alive.current) { setSps(rows); setLoading(false); } })
      .catch(e  => { if (alive.current) { setError((e as Error).message); setLoading(false); } });
  }, [network]);

  const sorted = [...sps].sort((a, b) => {
    if (sort === "health") return a.health.localeCompare(b.health);
    if (sort === "state")  return a.state.localeCompare(b.state);
    return a.az.localeCompare(b.az);
  });

  const healthyCount = sps.filter(s => s.health === "Healthy").length;
  const activeCount  = sps.filter(s => s.state  === "Active").length;

  if (loading) return <Spinner />;
  if (error)   return <EmptyState icon="⚠️" title="Failed to load providers" sub={error} />;
  if (!sorted.length) return <EmptyState icon="📭" title="No storage providers found" />;

  return (
    <div>
      {/* Summary + sort */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
          <span>Total: <strong style={{ color: "var(--text-primary)" }}>{sps.length}</strong></span>
          <span>Healthy: <strong style={{ color: "#22c55e" }}>{healthyCount}</strong></span>
          <span>Active: <strong style={{ color: "#0891b2" }}>{activeCount}</strong></span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["az", "health", "state"] as const).map(s => (
            <button key={s} onClick={() => setSort(s)} style={{
              padding: "4px 11px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11, fontWeight: sort === s ? 700 : 400,
              background: sort === s ? "var(--accent)" : "var(--bg-card)", color: sort === s ? "#fff" : "var(--text-muted)", cursor: "pointer",
            }}>
              Sort: {s === "az" ? "Zone" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-card2)", borderBottom: "1px solid var(--border)" }}>
              {["#", "ADDRESS", "ZONE / DC", "HEALTH", "STATE", "LOCATION", "BLS KEY"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((sp, i) => (
              <tr key={sp.address || i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "var(--text-dim)" }}>#{i + 1}</td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>{str(sp.addressShort)}</span>
                    {sp.address && <CopyBtn text={sp.address} />}
                  </div>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>{str(sp.az)}</td>
                <td style={{ padding: "10px 14px" }}><HealthChip health={sp.health} /></td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: sp.state === "Active" ? "#0891b2" : sp.state === "Waitlisted" ? "#f59e0b" : sp.state === "Frozen" ? "#3b82f6" : "#9ca3af" }}>
                    {str(sp.state)}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-dim)" }}>
                  {sp.geo?.city ? `${sp.geo.city}${sp.geo.countryCode ? ", " + sp.geo.countryCode : ""}` : (sp.ip ?? "—")}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  {sp.blsKey ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>{sp.blsKey.slice(0, 14)}…</span>
                      <CopyBtn text={sp.blsKey} />
                    </div>
                  ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────
function SearchBar({ onSearch }: { onSearch: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") onSearch(q.trim()); }}
        placeholder="Search: blob_id / tx_version / owner address…"
        style={{
          flex: 1, padding: "10px 16px", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg-card)",
          color: "var(--text-primary)", fontSize: 14, outline: "none",
          fontFamily: "monospace",
        }}
      />
      <button
        onClick={() => onSearch(q.trim())}
        style={{
          padding: "10px 20px", borderRadius: 10, border: "none",
          background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}
      >
        Search
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExplorerPage() {
  const { network, config } = useNetwork();
  const { isDark }          = useTheme();
  const isTestnet           = network === "testnet";
  const [tab, setTab]       = useState<ExplorerTab>("transactions");
  const [searchResult, setSearchResult] = useState<string | null>(null);

  // Reset tab on network change
  useEffect(() => { setTab("transactions"); setSearchResult(null); }, [network]);

  const handleSearch = (q: string) => {
    if (!q) return;
    setSearchResult(q);
    // Redirect to appropriate tab based on prefix heuristic
    // 0x prefix + long = address → leaderboard
    // v + number = version → transactions
    // blob_ or long hex = blob → blobs tab
    if (q.startsWith("v") || /^\d+$/.test(q)) setTab("transactions");
    else if (q.startsWith("0x") && q.length >= 64) setTab("leaderboard");
    else setTab("blobs");
  };

  const TABS: { id: ExplorerTab; label: string; icon: string }[] = [
    { id: "transactions", label: "Transactions", icon: "↯" },
    { id: "blobs",        label: "Blobs",        icon: "◈" },
    { id: "leaderboard",  label: "SP Directory", icon: "◎" },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 4px" }}>
      <style>{`
        @media(max-width:768px){
          .ex-header{flex-direction:column!important;gap:8px!important}
        }
      `}</style>

      {/* Header */}
      <div className="ex-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.8 }}>
            Explorer
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "5px 0 0" }}>
            {isTestnet ? "Aptos Testnet · Shelby Protocol" : "Shelbynet"} · Browse transactions, blobs, and providers
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, fontWeight: 600, background: isTestnet ? "rgba(147,51,234,0.1)" : "rgba(34,197,94,0.1)", color: isTestnet ? "#9333ea" : "#16a34a" }}>
            {config.label}
          </span>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <SearchBar onSearch={handleSearch} />
        {searchResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Showing results for: <strong style={{ color: "var(--text-primary)" }}>{searchResult}</strong>
            <button onClick={() => setSearchResult(null)} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: 11 }}>× clear</button>
          </div>
        )}
      </div>

      {/* Tabs + table */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "13px 22px", fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: tab === t.id ? "var(--bg-card)" : "transparent",
              color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
              borderBottom: tab === t.id ? `2px solid var(--accent)` : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ opacity: 0.7 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "transactions" && <TransactionsTab network={network} />}
        {tab === "blobs"        && <BlobsTab        network={network} />}
        {tab === "leaderboard"  && <LeaderboardTab  network={network} />}
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace", textAlign: "right" }}>
        {isTestnet
          ? "Source: Aptos Testnet Indexer V3 · account_transactions on contract address"
          : "Source: Shelby Dedicated Indexer (GraphQL) · account_transactions + blobs table"}
      </div>
    </div>
  );
}