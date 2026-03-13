// lib/types.ts — Shared TypeScript types across the app

// ── Network / Node ────────────────────────────────────────────────────────────
export interface NodeInfo {
  blockHeight: number;
  ledgerVersion: number;
  chainId: number;
  nodeVersion: string;
}

export interface LatencyResult {
  avg: number;
  min: number;
  max: number;
  samples: number[];
}

// ── Storage Provider ──────────────────────────────────────────────────────────
export type ProviderState  = "Active" | "Waitlisted" | "Frozen" | "Leaving";
export type ProviderHealth = "Healthy" | "Faulty";
export type AvailabilityZone = "dc_asia" | "dc_australia" | "dc_europe" | "dc_us_east" | "dc_us_west" | string;

export interface StorageProvider {
  address: string;         // full on-chain address
  addressShort: string;   // truncated for display
  availabilityZone: AvailabilityZone;
  state: ProviderState;
  health: ProviderHealth;
  blsKey: string;         // BLS public key (truncated)
  // Extended fields (may not be available from API)
  capacityTiB?: number;
  usedTiB?: number;
}

// ── Network Stats (from RPC) ──────────────────────────────────────────────────
export interface NetworkStats {
  totalBlobs: number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents: number | null;
  slices: number | null;
  placementGroups: number | null;
  storageProviders: number | null;
}

// ── API Response wrappers ─────────────────────────────────────────────────────
export interface ApiOk<T> {
  ok: true;
  data: T;
  fetchedAt: string;
}

export interface ApiErr {
  ok: false;
  error: string;
  fetchedAt: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

// ── Benchmark ─────────────────────────────────────────────────────────────────
export interface BlobUploadResult {
  bytes: number;
  elapsed: number;
  speedKbs: number;
  blobName: string;
  txHash: string | null;
  status?: string;
}

export interface BlobDownloadResult {
  bytes: number;
  elapsed: number;
  speedKbs: number;
}

export interface TxTimeResult {
  submitTime: number;
  confirmTime: number;
  txHash: string | null;
}

export interface BenchmarkResult {
  latency: LatencyResult;
  uploads: BlobUploadResult[];
  downloads: BlobDownloadResult[];
  tx: TxTimeResult;
  avgUploadKbs: number;
  avgDownloadKbs: number;
  score: number;
}

// ── Region map ────────────────────────────────────────────────────────────────
export interface RegionSummary {
  zone: AvailabilityZone;
  label: string;
  providers: StorageProvider[];
  // rough geo coordinates for map rendering
  mapX: number; // 0–100 percentage of map width
  mapY: number; // 0–100 percentage of map height
}

export const ZONE_META: Record<string, { label: string; mapX: number; mapY: number; shortLabel: string }> = {
  dc_asia:       { label: "Asia",        shortLabel: "AS",  mapX: 78, mapY: 38 },
  dc_australia:  { label: "Australia",   shortLabel: "AU",  mapX: 82, mapY: 70 },
  dc_europe:     { label: "Europe",      shortLabel: "EU",  mapX: 50, mapY: 28 },
  dc_us_east:    { label: "US East",     shortLabel: "USE", mapX: 22, mapY: 36 },
  dc_us_west:    { label: "US West",     shortLabel: "USW", mapX: 10, mapY: 36 },
};