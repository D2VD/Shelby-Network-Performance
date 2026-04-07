"use client";
// components/map-wrapper.tsx — v3.0
// Strategy: dùng GlobeEngine (globe-gl CDN) cho providers page
// ProviderMap (pure SVG) vẫn được dùng ở providers page với full feature set
// NOTE: react-simple-maps không tương thích CF Pages edge runtime → keep pure SVG
// Nếu muốn thử react-simple-maps trong tương lai: dynamic import + ssr:false đây

import { useNetwork } from "./network-context";
import GlobeEngine from "./globe-engine";
import type { StorageProvider } from "@/lib/types";

interface MapWrapperProps {
  providers: StorageProvider[];
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