"use client";
// components/provider-map.tsx — v11.0
// Strategy: react-simple-maps qua dynamic import + ssr:false
// → Tránh hoàn toàn crash CF Pages bundle (không có window/document khi build)
// → Fallback: skeleton loading khi JS chưa load
// → SSR: không render gì (chỉ client-side)

import dynamic from "next/dynamic";
import { useState } from "react";
import type { StorageProvider } from "@/lib/types";

export interface ProviderMapProps {
  providers: StorageProvider[];
  onProviderClick?: (p: StorageProvider) => void;
}

// Dynamic import với ssr: false — react-simple-maps và d3-geo chỉ chạy client
// CF Pages edge runtime không có browser APIs → ssr:false đảm bảo không import khi build
const WorldMapInner = dynamic(
  () => import("./world-map-inner"),
  {
    ssr: false,
    loading: () => (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg-primary)",
        flexDirection: "column", gap: 12,
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

export function ProviderMap({ providers }: ProviderMapProps) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <WorldMapInner providers={providers} />
    </div>
  );
}