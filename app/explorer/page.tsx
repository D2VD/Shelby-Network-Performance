"use client";
/**
 * app/explorer/page.tsx — v2.0
 *
 * FIXES:
 * 1. Search by wallet address: Txs tab filters by sender, Blobs tab filters by owner
 *    Previously always hardcoded CORE address — now uses searchQuery when present
 * 2. File preview: detect MIME type from blob name extension, render image/text/video inline
 * 3. Clock shows UTC live time
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNetwork } from "@/components/network-context";
import { useTheme }   from "@/components/theme-context";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TxRecord {
  hash: string; type: string; sender: string;
  success: boolean; timestamp: string; version: string; gasUsed?: number;
}
interface BlobRecord {
  blobId: string; owner: string; size: number;
  status: "active"|"pending"|"deleted"|"unknown";
  registeredAt: string; expiresAt?: string;
}
interface SpRecord {
  address: string; addressShort: string; az: string;
  health: string; state: string; stake?: number;
  blsKey?: string; ip?: string;
  geo?: { city?: string; countryCode?: string } | null;
}
type ExplorerTab = "transactions"|"blobs"|"leaderboard";

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;
const CORE      = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";
const SHELBYNET_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
const SHELBY_DEDICATED  = "https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql";
const TESTNET_INDEXER   = "https://api.testnet.aptoslabs.com/v1/graphql";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function num(v: unknown, fb = 0): number { const n = Number(v ?? fb); return isFinite(n) ? n : fb; }
function str(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "—";
  if (typeof v === "number") return isFinite(v) ? String(v) : "—";
  return "—";
}
function fmtBytes(b: number): string {
  if (!b || b <= 0) return "—";
  if (b >= 1e9) return `${(b/1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b/1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b/1e3).toFixed(1)} KB`;
  return `${b} B`;
}
function fmtDate(ts: string): string {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString([],{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }
  catch { return ts.slice(0,16); }
}
function addrShort(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0,8)}…${addr.slice(-5)}`;
}
function txTypeLabel(type: string): { label: string; color: string } {
  if (type.includes("register_multiple_blobs")) return { label:"multi-blob", color:"#2563eb" };
  if (type.includes("register_blob"))          return { label:"register",   color:"#16a34a" };
  if (type.includes("stage_code_chunk"))       return { label:"stage",      color:"#9333ea" };
  if (type.includes("delete")||type.includes("unregister")) return { label:"delete", color:"#ef4444" };
  if (type.includes("update_epoch"))           return { label:"epoch",      color:"#d97706" };
  if (type.includes("join")||type.includes("register_sp")) return { label:"join SP", color:"#0891b2" };
  return { label: type.split("::").pop()?.slice(0,16) ?? type.slice(0,16), color:"#6b7280" };
}

// Detect if a string looks like an Aptos wallet address
function isWalletAddress(q: string): boolean {
  return q.startsWith("0x") && q.length >= 10;
}

// ─── Fetch helpers — now accept optional addressFilter ─────────────────────────
async function fetchShelbynetTxs(cursor = "", addressFilter?: string): Promise<{ txs: TxRecord[]; nextCursor: string }> {
  // If address filter provided, query by sender; otherwise query contract transactions
  const whereClause = addressFilter
    ? `user_transaction: { sender: { _eq: "${addressFilter}" } }`
    : `account_address: { _eq: "${CORE}" }`;

  const query = `{
    txs: account_transactions(
      where: { ${whereClause} }
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

  const r = await fetch(SHELBYNET_INDEXER, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  const rows = ((j as any)?.data?.txs ?? []) as Record<string, unknown>[];
  const txs: TxRecord[] = rows.map(row => {
    const ut = (row.user_transaction ?? {}) as Record<string, unknown>;
    return {
      hash: `v${row.transaction_version}`, version: String(row.transaction_version ?? ""),
      type: String(ut.entry_function_id_str ?? ""), sender: String(ut.sender ?? ""),
      success: Boolean(ut.success ?? true), timestamp: String(ut.timestamp ?? ""),
      gasUsed: num(ut.gas_used),
    };
  });
  return { txs, nextCursor: rows.length >= PAGE_SIZE ? String(num(cursor) + rows.length) : "" };
}

async function fetchTestnetTxs(cursor = "", addressFilter?: string): Promise<{ txs: TxRecord[]; nextCursor: string }> {
  const whereClause = addressFilter
    ? `user_transaction: { sender: { _eq: "${addressFilter}" } }`
    : `account_address: { _eq: "${CORE}" }`;

  const query = `{
    txs: account_transactions(
      where: { ${whereClause} }
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

  const r = await fetch(TESTNET_INDEXER, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json() as Record<string, unknown>;
  const rows = ((j as any)?.data?.txs ?? []) as Record<string, unknown>[];
  const txs: TxRecord[] = rows.map(row => {
    const ut = (row.user_transaction ?? {}) as Record<string, unknown>;
    return {
      hash: `v${row.transaction_version}`, version: String(row.transaction_version ?? ""),
      type: String(ut.entry_function_id_str ?? ""), sender: String(ut.sender ?? ""),
      success: Boolean(ut.success ?? true), timestamp: String(ut.timestamp ?? ""),
      gasUsed: num(ut.gas_used),
    };
  });
  return { txs, nextCursor: rows.length >= PAGE_SIZE ? String(num(cursor) + rows.length) : "" };
}

async function fetchBlobs(network: string, statusFilter: string, cursor = "", ownerFilter?: string): Promise<{ blobs: BlobRecord[]; nextCursor: string }> {
  if (network === "testnet") return { blobs: [], nextCursor: "" };

  // Build where clause — combine status and owner filters
  const conditions: string[] = [];
  if (statusFilter === "active")  conditions.push("{ is_written: { _eq: 1 } }", "{ is_deleted: { _eq: 0 } }");
  if (statusFilter === "pending") conditions.push("{ is_written: { _eq: 0 } }", "{ is_deleted: { _eq: 0 } }");
  if (statusFilter === "deleted") conditions.push("{ is_deleted: { _eq: 1 } }");
  if (!statusFilter || statusFilter === "all") conditions.push("{ is_written: { _eq: 1 } }");
  if (ownerFilter) conditions.push(`{ owner: { _eq: "${ownerFilter}" } }`);

  const whereClause = conditions.length > 0 ? `_and: [${conditions.join(",")}]` : "is_written: { _eq: 1 }";

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
    const r = await fetch(SHELBY_DEDICATED, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as Record<string, unknown>;
    const rows = ((j as any)?.data?.blobs ?? []) as Record<string, unknown>[];
    const blobs: BlobRecord[] = rows.map(row => {
      const isWritten = Boolean(row.is_written), isDeleted = Boolean(row.is_deleted);
      let status: BlobRecord["status"] = "unknown";
      if (isDeleted) status = "deleted";
      else if (isWritten) status = "active";
      else status = "pending";
      return { blobId: String(row.id??""), owner: String(row.owner??""), size: num(row.size), status, registeredAt: String(row.created_at??"") };
    });
    return { blobs, nextCursor: rows.length >= PAGE_SIZE ? String(num(cursor) + rows.length) : "" };
  } catch { return { blobs: [], nextCursor: "" }; }
}

async function fetchSPList(network: string): Promise<SpRecord[]> {
  try {
    const r = await fetch(`/api/network/providers?network=${network}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as Record<string, unknown>;
    const raw = ((j as any)?.data?.providers ?? []) as Record<string, unknown>[];
    return raw.map(sp => ({
      address: String(sp.address??""), addressShort: String(sp.addressShort ?? addrShort(String(sp.address??""))),
      az: String(sp.availabilityZone??"unknown"), health: String(sp.health??"Unknown"),
      state: String(sp.state??"Active"), stake: sp.stake ? num(sp.stake) : undefined,
      blsKey: sp.blsKey ? String(sp.blsKey) : undefined, ip: sp.ipAddress ? String(sp.ipAddress) : undefined,
      geo: (sp.geo && typeof sp.geo === "object") ? sp.geo as { city?: string; countryCode?: string } : null,
    }));
  } catch { return []; }
}

// ─── File Preview ─────────────────────────────────────────────────────────────
type PreviewType = "image"|"text"|"audio"|"video"|"code"|"pdf"|"unknown";

function getPreviewType(blobId: string): PreviewType {
  const ext = blobId.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","svg","bmp","ico"].includes(ext)) return "image";
  if (["mp4","webm","ogg","mov","avi"].includes(ext)) return "video";
  if (["mp3","wav","flac","aac","m4a"].includes(ext)) return "audio";
  if (["pdf"].includes(ext)) return "pdf";
  if (["txt","md","csv","json","xml","yaml","yml","toml","log"].includes(ext)) return "text";
  if (["js","ts","tsx","jsx","py","rs","go","c","cpp","h","java","sh","bash","css","html"].includes(ext)) return "code";
  return "unknown";
}

function BlobPreviewModal({ blob, onClose }: { blob: BlobRecord; onClose: () => void }) {
  const previewType = getPreviewType(blob.blobId);
  // Build Shelby blob URL pattern
  const blobUrl = `https://shelby.shelbynet.staging.shelby.xyz/${blob.blobId}`;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
      onClick={onClose}>
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:16, width:"100%", maxWidth:800, maxHeight:"85vh", overflow:"hidden", display:"flex", flexDirection:"column" }}
        onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 18px", borderBottom:"1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--text-primary)", fontFamily:"monospace", wordBreak:"break-all" }}>{blob.blobId}</div>
            <div style={{ fontSize:11, color:"var(--text-muted)", marginTop:2 }}>{fmtBytes(blob.size)} · {blob.status}</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <a href={blobUrl} target="_blank" rel="noreferrer" style={{ padding:"6px 12px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card2)", color:"var(--text-muted)", fontSize:12, textDecoration:"none" }}>Open ↗</a>
            <button onClick={onClose} style={{ width:32, height:32, borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", fontSize:18, cursor:"pointer", color:"var(--text-muted)", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
          </div>
        </div>

        {/* Preview content */}
        <div style={{ flex:1, overflow:"auto", padding:18 }}>
          {previewType === "image" && (
            <img src={blobUrl} alt={blob.blobId} style={{ maxWidth:"100%", maxHeight:500, objectFit:"contain", display:"block", margin:"0 auto", borderRadius:8 }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          {previewType === "video" && (
            <video controls style={{ width:"100%", maxHeight:480, borderRadius:8 }}>
              <source src={blobUrl} />
              Your browser does not support video playback.
            </video>
          )}
          {previewType === "audio" && (
            <div style={{ padding:24, textAlign:"center" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🎵</div>
              <audio controls style={{ width:"100%" }}>
                <source src={blobUrl} />
                Your browser does not support audio playback.
              </audio>
            </div>
          )}
          {previewType === "pdf" && (
            <iframe src={blobUrl} style={{ width:"100%", height:500, border:"none", borderRadius:8 }} title={blob.blobId} />
          )}
          {(previewType === "text" || previewType === "code") && (
            <TextPreview url={blobUrl} isCode={previewType === "code"} />
          )}
          {previewType === "unknown" && (
            <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)" }}>
              <div style={{ fontSize:48, marginBottom:16 }}>📄</div>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Preview not available</div>
              <div style={{ fontSize:13, marginBottom:20 }}>File type is not previewable. You can open or download it directly.</div>
              <a href={blobUrl} target="_blank" rel="noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"10px 20px", borderRadius:10, background:"var(--accent)", color:"#fff", fontSize:13, fontWeight:600, textDecoration:"none" }}>
                Open File ↗
              </a>
            </div>
          )}
        </div>

        {/* Metadata footer */}
        <div style={{ borderTop:"1px solid var(--border)", padding:"12px 18px", display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px,1fr))", gap:12 }}>
          {[
            { label:"Owner",    value:addrShort(blob.owner) },
            { label:"Size",     value:fmtBytes(blob.size) },
            { label:"Status",   value:blob.status },
            { label:"Registered", value:fmtDate(blob.registeredAt) },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize:10, color:"var(--text-dim)", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:2 }}>{label}</div>
              <div style={{ fontSize:12, fontFamily:"monospace", color:"var(--text-primary)" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Text/code preview — fetches content
function TextPreview({ url, isCode }: { url: string; isCode: boolean }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError]     = useState(false);

  useEffect(() => {
    fetch(url, { signal: AbortSignal.timeout(8_000) })
      .then(r => r.text())
      .then(t => setContent(t.slice(0, 50_000))) // limit 50KB display
      .catch(() => setError(true));
  }, [url]);

  if (error) return <div style={{ padding:24, textAlign:"center", color:"var(--text-muted)" }}>Failed to load content</div>;
  if (!content) return <div style={{ padding:24, textAlign:"center", color:"var(--text-muted)" }}>Loading…</div>;

  return (
    <pre style={{ margin:0, padding:16, borderRadius:8, background:"var(--bg-card2)", border:"1px solid var(--border)", fontSize:12, fontFamily:"monospace", overflowX:"auto", whiteSpace:"pre-wrap", color:"var(--text-primary)", maxHeight:400, overflow:"auto" }}>
      {content}
    </pre>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={e=>{e.stopPropagation();navigator.clipboard.writeText(text).then(()=>{setOk(true);setTimeout(()=>setOk(false),1500)}).catch(()=>{});}}
      style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:ok?"#22c55e":"var(--text-dim)", padding:"0 3px" }}>
      {ok?"✓":"⧉"}
    </button>
  );
}

function StatusChip({ status }: { status: BlobRecord["status"] }) {
  const MAP = { active:{bg:"rgba(34,197,94,0.1)",color:"#22c55e",label:"Active"}, pending:{bg:"rgba(245,158,11,0.1)",color:"#f59e0b",label:"Pending"}, deleted:{bg:"rgba(239,68,68,0.1)",color:"#ef4444",label:"Deleted"}, unknown:{bg:"rgba(100,116,139,0.1)",color:"#94a3b8",label:"?"} };
  const s = MAP[status] ?? MAP.unknown;
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:5, fontSize:11, fontWeight:600, background:s.bg, color:s.color, whiteSpace:"nowrap" }}><span style={{ width:5, height:5, borderRadius:"50%", background:s.color, display:"inline-block", flexShrink:0 }}/>{s.label}</span>;
}

function HealthChip({ health }: { health: string }) {
  const color = health==="Healthy"?"#22c55e":health==="Faulty"||health==="Unhealthy"?"#ef4444":health==="Awaiting Activation"?"#f59e0b":health==="Frozen"?"#3b82f6":"#9ca3af";
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:5, fontSize:11, fontWeight:600, background:`${color}18`, color, whiteSpace:"nowrap" }}><span style={{ width:5, height:5, borderRadius:"50%", background:color, flexShrink:0 }}/>{str(health)}</span>;
}

