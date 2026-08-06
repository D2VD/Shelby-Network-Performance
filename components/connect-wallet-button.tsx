// components/connect-wallet-button.tsx
"use client";

import { useState } from "react";
import { useWalletSession } from "@/lib/use-wallet-session";

export function ConnectWalletButton() {
  const { walletConnected, walletAddress, isVerified, verifying, error, connect, verify, disconnect, wallets } = useWalletSession();
  const [showPicker, setShowPicker] = useState(false);

  // FIX (bug #3, wallet-verify handoff): AptosConnect auto-registers
  // social-login "wallets" (e.g. name === "Continue with Google") alongside
  // real self-custody wallets — confirmed naming convention per Petra's own
  // docs (signIn({ walletName: "Continue with Google" })) and the Aptos
  // Connect docs. These are excluded here because the backend's
  // POST /wallet/verify assumes a standard Ed25519 self-custody account
  // (pubKeyObj.authKey().derivedAddress()), which does not necessarily hold
  // for a social-login/MPC-custodial account. Filtering by name rather than
  // an internal type/standard field since that field's presence on this
  // hook's wallet objects hasn't been confirmed — name is the one signal
  // documented and guaranteed stable across the SDK.
  // NOTE: a more robust upstream fix is passing optInWallets to
  // AptosWalletAdapterProvider (wherever it's configured) so these never
  // register in the first place — this filter is a defensive backstop here,
  // not a replacement for that.
  const isSocialLoginWallet = (name: string) => name.toLowerCase().startsWith("continue with");
  const selfCustodyWallets = wallets?.filter((w: any) => !isSocialLoginWallet(w.name));

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
    <div style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setShowPicker(v => !v)} className="btn btn-primary" style={{ fontSize: 12 }}>
        ◎ Connect wallet
      </button>
      {showPicker && (
        <div style={{ position: "absolute", top: "110%", right: 0, background: "#fff", border: "1px solid var(--gray-200)", borderRadius: 8, padding: 6, zIndex: 20, minWidth: 190, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
          {selfCustodyWallets?.map((w: any) => (
            <button
              key={w.name}
              onClick={() => { connect(w.name); setShowPicker(false); }}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 6, fontSize: 14, fontWeight: 500, textAlign: "left" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {w.icon && <img src={w.icon} alt="" width={22} height={22} />}
              {w.name}
            </button>
          ))}
          {(!selfCustodyWallets || selfCustodyWallets.length === 0) && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--gray-400)" }}>No wallets detected — install Petra or another Aptos wallet extension</div>
          )}
        </div>
      )}
    </div>
  );
}