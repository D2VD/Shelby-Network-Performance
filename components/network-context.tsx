"use client";
// components/network-context.tsx
// FIX: Tách SearchParamsReader thành component riêng để Next.js 15 không yêu cầu
// Suspense boundary ở từng page — chỉ cần 1 Suspense ở layout là đủ.

import React, {
  createContext, useContext, useState, useEffect,
  useCallback, type ReactNode, Suspense
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type NetworkId = "shelbynet" | "testnet";

export interface NetworkConfig {
  id:         NetworkId;
  label:      string;
  color:      string;
}

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  shelbynet: { id: "shelbynet", label: "Shelbynet", color: "#2563eb" },
  testnet:   { id: "testnet",   label: "Testnet",   color: "#9333ea" },
};

interface Ctx {
  network:    NetworkId;
  config:     NetworkConfig;
  setNetwork: (id: NetworkId) => void;
}

const NetworkContext = createContext<Ctx>({
  network: "shelbynet",
  config:  NETWORKS.shelbynet,
  setNetwork: () => {},
});

// ── Inner component: đọc searchParams (cần Suspense ở trên) ──────────────────
function NetworkParamsReader({ onNetwork }: { onNetwork: (n: NetworkId) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const p = searchParams?.get("network");
    onNetwork(p === "testnet" ? "testnet" : "shelbynet");
  }, [searchParams, onNetwork]);
  return null;
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function NetworkProvider({ children }: { children: ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  // Khởi tạo từ URL hiện tại (client-side)
  const [network, setNetworkState] = useState<NetworkId>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("network");
      if (p === "testnet") return "testnet";
    }
    return "shelbynet";
  });

  // Sync data-network attribute cho CSS vars
  useEffect(() => {
    document.documentElement.setAttribute("data-network", network);
  }, [network]);

  const handleNetworkFromParams = useCallback((n: NetworkId) => {
    setNetworkState(n);
  }, []);

  const setNetwork = useCallback((id: NetworkId) => {
    setNetworkState(id);
    const params = new URLSearchParams(window.location.search);
    if (id === "shelbynet") params.delete("network");
    else params.set("network", id);
    const next = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(next, { scroll: false });
  }, [pathname, router]);

  return (
    <NetworkContext.Provider value={{ network, config: NETWORKS[network], setNetwork }}>
      {/* Suspense wrap quanh SearchParamsReader — không lan ra các pages khác */}
      <Suspense fallback={null}>
        <NetworkParamsReader onNetwork={handleNetworkFromParams} />
      </Suspense>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}