"use client";
/**
 * app/explorer/page.tsx — v2.0
 *
 * KEY CHANGES vs v1.0:
 *  - ALL direct browser GraphQL fetches removed (were causing CSP violations)
 *  - Transactions  → GET /api/network/transactions?network=&cursor=
 *  - Blobs         → GET /api/network/blobs-data?network=&status=&cursor=
 *  - SP directory  → GET /api/network/providers?network=   (already server-side)
 *  - Skeleton loading states added throughout
 *  - Search bar wired to tab auto-select heuristic (unchanged)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TxRecord {
  hash: string; version: string; type: string; sender: string;
  success: boolean; timestamp: string; gasUsed: number;
}

interface BlobRecord {
  blobId: string; owner: string; size: number;
  status: "active" | "pending" | "deleted" | "unknown";
  registeredAt: string;
}

interface SpRecord {
  address: string; addressShort: string; az: string;
  health: string; state: string; blsKey?: string;
  ip?: string; geo?: { city?: string; countryCode?: string } | null;
}

type ExplorerTab = "transactions" | "blobs" | "leaderboard";

const PAGE_SIZE = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addrShort(a: string): string {
  return !a || a.length < 10 ? a : `${a.slice(0, 8)}…${a.slice(-5)}`;
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
    return new Date(ts).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return ts.slice(0, 16); }
}

function txTypeLabel(type: string): { label: string; color: string } {
  if (type.includes("register_multiple_blobs")) return { label: "multi-blob",  color: "#2563eb" };
  if (type.includes("register_blob"))           return { label: "register",    color: "#16a34a" };
  if (type.includes("stage_code_chunk"))        return { label: "stage",       color: "#9333ea" };
  if (type.includes("delete") || type.includes("unregister")) return { label: "delete", color: "#ef4444" };
  if (type.includes("update_epoch"))            return { label: "epoch",       color: "#d97706" };
  if (type.includes("join") || type.includes("register_sp"))  return { label: "join SP", color: "#0891b2" };
  return { label: type.split("::").pop()?.slice(0, 16) ?? type.slice(0, 16), color: "#6b7280" };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(text)
          .then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })
          .catch(() => {});
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
    health === "Healthy"   ? "#22c55e" :
    health === "Faulty" || health === "Unhealthy" ? "#ef4444" :
    health === "Frozen"    ? "#3b82f6" :
    "#f59e0b";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: `${color}18`, color, whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {health}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "exspin 0.8s linear infinite" }} />
      <style>{`@keyframes exspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function SkeletonRows({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} style={{ borderBottom: "1px solid var(--border-soft)" }}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} style={{ padding: "10px 14px" }}>
              <div
                className="skeleton"
                style={{ height: 14, borderRadius: 4, width: j === 0 ? "60%" : j === 1 ? "80%" : "70%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div style={{ padding: "56px 20px", textAlign: "center", color: "var(--text-muted)" }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-dim)", maxWidth: 360, margin: "0 auto", lineHeight: 1.6 }}>{sub}</div>}
    </div>
  );
}

function Pager({ hasPrev, hasNext, onPrev, onNext, loading }: {
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; loading: boolean;
}) {
  const btn = (disabled: boolean) => ({
    padding: "6px 16px", borderRadius: 8, border: "1px solid var(--border)",
    background: "var(--bg-card)", fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? "var(--text-dim)" : "var(--text-primary)", opacity: disabled ? 0.5 : 1,
  });
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
      <button onClick={onPrev} disabled={!hasPrev || loading} style={btn(!hasPrev || loading)}>← Prev</button>
      <button onClick={onNext} disabled={!hasNext || loading} style={btn(!hasNext || loading)}>Next →</button>
    </div>
  );
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────
function TransactionsTab({ network }: { network: string }) {
  const [txs,     setTxs]     = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const cursorStack            = useRef<string[]>([""]);
  const [cursorIdx, setCursorIdx] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (cursor: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      // Uses server-side proxy route — no direct browser fetch to indexer
      const r = await fetch(
        `/api/network/transactions?network=${network}&cursor=${cursor}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      const j = await r.json() as { ok: boolean; txs?: TxRecord[]; nextCursor?: string; error?: string };
      if (!alive.current) return;
      if (!j.ok) throw new Error(j.error ?? "Request failed");
      setTxs(j.txs ?? []);
      if ((j.nextCursor ?? "") && cursorStack.current[cursorIdx + 1] !== j.nextCursor) {
        cursorStack.current = [...cursorStack.current.slice(0, cursorIdx + 1), j.nextCursor!];
      }
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [network, cursorIdx]);

  useEffect(() => {
    cursorStack.current = [""];
    setCursorIdx(0);
    setTxs([]);
    load("");
  }, [network]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = () => {
    const next = cursorStack.current[cursorIdx + 1];
    if (next !== undefined) { setCursorIdx(i => i + 1); load(next); }
  };
  const goPrev = () => {
    const prev = cursorStack.current[cursorIdx - 1];
    if (prev !== undefined) { setCursorIdx(i => i - 1); load(prev); }
  };

  if (error) return <EmptyState icon="⚠️" title="Failed to load transactions" sub={error} />;

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
            {loading
              ? <SkeletonRows cols={6} />
              : txs.length === 0
              ? <tr><td colSpan={6}><EmptyState icon="📭" title="No transactions found" sub="The indexer may still be syncing." /></td></tr>
              : txs.map((tx, i) => {
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
                        {fmtDate(tx.timestamp)}
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>
        </table>
      </div>
      <Pager
        hasPrev={cursorIdx > 0}
        hasNext={!!cursorStack.current[cursorIdx + 1]}
        onPrev={goPrev}
        onNext={goNext}
        loading={loading}
      />
    </div>
  );
}

// ─── Blobs Tab ────────────────────────────────────────────────────────────────
function BlobsTab({ network }: { network: string }) {
  const [blobs,        setBlobs]        = useState<BlobRecord[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const cursorStack                     = useRef<string[]>([""]);
  const [cursorIdx,    setCursorIdx]    = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (cursor: string, sf: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      // Uses server-side proxy route — no direct browser fetch to indexer
      const r = await fetch(
        `/api/network/blobs-data?network=${network}&status=${sf}&cursor=${cursor}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      const j = await r.json() as { ok: boolean; blobs?: BlobRecord[]; nextCursor?: string; note?: string; error?: string };
      if (!alive.current) return;
      if (!j.ok) throw new Error(j.error ?? "Request failed");
      setBlobs(j.blobs ?? []);
      if ((j.nextCursor ?? "") && cursorStack.current[cursorIdx + 1] !== j.nextCursor) {
        cursorStack.current = [...cursorStack.current.slice(0, cursorIdx + 1), j.nextCursor!];
      }
    } catch (e: unknown) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [network, cursorIdx]);

  useEffect(() => {
    cursorStack.current = [""];
    setCursorIdx(0);
    setBlobs([]);
    load("", statusFilter);
  }, [network, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (network === "testnet") {
    return (
      <EmptyState
        icon="⚗"
        title="Blob table not available on Testnet"
        sub="Testnet uses the generic Aptos V3 indexer which does not expose a blobs table. Switch to Shelbynet to explore blobs."
      />
    );
  }

  return (
    <div>
      {/* Status filter */}
      <div style={{ display: "flex", gap: 4, padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)" }}>
        {(["active", "pending", "deleted", "all"] as const).map(f => (
          <button key={f} onClick={() => setStatusFilter(f)} style={{
            padding: "5px 13px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: statusFilter === f ? 700 : 400,
            cursor: "pointer", background: statusFilter === f ? "var(--accent)" : "transparent",
            color: statusFilter === f ? "#fff" : "var(--text-muted)", textTransform: "capitalize",
          }}>{f}</button>
        ))}
      </div>

      {error
        ? <EmptyState icon="⚠️" title="Failed to load blobs" sub={error} />
        : (
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
                  {loading
                    ? <SkeletonRows cols={5} />
                    : blobs.length === 0
                    ? <tr><td colSpan={5}><EmptyState icon="📭" title={`No ${statusFilter} blobs found`} sub="Try a different filter or wait for the indexer to sync." /></td></tr>
                    : blobs.map((blob, i) => (
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
                          <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{fmtBytes(blob.size)}</td>
                          <td style={{ padding: "10px 14px" }}><StatusChip status={blob.status} /></td>
                          <td style={{ padding: "10px 14px", fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace" }}>{fmtDate(blob.registeredAt)}</td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
            <Pager
              hasPrev={cursorIdx > 0}
              hasNext={!!cursorStack.current[cursorIdx + 1]}
              onPrev={() => { const p = cursorStack.current[cursorIdx - 1]; if (p !== undefined) { setCursorIdx(i => i - 1); load(p, statusFilter); } }}
              onNext={() => { const n = cursorStack.current[cursorIdx + 1]; if (n !== undefined) { setCursorIdx(i => i + 1); load(n, statusFilter); } }}
              loading={loading}
            />
          </>
        )
      }
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
    fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(25_000) })
      .then(r => r.json())
      .then((j: any) => {
        if (!alive.current) return;
        const raw = j?.data?.providers ?? [];
        setSps(raw.map((sp: any) => ({
          address:      String(sp.address ?? ""),
          addressShort: String(sp.addressShort ?? ""),
          az:           String(sp.availabilityZone ?? "unknown"),
          health:       String(sp.health ?? "Unknown"),
          state:        String(sp.state ?? "Active"),
          blsKey:       sp.blsKey ? String(sp.blsKey) : undefined,
          ip:           sp.ipAddress ? String(sp.ipAddress) : undefined,
          geo:          sp.geo ?? null,
        })));
        setLoading(false);
      })
      .catch((e: unknown) => { if (alive.current) { setError((e as Error).message); setLoading(false); } });
  }, [network]);

  const sorted = [...sps].sort((a, b) =>
    sort === "health" ? a.health.localeCompare(b.health) :
    sort === "state"  ? a.state.localeCompare(b.state)   :
    a.az.localeCompare(b.az)
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-muted)" }}>
          <span>Total: <strong style={{ color: "var(--text-primary)" }}>{sps.length}</strong></span>
          <span>Healthy: <strong style={{ color: "#22c55e" }}>{sps.filter(s => s.health === "Healthy").length}</strong></span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["az", "health", "state"] as const).map(s => (
            <button key={s} onClick={() => setSort(s)} style={{
              padding: "4px 11px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11, fontWeight: sort === s ? 700 : 400,
              background: sort === s ? "var(--accent)" : "var(--bg-card)", color: sort === s ? "#fff" : "var(--text-muted)", cursor: "pointer",
            }}>
              {s === "az" ? "Zone" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error
        ? <EmptyState icon="⚠️" title="Failed to load providers" sub={error} />
        : (
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
                {loading
                  ? <SkeletonRows cols={7} />
                  : sorted.length === 0
                  ? <tr><td colSpan={7}><EmptyState icon="📭" title="No storage providers found" /></td></tr>
                  : sorted.map((sp, i) => (
                      <tr key={sp.address || i} style={{ borderBottom: "1px solid var(--border-soft)", background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-card2)" }}>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "var(--text-dim)" }}>#{i + 1}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>{sp.addressShort}</span>
                            {sp.address && <CopyBtn text={sp.address} />}
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-secondary)" }}>{sp.az}</td>
                        <td style={{ padding: "10px 14px" }}><HealthChip health={sp.health} /></td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: sp.state === "Active" ? "#0891b2" : sp.state === "Waitlisted" ? "#f59e0b" : sp.state === "Frozen" ? "#3b82f6" : "#9ca3af" }}>
                            {sp.state}
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
                    ))
                }
              </tbody>
            </table>
          </div>
        )
      }
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
        placeholder="Search: blob_id / tx_version (v12345) / owner address…"
        style={{
          flex: 1, padding: "10px 16px", borderRadius: 10,
          border: "1px solid var(--border)", background: "var(--bg-card)",
          color: "var(--text-primary)", fontSize: 14, outline: "none",
          fontFamily: "monospace",
        }}
      />
      <button
        onClick={() => onSearch(q.trim())}
        style={{ padding: "10px 22px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
      >
        Search
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExplorerPage() {
  const { network, config } = useNetwork();
  const isTestnet            = network === "testnet";
  const [tab, setTab]        = useState<ExplorerTab>("transactions");
  const [searchResult, setSearchResult] = useState<string | null>(null);

  useEffect(() => { setTab("transactions"); setSearchResult(null); }, [network]);

  const handleSearch = (q: string) => {
    if (!q) return;
    setSearchResult(q);
    // Heuristic: "v12345" or pure digits → transactions; long 0x → leaderboard; else → blobs
    if (q.startsWith("v") || /^\d+$/.test(q))  setTab("transactions");
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
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: -0.8 }}>Explorer</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "5px 0 0" }}>
            {isTestnet ? "Aptos Testnet · Shelby Protocol" : "Shelbynet"} · Browse transactions, blobs, and providers
          </p>
        </div>
        <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, fontWeight: 600, background: isTestnet ? "rgba(147,51,234,0.1)" : "rgba(34,197,94,0.1)", color: isTestnet ? "#9333ea" : "#16a34a" }}>
          {config.label}
        </span>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <SearchBar onSearch={handleSearch} />
        {searchResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            Filtering for: <strong style={{ color: "var(--text-primary)" }}>{searchResult}</strong>
            <button onClick={() => setSearchResult(null)} style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", fontSize: 11 }}>× clear</button>
          </div>
        )}
      </div>

      {/* Tab card */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-card2)", overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "13px 22px", fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: tab === t.id ? "var(--bg-card)" : "transparent",
              color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ opacity: 0.7 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {tab === "transactions" && <TransactionsTab network={network} />}
        {tab === "blobs"        && <BlobsTab        network={network} />}
        {tab === "leaderboard"  && <LeaderboardTab  network={network} />}
      </div>

      {/* Source footer */}
      <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace", textAlign: "right" }}>
        {isTestnet
          ? "Source: Aptos Testnet Indexer V3 · proxied server-side"
          : "Source: Shelby Dedicated Indexer (GraphQL) · proxied server-side"}
      </div>
    </div>
  );
}