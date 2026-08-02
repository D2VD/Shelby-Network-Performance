// components/benchmark-wallet-provider.tsx
"use client";
// Scoped to the benchmark page only (wraps BenchmarkPage's default export
// below) rather than added to the global app layout — this is a self-
// contained addition that doesn't touch the rest of the site's provider
// tree, which I haven't seen and don't want to risk breaking blind.
//
// FIX: the installed @aptos-labs/wallet-adapter-react version doesn't accept
// a `plugins` prop (TS2322 — that's an older-API pattern). Wallets that
// implement the AIP-62 standard, including current Petra, register
// themselves automatically without manual instantiation — so there's
// nothing to pass in for the common case. If a specific non-standard wallet
// ever needs explicit opt-in on this installed version, check whatever prop
// this version actually exposes for that (e.g. an `optInWallets: string[]`
// of wallet names) rather than re-adding a `plugins` array of instances.

import { PropsWithChildren } from "react";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";

export function BenchmarkWalletProvider({ children }: PropsWithChildren) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      onError={(error) => {
        console.error("[wallet]", error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}