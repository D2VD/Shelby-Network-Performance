"use client";
// components/provider-map.tsx — v12.0
// Fix: WorldMapInner v8 requires isDark prop — pass it from useTheme()

import dynamic from "next/dynamic";
import type { StorageProvider } from "@/lib/types";
import { useTheme } from "./theme-context";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

const WorldMapInner = dynamic(
  () => import("./world-map-inner"),
  {
    ssr: false,
    loading: () => (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg-primary)", flexDirection: "column", gap: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "2px solid var(--border)", borderTopColor: "var(--accent)",
          animation: "spin 1s linear infinite",
        }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading map…</span>
      </div>
    ),
  }
);

export function ProviderMap({ providers, onProviderClick }: ProviderMapProps) {
  const { isDark } = useTheme();

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <WorldMapInner
        providers={providers}
        isDark={isDark}
        onProviderClick={onProviderClick}
      />
    </div>
  );
}
