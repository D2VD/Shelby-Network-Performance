"use client";
// components/network-context.tsx v3
import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type NetworkId = "shelbynet" | "testnet";

export interface NetworkConfig {
  id:         NetworkId;
  label:      string;
  shortLabel: string;
  color:      string;
  apiParam:   string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  shelbynet: { id: "shelbynet", label: "Shelbynet", shortLabel: "SBN", color: "#2563eb", apiParam: "shelbynet" },
  testnet:   { id: "testnet",   label: "Testnet",   shortLabel: "TST", color: "#9333ea", apiParam: "testnet"   },
};

interface Ctx { network: NetworkId; config: NetworkConfig; setNetwork: (id: NetworkId) => void; }

const NetworkContext = createContext<Ctx>({ network: "shelbynet", config: NETWORKS.shelbynet, setNetwork: () => {} });

export function NetworkProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const [network, setNetworkState] = useState<NetworkId>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("network");
      if (p === "testnet") return "testnet";
    }
    return "shelbynet";
  });

  useEffect(() => {
    const p = searchParams?.get("network");
    if (p === "testnet" && network !== "testnet") setNetworkState("testnet");
    else if (p !== "testnet" && network !== "shelbynet") setNetworkState("shelbynet");
  }, [searchParams]);

  useEffect(() => {
    document.documentElement.setAttribute("data-network", network);
  }, [network]);

  const setNetwork = useCallback((id: NetworkId) => {
    setNetworkState(id);
    const params = new URLSearchParams(window.location.search);
    if (id === "shelbynet") params.delete("network"); else params.set("network", id);
    const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(next, { scroll: false });
  }, [pathname, router]);

  return (
    <NetworkContext.Provider value={{ network, config: NETWORKS[network], setNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() { return useContext(NetworkContext); }