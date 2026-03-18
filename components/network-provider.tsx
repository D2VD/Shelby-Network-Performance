// components/network-provider.tsx
"use client";
import { createContext, useContext, useState, ReactNode, useEffect } from "react";

export type NetworkType = "shelbynet" | "testnet";

interface NetworkContextType {
  network: NetworkType;
  setNetwork: (net: NetworkType) => void;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkType>("shelbynet");

  // Tùy chọn: Lưu trạng thái mạng vào localStorage để giữ nguyên khi user F5
  useEffect(() => {
    const saved = localStorage.getItem("shelby_network") as NetworkType;
    if (saved === "shelbynet" || saved === "testnet") setNetwork(saved);
  },[]);

  const handleSetNetwork = (net: NetworkType) => {
    setNetwork(net);
    localStorage.setItem("shelby_network", net);
  };

  return (
    <NetworkContext.Provider value={{ network, setNetwork: handleSetNetwork }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) throw new Error("useNetwork must be used within a NetworkProvider");
  return context;
}