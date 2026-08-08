// components/benchmark-wallet-provider.tsx
"use client";
// Scoped to the benchmark page only (wraps BenchmarkPage's default export
// below) rather than added to the global app layout — this is a self-
// contained addition that doesn't touch the rest of the site's provider
// tree, which I haven't seen and don't want to risk breaking blind.
//
// FIX 2026-08-XX: the installed @aptos-labs/wallet-adapter-react version
// doesn't accept a `plugins` prop (TS2322 — that's an older-API pattern).
// Wallets that implement the AIP-62 standard, including current Petra,
// register themselves automatically without manual instantiation — so
// there's nothing to pass in for the common case.
//
// FIX 2026-08-06: dappConfig was never set at all, which left `network`
// (a REQUIRED field on DappConfig per wallet-adapter-core's own types)
// unconfigured. Confirmed via the actual published source of
// @aptos-labs/wallet-adapter-react/-core that this is what caused the
// browser to call getChainId() against api.mainnet.aptoslabs.com — blocked
// by CSP, but more importantly just wrong: this app only ever targets
// Shelbynet, and Network.SHELBYNET is already confirmed elsewhere in this
// project as a real member of @aptos-labs/ts-sdk's Network enum. Explicitly
// setting it here removes any dependency on whatever the library's
// undocumented fallback network happens to be.

import { PropsWithChildren } from "react";
import { Network } from "@aptos-labs/ts-sdk";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";

export function BenchmarkWalletProvider({ children }: PropsWithChildren) {
  return (
    <AptosWalletAdapterProvider
      autoConnect={true}
      dappConfig={{ network: Network.SHELBYNET }}
      onError={(error) => {
        console.error("[wallet]", error);
      }}
    >
      {children}
    </AptosWalletAdapterProvider>
  );
}