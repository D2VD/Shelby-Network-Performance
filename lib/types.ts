// lib/types.ts — Shared TypeScript types (v2.0 — Phase 3 update)

// ── Network / Node ────────────────────────────────────────────────────────────
export interface NodeInfo {
  blockHeight: number;
  ledgerVersion: number;
  chainId: number;
  nodeVersion?: string;
}

export interface LatencyResult {
  avg: number;
  min: number;
  max: number;
  samples: number[];
}

// ── Geo Location ──────────────────────────────────────────────────────────────
export interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  isp?: string;
  source: "geo-ip" | "zone-fallback" | "manual";
  geocodedAt?: string;
}

// ── Storage Provider ──────────────────────────────────────────────────────────
export type ProviderState  = "Active" | "Waitlisted" | "Frozen" | "Leaving";
export type ProviderHealth = "Healthy" | "Faulty";
export type AvailabilityZone =
  | "dc_asia"
  | "dc_australia"
  | "dc_europe"
  | "dc_us_east"
  | "dc_us_west"
  | string;

export interface StorageProvider {
  address:          string;
  addressShort:     string;
  availabilityZone: AvailabilityZone;
  state:            ProviderState;
  health:           ProviderHealth;
  blsKey:           string;
  fullBlsKey?:      string;
  capacityTiB?:     number;
  usedTiB?:         number;
  coordinates?:     [number, number];
  geo?:             GeoLocation;
  netAddress?:      string;
}

// ── KV Stored Node Record ─────────────────────────────────────────────────────
export interface KVNodeRecord {
  address:          string;
  addressShort:     string;
  availabilityZone: AvailabilityZone;
  state:            ProviderState;
  health:           ProviderHealth;
  blsKey:           string;
  fullBlsKey?:      string;
  capacityTiB?:     number;
  netAddress?:      string;
  geo:              GeoLocation;
  updatedAt:        string;
}

export interface KVProvidersIndex {
  addresses: string[];
  updatedAt: string;
  network:   string;
}

// ── Network Stats ─────────────────────────────────────────────────────────────
export interface NetworkStats {
  totalBlobs:            number | null;
  totalStorageUsedBytes: number | null;
  totalBlobEvents:       number | null;
  slices:                number | null;
  placementGroups:       number | null;
  storageProviders:      number | null;
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
  bytes:    number;
  elapsed:  number;
  speedKbs: number;
  blobName: string;
  txHash:   string | null;
  status?:  string;
}

export interface BlobDownloadResult {
  bytes:    number;
  elapsed:  number;
  speedKbs: number;
}

export interface TxTimeResult {
  submitTime:  number;
  confirmTime: number;
  txHash:      string | null;
}

export interface BenchmarkResult {
  latency:        LatencyResult;
  uploads:        BlobUploadResult[];
  downloads:      BlobDownloadResult[];
  tx:             TxTimeResult;
  avgUploadKbs:   number;
  avgDownloadKbs: number;
  score:          number;
}

// ── Region / Zone metadata ────────────────────────────────────────────────────
export interface RegionSummary {
  zone:      AvailabilityZone;
  label:     string;
  providers: StorageProvider[];
  mapX:      number;
  mapY:      number;
}

export const ZONE_META: Record<string, {
  label:       string;
  shortLabel:  string;
  mapX:        number;
  mapY:        number;
  fallbackLng: number;
  fallbackLat: number;
}> = {
  dc_asia:      { label: "Asia (Singapore)",   shortLabel: "AS",  mapX: 78, mapY: 38, fallbackLng:  103.8198, fallbackLat:   1.3521 },
  dc_australia: { label: "Australia (Sydney)", shortLabel: "AU",  mapX: 82, mapY: 70, fallbackLng:  151.2093, fallbackLat: -33.8688 },
  dc_europe:    { label: "Europe (Frankfurt)", shortLabel: "EU",  mapX: 50, mapY: 28, fallbackLng:    8.6821, fallbackLat:  50.1109 },
  dc_us_east:   { label: "US East (Virginia)", shortLabel: "USE", mapX: 22, mapY: 36, fallbackLng:  -77.4360, fallbackLat:  39.0438 },
  dc_us_west:   { label: "US West (San Jose)", shortLabel: "USW", mapX: 10, mapY: 36, fallbackLng: -121.8863, fallbackLat:  37.3382 },
};