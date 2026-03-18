"use client";
// app/dashboard/page.tsx v3 · Light theme

import { useNetwork } from "@/components/network-context";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json());

const fmt = (v: number|null) => { if(v==null) return "—"; if(v>=1e6) return `${(v/1e6).toFixed(2)}M`; if(v>=1e3) return `${(v/1e3).toFixed(1)}K`; return String(v); };
const fmtBytes = (b: number|null) => { if(b==null) return "—"; if(b>=1e12) return `${(b/1e12).toFixed(2)} TB`; if(b>=1e9) return `${(b/1e9).toFixed(1)} GB`; if(b>=1e6) return `${(b/1e6).toFixed(1)} MB`; return `${b} B`; };

const CARDS = [
  { key:"totalBlobs",            label:"Total Blobs",        sub:"Files stored",          color:"#2563eb", fmt:fmt       },
  { key:"totalStorageUsedBytes", label:"Storage Used",       sub:"Total capacity",         color:"#16a34a", fmt:fmtBytes  },
  { key:"totalBlobEvents",       label:"Blob Events",        sub:"On-chain transactions",  color:"#9333ea", fmt:fmt       },
  { key:"slices",                label:"Total Slices",       sub:"Erasure-coded chunks",   color:"#d97706", fmt:fmt       },
  { key:"placementGroups",       label:"Placement Groups",   sub:"Active PGs (16 SPs)",    color:"#f97316", fmt:fmt       },
  { key:"storageProviders",      label:"Storage Providers",  sub:"Active Cavalier nodes",  color:"#16a34a", fmt:fmt       },
] as const;

export default function DashboardPage() {
  const { network, config } = useNetwork();
  const { data, error, isLoading, mutate } = useSWR(
    `/api/network/stats?network=${network}`, fetcher,
    { refreshInterval: 15_000, dedupingInterval: 10_000 }
  );
  const stats = data?.data?.stats;
  const node  = data?.data?.node;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
        <div>
          <h1 className="page-title">Network Analytics</h1>
          <p className="page-subtitle">
            Real-time metrics for <strong>{config.label}</strong> · auto-refreshes every 15s
          </p>
        </div>
        <button onClick={() => mutate()} disabled={isLoading} className="btn btn-secondary">
          {isLoading ? "⟳ Syncing…" : "⟳ Sync Now"}
        </button>
      </div>

      {/* Alerts */}
      {error && <div className="alert alert-error" style={{ marginBottom:16 }}>Failed to load analytics data — {error?.message}</div>}
      {data?.data?.errors?.stats && <div className="alert alert-warning" style={{ marginBottom:16 }}>{data.data.errors.stats}</div>}

      {/* Node info bar */}
      {node && (
        <div className="card" style={{ marginBottom:20 }}>
          <div className="card-body" style={{ padding:"12px 20px", display:"flex", alignItems:"center", gap:24, flexWrap:"wrap" }}>
            {[
              { label:"Block Height",   value:`#${node.blockHeight.toLocaleString()}` },
              { label:"Ledger Version", value:node.ledgerVersion.toLocaleString() },
              { label:"Chain ID",       value:String(node.chainId) },
              { label:"Network",        value:config.label },
            ].map(({ label, value }) => (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:11, color:"var(--gray-400)", textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:600 }}>{label}</span>
                <span style={{ fontFamily:"var(--font-mono)", fontSize:13, color:"var(--gray-700)", fontWeight:500 }}>{value}</span>
              </div>
            ))}
            <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#16a34a", display:"inline-block", boxShadow:"0 0 0 2px #dcfce7" }} />
              <span style={{ fontSize:12, color:"var(--gray-500)" }}>Live</span>
            </div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="stat-grid">
        {CARDS.map(card => {
          const raw = stats?.[card.key as keyof typeof stats];
          const value = isLoading && raw == null ? "…" : card.fmt(raw as any);
          return (
            <div className="stat-card" key={card.key} style={{ borderTop:`3px solid ${card.color}` }}>
              <div className="stat-card-label">{card.label}</div>
              <div className="stat-card-value" style={{ color: value === "…" ? "var(--gray-300)" : undefined }}>{value}</div>
              <div className="stat-card-sub">{card.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Clay Code info */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Clay Erasure Coding Scheme</div>
            <div className="card-subtitle">How Shelby stores data across 16 Storage Providers</div>
          </div>
        </div>
        <div className="card-body">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:16 }}>
            {[
              { label:"Chunkset size",   value:"10 MB" },
              { label:"Chunks / set",    value:"16 total" },
              { label:"Data chunks",     value:"10 (original)" },
              { label:"Parity chunks",   value:"6 (recovery)" },
              { label:"Min to recover",  value:"Any 10 of 16" },
              { label:"Max node failures", value:"6 simultaneous" },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding:"14px 0", borderBottom:"1px solid var(--gray-100)" }}>
                <div style={{ fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", color:"var(--gray-400)", marginBottom:4 }}>{label}</div>
                <div style={{ fontFamily:"var(--font-mono)", fontSize:15, fontWeight:500, color:"var(--gray-800)" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}