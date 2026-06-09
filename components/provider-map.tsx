"use client";
// components/provider-map.tsx — v11.1
// Strategy: react-simple-maps qua dynamic import + ssr:false
// → Tránh hoàn toàn crash CF Pages bundle (không có window/document khi build)
// → Fallback: skeleton loading khi JS chưa load
// → SSR: không render gì (chỉ client-side)

import dynamic from "next/dynamic";
import type { StorageProvider } from "@/lib/types";
import { useTheme } from "./theme-context";

export interface ProviderMapProps {
  providers: StorageProvider[];
  isDark?: boolean; // Thêm thuộc tính để đồng bộ với WorldMapInnerProps
  onProviderClick?: (p: StorageProvider) => void;
}

// Dynamic import với ssr: false — react-simple-maps và d3-geo chỉ chạy client
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

export function ProviderMap({ providers, isDark = false }: ProviderMapProps) {
  // Edge case: Kiểm tra dữ liệu đầu vào trống hoặc không hợp lệ trước khi xử lý logic chính
  if (!providers) {
    return null;
  }

  // Happy path: Truyền đầy đủ các tham số bắt buộc cho component con
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <WorldMapInner providers={providers} isDark={isDark} />
    </div>
  );
}
