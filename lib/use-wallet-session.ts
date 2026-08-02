// lib/use-wallet-session.ts
"use client";
// Wraps @aptos-labs/wallet-adapter-react's useWallet() with the sign-to-verify
// flow against POST /api/benchmark/wallet/verify, and persists the resulting
// session token in localStorage (trust-on-first-use — we don't re-verify the
// signature on every page load, only when the wallet's connected address
// stops matching the stored session's address).
//
// NEEDS A LIVE TEST PASS: the exact shape of useWallet()'s account.publicKey,
// signMessage()'s response, and connect(walletName) has drifted across
// @aptos-labs/wallet-adapter-react versions historically. Written against the
// stable v2+ API, but flagging since this couldn't be tested against a real
// browser wallet extension from this environment.

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

const SESSION_KEY = "shelby_bench_wallet_session_v1";

interface StoredSession { address: string; token: string; }

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch { return null; }
}
function saveStoredSession(s: StoredSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export function useWalletSession() {
  const { account, connected, signMessage, connect, disconnect, wallets } = useWallet();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(loadStoredSession());
  }, []);

  // Drop the stored session if the connected wallet's address no longer
  // matches it (e.g. the user switched accounts inside their extension).
  useEffect(() => {
    if (session && account?.address) {
      const current = account.address.toString().toLowerCase();
      if (session.address !== current) {
        setSession(null);
        saveStoredSession(null);
      }
    }
  }, [account?.address, session]);

  const verify = useCallback(async () => {
    if (!account?.address || !account?.publicKey) {
      setError("No wallet account available");
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const response = await signMessage({
        message: "Verify wallet ownership for Shelby Analytics benchmark history.",
        nonce,
      });

      const address = account.address.toString().toLowerCase();
      const publicKey = account.publicKey.toString();

      const r = await fetch("/api/benchmark/wallet/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          publicKey,
          signature: response.signature.toString(),
          fullMessage: response.fullMessage,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error ?? `HTTP ${r.status}`);

      const newSession: StoredSession = { address: j.address, token: j.token };
      setSession(newSession);
      saveStoredSession(newSession);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setVerifying(false);
    }
  }, [account, signMessage]);

  const disconnectWallet = useCallback(() => {
    setSession(null);
    saveStoredSession(null);
    disconnect();
  }, [disconnect]);

  return {
    walletConnected: connected,
    walletAddress: account?.address?.toString() ?? null,
    verifiedAddress: session?.address ?? null,
    sessionToken: session?.token ?? null,
    isVerified: !!session,
    verifying,
    error,
    connect,
    verify,
    disconnect: disconnectWallet,
    wallets,
  };
}