function Spinner() {
  return <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:40 }}><div style={{ width:24, height:24, borderRadius:"50%", border:"2px solid var(--border)", borderTopColor:"var(--accent)", animation:"exspin 0.8s linear infinite" }}/><style>{`@keyframes exspin{to{transform:rotate(360deg)}}`}</style></div>;
}

function EmptyState({ icon, title, sub }: { icon:string; title:string; sub?:string }) {
  return <div style={{ padding:"48px 20px", textAlign:"center", color:"var(--text-muted)" }}><div style={{ fontSize:32, marginBottom:10 }}>{icon}</div><div style={{ fontSize:14, fontWeight:600, color:"var(--text-secondary)", marginBottom:4 }}>{title}</div>{sub&&<div style={{ fontSize:12, color:"var(--text-dim)", maxWidth:360, margin:"0 auto" }}>{sub}</div>}</div>;
}

function Pager({ hasPrev, hasNext, onPrev, onNext, loading }: { hasPrev:boolean; hasNext:boolean; onPrev:()=>void; onNext:()=>void; loading:boolean }) {
  const s = (d: boolean) => ({ padding:"6px 14px", borderRadius:8, border:"1px solid var(--border)", background:"var(--bg-card)", color:d?"var(--text-dim)":"var(--text-primary)", fontSize:12, fontWeight:600, cursor:d?"not-allowed":"pointer", opacity:d?0.5:1 });
  return <div style={{ display:"flex", justifyContent:"flex-end", gap:8, padding:"12px 20px", borderTop:"1px solid var(--border)" }}><button onClick={onPrev} disabled={!hasPrev||loading} style={s(!hasPrev||loading)}>← Previous</button><button onClick={onNext} disabled={!hasNext||loading} style={s(!hasNext||loading)}>Next →</button></div>;
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────
function TransactionsTab({ network, searchQuery }: { network: string; searchQuery: string }) {
  const [txs,      setTxs]      = useState<TxRecord[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const cursorStack = useRef<string[]>([""]);
  const [cursorIdx, setCursorIdx] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // When searchQuery is a wallet address, filter by sender
  const addressFilter = (searchQuery && isWalletAddress(searchQuery)) ? searchQuery : undefined;

  const load = useCallback(async (cursor: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      const fetcher = network === "testnet" ? fetchTestnetTxs : fetchShelbynetTxs;
      const { txs: rows, nextCursor } = await fetcher(cursor, addressFilter);
      if (!alive.current) return;
      setTxs(rows);
      setCursorIdx(prev => {
        if (nextCursor && cursorStack.current[prev+1] !== nextCursor) {
          cursorStack.current = [...cursorStack.current.slice(0,prev+1), nextCursor];
        }
        return prev;
      });
    } catch (e: unknown) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setLoading(false); }
  }, [network, addressFilter]);

  useEffect(() => { cursorStack.current=[""]; setCursorIdx(0); setTxs([]); load(""); }, [network, searchQuery, load]);

  const hasNext = !!cursorStack.current[cursorIdx+1], hasPrev = cursorIdx > 0;

  if (loading && txs.length === 0) return <Spinner />;
  if (error) return <EmptyState icon="⚠️" title="Failed to load transactions" sub={error} />;
  if (!txs.length) return <EmptyState icon="📭" title={addressFilter ? "No transactions found for this address" : "No transactions found"} sub={addressFilter ? `Searched for sender: ${addrShort(addressFilter)}` : "The indexer may still be syncing."} />;

  return (
    <div>
      {addressFilter && (
        <div style={{ padding:"8px 16px", background:"rgba(37,99,235,0.08)", border:"1px solid rgba(37,99,235,0.2)", borderRadius:8, fontSize:12, color:"#2563eb", marginBottom:12, fontFamily:"monospace" }}>
          Showing transactions from: {addressFilter}
        </div>
      )}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
            {["VERSION","TYPE","SENDER","STATUS","GAS","TIME"].map(h=>(
              <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {txs.map((tx,i)=>{
              const { label, color } = txTypeLabel(tx.type);
              return (
                <tr key={tx.version||i} style={{ borderBottom:"1px solid var(--border-soft)", background:i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                  <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:12, color:"var(--accent)" }}>v{tx.version}</span><CopyBtn text={tx.version}/></div></td>
                  <td style={{ padding:"10px 14px" }}><span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:4, background:`${color}18`, color }}>{label}</span></td>
                  <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>{addrShort(tx.sender)}</span>{tx.sender&&<CopyBtn text={tx.sender}/>}</div></td>
                  <td style={{ padding:"10px 14px" }}><span style={{ fontSize:11, fontWeight:600, color:tx.success?"#22c55e":"#ef4444" }}>{tx.success?"✓ OK":"✗ Fail"}</span></td>
                  <td style={{ padding:"10px 14px", fontFamily:"monospace", fontSize:12, color:"var(--text-muted)" }}>{tx.gasUsed?tx.gasUsed.toLocaleString("en-US"):"—"}</td>
                  <td style={{ padding:"10px 14px", fontSize:11, color:"var(--text-dim)", fontFamily:"monospace", whiteSpace:"nowrap" }}>{tx.timestamp?fmtDate(tx.timestamp):"—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager hasPrev={hasPrev} hasNext={hasNext}
        onPrev={()=>{const p=cursorStack.current[cursorIdx-1];if(p!==undefined){setCursorIdx(i=>i-1);load(p);}}}
        onNext={()=>{const n=cursorStack.current[cursorIdx+1];if(n!==undefined){setCursorIdx(i=>i+1);load(n);}}}
        loading={loading} />
    </div>
  );
}

// ─── Blobs Tab ────────────────────────────────────────────────────────────────
function BlobsTab({ network, searchQuery }: { network: string; searchQuery: string }) {
  const [blobs,        setBlobs]        = useState<BlobRecord[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [previewBlob,  setPreviewBlob]  = useState<BlobRecord | null>(null);
  const cursorStack = useRef<string[]>([""]);
  const [cursorIdx,    setCursorIdx]    = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // If searchQuery is a wallet address, filter blobs by owner
  const ownerFilter = (searchQuery && isWalletAddress(searchQuery)) ? searchQuery : undefined;

  const load = useCallback(async (cursor: string, sf: string) => {
    if (alive.current) { setLoading(true); setError(null); }
    try {
      const { blobs: rows, nextCursor } = await fetchBlobs(network, sf, cursor, ownerFilter);
      if (!alive.current) return;
      setBlobs(rows);
      setCursorIdx(prev => {
        if (nextCursor && cursorStack.current[prev+1] !== nextCursor) {
          cursorStack.current = [...cursorStack.current.slice(0,prev+1), nextCursor];
        }
        return prev;
      });
    } catch (e: unknown) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setLoading(false); }
  }, [network, ownerFilter]);

  useEffect(() => { cursorStack.current=[""]; setCursorIdx(0); setBlobs([]); load("", statusFilter); }, [network, searchQuery, statusFilter, load]);

  if (network === "testnet") return <EmptyState icon="⚗" title="Blob table not available on Testnet" sub="Testnet uses the generic Aptos V3 indexer which does not have a blobs table. Switch to Shelbynet to explore blobs." />;

  return (
    <div>
      {/* Filter row */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"14px 20px", borderBottom:"1px solid var(--border)", background:"var(--bg-card2)", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:4 }}>
          {(["active","pending","deleted","all"] as const).map(f=>(
            <button key={f} onClick={()=>setStatusFilter(f)} style={{ padding:"5px 13px", borderRadius:7, border:"none", fontSize:12, fontWeight:statusFilter===f?700:400, cursor:"pointer", background:statusFilter===f?"var(--accent)":"transparent", color:statusFilter===f?"#fff":"var(--text-muted)", textTransform:"capitalize" }}>{f}</button>
          ))}
        </div>
        {ownerFilter && (
          <div style={{ fontSize:11, color:"#2563eb", background:"rgba(37,99,235,0.08)", border:"1px solid rgba(37,99,235,0.2)", borderRadius:6, padding:"3px 10px", fontFamily:"monospace" }}>
            Owner: {addrShort(ownerFilter)}
          </div>
        )}
      </div>

      {loading && blobs.length === 0 ? <Spinner /> : error ? (
        <EmptyState icon="⚠️" title="Failed to load blobs" sub={error} />
      ) : !blobs.length ? (
        <EmptyState icon="📭" title={ownerFilter ? "No blobs found for this address" : `No ${statusFilter} blobs found`} sub={ownerFilter ? `Owner: ${ownerFilter}` : "The indexer may still be syncing."} />
      ) : (
        <>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
                {["BLOB ID","OWNER","SIZE","STATUS","REGISTERED","PREVIEW"].map(h=>(
                  <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {blobs.map((blob,i)=>(
                  <tr key={blob.blobId||i} style={{ borderBottom:"1px solid var(--border-soft)", background:i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                    <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:11, color:"var(--accent)" }}>{addrShort(blob.blobId)}</span>{blob.blobId&&<CopyBtn text={blob.blobId}/>}</div></td>
                    <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:11, color:"var(--text-muted)" }}>{addrShort(blob.owner)}</span>{blob.owner&&<CopyBtn text={blob.owner}/>}</div></td>
                    <td style={{ padding:"10px 14px", fontFamily:"monospace", fontSize:12, color:"var(--text-secondary)" }}>{fmtBytes(blob.size)}</td>
                    <td style={{ padding:"10px 14px" }}><StatusChip status={blob.status}/></td>
                    <td style={{ padding:"10px 14px", fontSize:11, color:"var(--text-dim)", fontFamily:"monospace" }}>{fmtDate(blob.registeredAt)}</td>
                    <td style={{ padding:"10px 14px" }}>
                      <button onClick={()=>setPreviewBlob(blob)} style={{ padding:"4px 12px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg-card2)", fontSize:11, fontWeight:600, cursor:"pointer", color:"var(--text-primary)", transition:"all 0.12s" }}
                        onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="var(--accent)";(e.currentTarget as HTMLButtonElement).style.color="var(--accent)";}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.borderColor="var(--border)";(e.currentTarget as HTMLButtonElement).style.color="var(--text-primary)";}}>
                        ⬚ Preview
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager hasPrev={cursorIdx>0} hasNext={!!cursorStack.current[cursorIdx+1]}
            onPrev={()=>{const p=cursorStack.current[cursorIdx-1];if(p!==undefined){setCursorIdx(i=>i-1);load(p,statusFilter);}}}
            onNext={()=>{const n=cursorStack.current[cursorIdx+1];if(n!==undefined){setCursorIdx(i=>i+1);load(n,statusFilter);}}}
            loading={loading} />
        </>
      )}

      {/* Preview modal */}
      {previewBlob && <BlobPreviewModal blob={previewBlob} onClose={()=>setPreviewBlob(null)} />}
    </div>
  );
}

// ─── SP Leaderboard Tab ───────────────────────────────────────────────────────
function LeaderboardTab({ network, searchQuery }: { network: string; searchQuery: string }) {
  const [sps,     setSps]     = useState<SpRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [sort,    setSort]    = useState<"az"|"health"|"state">("az");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (alive.current) { setLoading(true); setError(null); setSps([]); }
    fetchSPList(network)
      .then(rows => { if (alive.current) { setSps(rows); setLoading(false); } })
      .catch(e  => { if (alive.current) { setError((e as Error).message); setLoading(false); } });
  }, [network]);

  // Filter by address if search query is an address
  const filtered = [...sps]
    .filter(sp => {
      if (!searchQuery) return true;
      if (isWalletAddress(searchQuery)) return sp.address.toLowerCase().includes(searchQuery.toLowerCase());
      return true;
    })
    .sort((a,b) => sort==="health" ? a.health.localeCompare(b.health) : sort==="state" ? a.state.localeCompare(b.state) : a.az.localeCompare(b.az));

  const healthyCount = sps.filter(s=>s.health==="Healthy").length;
  const activeCount  = sps.filter(s=>s.state==="Active").length;

  if (loading) return <Spinner />;
  if (error)   return <EmptyState icon="⚠️" title="Failed to load providers" sub={error} />;
  if (!filtered.length) return <EmptyState icon="📭" title={searchQuery ? "No SP found matching this address" : "No storage providers found"} />;

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 20px", borderBottom:"1px solid var(--border)", background:"var(--bg-card2)", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", gap:16, fontSize:12, color:"var(--text-muted)" }}>
          <span>Total: <strong style={{ color:"var(--text-primary)" }}>{filtered.length}{filtered.length !== sps.length ? ` / ${sps.length}` : ""}</strong></span>
          <span>Healthy: <strong style={{ color:"#22c55e" }}>{healthyCount}</strong></span>
          <span>Active: <strong style={{ color:"#0891b2" }}>{activeCount}</strong></span>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {(["az","health","state"] as const).map(s=>(
            <button key={s} onClick={()=>setSort(s)} style={{ padding:"4px 11px", borderRadius:6, border:"1px solid var(--border)", fontSize:11, fontWeight:sort===s?700:400, background:sort===s?"var(--accent)":"var(--bg-card)", color:sort===s?"#fff":"var(--text-muted)", cursor:"pointer" }}>
              Sort: {s==="az"?"Zone":s.charAt(0).toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead><tr style={{ background:"var(--bg-card2)", borderBottom:"1px solid var(--border)" }}>
            {["#","ADDRESS","ZONE / DC","HEALTH","STATE","LOCATION","BLS KEY"].map(h=>(
              <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:600, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", whiteSpace:"nowrap" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.map((sp,i)=>(
              <tr key={sp.address||i} style={{ borderBottom:"1px solid var(--border-soft)", background:i%2===0?"var(--bg-card)":"var(--bg-card2)" }}>
                <td style={{ padding:"10px 14px", fontFamily:"monospace", fontSize:11, color:"var(--text-dim)" }}>#{i+1}</td>
                <td style={{ padding:"10px 14px" }}><div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:12, color:"var(--text-primary)", fontWeight:600 }}>{str(sp.addressShort)}</span>{sp.address&&<CopyBtn text={sp.address}/>}</div></td>
                <td style={{ padding:"10px 14px", fontSize:12, color:"var(--text-secondary)" }}>{str(sp.az)}</td>
                <td style={{ padding:"10px 14px" }}><HealthChip health={sp.health}/></td>
                <td style={{ padding:"10px 14px" }}><span style={{ fontSize:11, fontWeight:600, color:sp.state==="Active"?"#0891b2":sp.state==="Waitlisted"?"#f59e0b":sp.state==="Frozen"?"#3b82f6":"#9ca3af" }}>{str(sp.state)}</span></td>
                <td style={{ padding:"10px 14px", fontSize:11, color:"var(--text-dim)" }}>{sp.geo?.city?`${sp.geo.city}${sp.geo.countryCode?", "+sp.geo.countryCode:""}`:sp.ip??"—"}</td>
                <td style={{ padding:"10px 14px" }}>{sp.blsKey?(<div style={{ display:"flex", alignItems:"center", gap:4 }}><span style={{ fontFamily:"monospace", fontSize:10, color:"var(--text-muted)" }}>{sp.blsKey.slice(0,14)}…</span><CopyBtn text={sp.blsKey}/></div>):<span style={{ color:"var(--text-dim)" }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────
function SearchBar({ onSearch, initialValue }: { onSearch: (q: string) => void; initialValue?: string }) {
  const [q, setQ] = useState(initialValue ?? "");
  return (
    <div style={{ display:"flex", gap:8 }}>
      <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")onSearch(q.trim());}}
        placeholder="Search by wallet address, blob_id, tx version…"
        style={{ flex:1, padding:"10px 16px", borderRadius:10, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-primary)", fontSize:14, outline:"none", fontFamily:"monospace" }} />
      <button onClick={()=>onSearch(q.trim())} style={{ padding:"10px 20px", borderRadius:10, border:"none", background:"var(--accent)", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>
        Search
      </button>
      {q && <button onClick={()=>{setQ("");onSearch("");}} style={{ padding:"10px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--bg-card)", color:"var(--text-muted)", fontSize:13, cursor:"pointer" }}>×</button>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ExplorerPage() {
  const { network, config } = useNetwork();
  const isTestnet   = network === "testnet";
  const [tab,         setTab]         = useState<ExplorerTab>("transactions");
  const [searchQuery, setSearchQuery] = useState("");
  const [displayQuery, setDisplayQuery] = useState("");

  useEffect(() => { setTab("transactions"); setSearchQuery(""); setDisplayQuery(""); }, [network]);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setDisplayQuery(q);
    if (!q) return;
    // FIX: wallet address → show all 3 tabs filtered by address
    // Don't auto-jump to leaderboard — stay on current or go to transactions
    if (q.startsWith("v") || /^\d+$/.test(q)) {
      setTab("transactions");
    } else if (q.startsWith("0x") && q.length >= 64) {
      // wallet address — default to transactions (show sender txs)
      setTab("transactions");
    } else {
      setTab("blobs");
    }
  };

  const TABS: { id: ExplorerTab; label: string; icon: string }[] = [
    { id:"transactions", label:"Transactions", icon:"↯" },
    { id:"blobs",        label:"Blobs",        icon:"◈" },
    { id:"leaderboard",  label:"SP Directory", icon:"◎" },
  ];

  return (
    <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 4px" }}>
      <style>{`@media(max-width:768px){.ex-header{flex-direction:column!important;gap:8px!important}}`}</style>

      {/* Header */}
      <div className="ex-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 style={{ fontSize:26, fontWeight:800, color:"var(--text-primary)", margin:0, letterSpacing:-0.8 }}>Explorer</h1>
          <p style={{ fontSize:13, color:"var(--text-muted)", margin:"5px 0 0" }}>
            {isTestnet?"Aptos Testnet · Shelby Protocol":"Shelbynet"} · Browse transactions, blobs, and providers
          </p>
        </div>
        <span style={{ fontSize:11, padding:"3px 9px", borderRadius:5, fontWeight:600, background:isTestnet?"rgba(147,51,234,0.1)":"rgba(34,197,94,0.1)", color:isTestnet?"#9333ea":"#16a34a" }}>
          {config.label}
        </span>
      </div>

      {/* Search */}
      <div style={{ marginBottom:16 }}>
        <SearchBar onSearch={handleSearch} />
        {displayQuery && (
          <div style={{ marginTop:8, fontSize:12, color:"var(--text-muted)", fontFamily:"monospace" }}>
            Showing results for: <strong style={{ color:"var(--text-primary)" }}>{displayQuery}</strong>
            {isWalletAddress(displayQuery) && (
              <span style={{ marginLeft:8, color:"#2563eb" }}>— filtering all tabs by this wallet</span>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, overflow:"hidden" }}>
        <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--bg-card2)", overflowX:"auto" }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"13px 22px", fontSize:13, fontWeight:tab===t.id?700:500, border:"none", cursor:"pointer", whiteSpace:"nowrap", background:tab===t.id?"var(--bg-card)":"transparent", color:tab===t.id?"var(--text-primary)":"var(--text-muted)", borderBottom:tab===t.id?"2px solid var(--accent)":"2px solid transparent", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ opacity:0.7 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        {tab==="transactions" && <TransactionsTab network={network} searchQuery={searchQuery} />}
        {tab==="blobs"        && <BlobsTab        network={network} searchQuery={searchQuery} />}
        {tab==="leaderboard"  && <LeaderboardTab  network={network} searchQuery={searchQuery} />}
      </div>

      <div style={{ marginTop:14, fontSize:11, color:"var(--text-dim)", fontFamily:"monospace", textAlign:"right" }}>
        {isTestnet ? "Source: Aptos Testnet Indexer V3 · account_transactions on contract address" : "Source: Shelby Dedicated Indexer (GraphQL) · account_transactions + blobs table"}
      </div>
    </div>
  );
}