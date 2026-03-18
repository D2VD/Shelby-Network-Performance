"use client";
// components/map-wrapper.tsx — v2.0
// ─ Drop-in replacement cho Mapbox version cũ
// ─ Dùng GlobeEngine (Canvas + dot-matrix) thay vì Mapbox
// ─ Giữ nguyên interface props để không cần đổi code ở providers page
// ─ Network color từ CSS variable (tự động cyan/purple khi switch)

import { useNetwork } from "./network-context";
import GlobeEngine from "./globe-engine";
import type { StorageProvider } from "@/lib/types";

interface MapWrapperProps {
  providers: StorageProvider[];
  /** Kept for API compat — không dùng nữa (không có hexagon layer) */
  showArcs?: boolean;
  hexagonOpacity?: number;
  pitch?: number;
  onProviderClick?: (provider: StorageProvider) => void;
}

export default function MapWrapper({
  providers,
  onProviderClick,
}: MapWrapperProps) {
  const { network, config } = useNetwork();

  return (
    <GlobeEngine
      providers={providers}
      network={network}
      accentColor={config.color}
      onProviderClick={onProviderClick}
    />
  );
}