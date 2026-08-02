// components/connect-wallet-button.tsx
"use client";

import { useState } from "react";
import { useWalletSession } from "@/lib/use-wallet-session";

export function ConnectWalletButton() {
  const { walletConnected, walletAddress, isVerified, verifying, error, connect, verify, disconnect, wallets } = useWalletSession();
  const [showPicker, setShowPicker] = useState(false);

  if (walletConnected && isVerified) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "3px 8px" }}>
          ✓ {walletAddress?.slice(0, 6)}…{walletAddress?.slice(-4)}
        </span>
        <button onClick={disconnect} className="btn btn-secondary" style={{ fontSize: 11 }}>Disconnect</button>
      </div>
    );
  }

  if (walletConnected && !isVerified) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={verify} disabled={verifying} className="btn btn-primary" style={{ fontSize: 12 }}>
          {verifying ? "Verifying…" : "Sign to verify"}
        </button>
        <button onClick={disconnect} className="btn btn-secondary" style={{ fontSize: 11 }}>Cancel</button>
        {error && <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setShowPicker(v => !v)} className="btn btn-primary" style={{ fontSize: 12 }}>
        ◎ Connect wallet
      </button>
      {showPicker && (
        <div style={{ position: "absolute", top: "110%", right: 0, background: "#fff", border: "1px solid var(--gray-200)", borderRadius: 8, padding: 6, zIndex: 20, minWidth: 170, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
          {wallets?.map((w: any) => (
            <button
              key={w.name}
              onClick={() => { connect(w.name); setShowPicker(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 6, fontSize: 13, textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {w.icon && <img src={w.icon} alt="" width={18} height={18} />}
              {w.name}
            </button>
          ))}
          {(!wallets || wallets.length === 0) && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--gray-400)" }}>No wallets detected — install Petra or another Aptos wallet extension</div>
          )}
        </div>
      )}
    </div>
  );
}