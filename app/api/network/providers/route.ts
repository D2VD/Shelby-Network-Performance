// app/api/network/providers/route.ts — v4.0
//
// Per guide Step 3 + 4:
//   Tier 1: Epoch registry scan → list of operator wallet addresses
//   Tier 2: Per-operator metadata fetch → BLS key, IP, data_center (AZ)
//
// Two separate API keys:
//   SHELBY_API_KEY         → shelbynet
//   SHELBY_TESTNET_API_KEY → testnet
//
// VPS fallback for providers (optional) if direct fetch fails.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const CONFIGS = {
  shelbynet: {
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_API_KEY",
  },
  testnet: {
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    apiKeyEnv:   "SHELBY_TESTNET_API_KEY",
  },
} as const;
type NetworkId = keyof typeof CONFIGS;

// Zone → geo mapping for fallback location display
const ZONE_GEO: Record<string, { lat: number; lng: number; city: string; countryCode: string }> = {
  dc_asia:      { lat:   1.35, lng: 103.82, city: "Singapore", countryCode: "SG" },
  dc_australia: { lat: -33.87, lng: 151.21, city: "Sydney",    countryCode: "AU" },
  dc_europe:    { lat:  50.11, lng:   8.68, city: "Frankfurt", countryCode: "DE" },
  dc_us_east:   { lat:  39.04, lng: -77.44, city: "Virginia",  countryCode: "US" },
  dc_us_west:   { lat:  37.34, lng:-121.89, city: "San Jose",  countryCode: "US" },
};
const AZ_LABEL: Record<string, string> = {
  dc_asia:      "Asia (Singapore)",
  dc_australia: "Australia (Sydney)",
  dc_europe:    "Europe (Frankfurt)",
  dc_us_east:   "US East (Virginia)",
  dc_us_west:   "US West (San Jose)",
};

function nb(v: unknown, fb = 0): number { const x = Number(v ?? fb); return isNaN(x) ? fb : x; }

function apiHeaders(network: NetworkId): Record<string, string> {
  const key = process.env[CONFIGS[network].apiKeyEnv] ?? "";
  return key ? { "Authorization": `Bearer ${key}` } : {};
}

type BTreeEntry = { key: string; value: Record<string, unknown> };
function extractBTreeEntries(map: unknown): BTreeEntry[] {
  if (!map || typeof map !== "object") return [];
  const m = map as Record<string, unknown>;
  const viaRoot = ((m.root as Record<string, unknown>)?.children as Record<string, unknown>)?.entries;
  if (Array.isArray(viaRoot)) return viaRoot as BTreeEntry[];
  if (Array.isArray(m.entries)) return m.entries as BTreeEntry[];
  if (Array.isArray(m.data))    return m.data    as BTreeEntry[];
  return [];
}

// ─── Tier 1: Get operator addresses from epoch registry ───────────────────────
async function getOperatorAddresses(network: NetworkId): Promise<{
  active: string[];
  waitlisted: string[];
  fromZoneRegistry: boolean;
}> {
  const cfg  = CONFIGS[network];
  const core = cfg.coreAddress;
  const hdrs = apiHeaders(network);

  // Try epoch::Epoch first (per guide)
  try {
    const r = await fetch(
      `${cfg.nodeUrl}/accounts/${core}/resource/${core}::epoch::Epoch`,
      { headers: hdrs, signal: AbortSignal.timeout(8_000) }
    );
    if (r.ok) {
      const d    = await r.json() as Record<string, unknown>;
      const data = (d.data ?? d) as Record<string, unknown>;
      const active     = extractBTreeEntries(data.active_providers     ?? data.active_operators);
      const waitlisted = extractBTreeEntries(data.waitlisted_providers  ?? data.waitlisted_operators);
      return {
        active:           active.map((e: BTreeEntry) => String(e.key ?? "")).filter(Boolean),
        waitlisted:       waitlisted.map((e: BTreeEntry) => String(e.key ?? "")).filter(Boolean),
        fromZoneRegistry: false,
      };
    }
  } catch { /* fallthrough */ }

  // Fallback: StorageProviders by-zone registry
  // This gives us addresses grouped by zone (dc_asia, dc_europe, etc.)
  try {
    const r = await fetch(
      `${cfg.nodeUrl}/accounts/${core}/resource/${core}::storage_provider_registry::StorageProviders`,
      { headers: hdrs, signal: AbortSignal.timeout(8_000) }
    );
    if (r.ok) {
      const d     = await r.json() as Record<string, unknown>;
      const data  = (d.data ?? d) as Record<string, unknown>;
      const zones = extractBTreeEntries(data.active_providers_by_az ?? data.active_providers);
      const active: string[] = [];
      zones.forEach(z => {
        const spArr = (z.value as Record<string, unknown>)?.value;
        if (Array.isArray(spArr)) {
          spArr.forEach((sp: unknown) => {
            const addr = String((sp as Record<string, unknown>).addr ?? (sp as Record<string, unknown>).address ?? "");
            if (addr) active.push(addr);
          });
        }
      });
      return { active, waitlisted: [], fromZoneRegistry: true };
    }
  } catch { /* silent */ }

  return { active: [], waitlisted: [], fromZoneRegistry: false };
}

// ─── Tier 2: Fetch metadata for one operator ──────────────────────────────────
// Per guide Step 4: GET /accounts/{sp_addr}/resources → storage_provider::StorageProvider
// Contains: bls_public_key.bytes, ip_address, availability_zone.vec[0].data_center
type SpMeta = {
  blsKey:           string;
  ipAddress:        string | null;
  availabilityZone: string;
  locationName:     string;
  capacityBytes:    number | null;
  netAddress:       string | null;
  state:            string;
};

async function fetchSpMetadata(operatorAddr: string, network: NetworkId): Promise<SpMeta | null> {
  const cfg  = CONFIGS[network];
  const core = cfg.coreAddress;
  const hdrs = apiHeaders(network);

  const candidates = [
    `${core}::storage_provider::StorageProvider`,
    `${core}::provider::StorageProvider`,
    `${core}::sp::StorageProvider`,
  ];

  for (const type of candidates) {
    try {
      const r = await fetch(
        `${cfg.nodeUrl}/accounts/${operatorAddr}/resource/${type}`,
        { headers: hdrs, signal: AbortSignal.timeout(5_000) }
      );
      if (r.ok) {
        const d    = await r.json() as Record<string, unknown>;
        const data = (d.data ?? d) as Record<string, unknown>;

        // Extract BLS key (may be { bytes: "0x..." } or direct hex string)
        const blsRaw = data.bls_public_key;
        const blsKey = typeof blsRaw === "object" && blsRaw !== null
          ? String((blsRaw as Record<string, unknown>).bytes ?? "")
          : String(blsRaw ?? "");

        // Extract availability zone
        let az = "unknown";
        const azRaw = data.availability_zone;
        if (typeof azRaw === "string") {
          az = azRaw;
        } else if (azRaw && typeof azRaw === "object") {
          const vecArr = (azRaw as Record<string, unknown>).vec as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(vecArr) && vecArr[0]?.data_center) {
            az = String(vecArr[0].data_center);
          }
        }

        // State
        let state = "Active";
        if (typeof data.state === "number") {
          state = data.state === 0 ? "Active" : data.state === 1 ? "Waitlisted" : data.state === 2 ? "Frozen" : "Unknown";
        } else if (typeof data.state === "string" && data.state) {
          state = data.state;
        }

        const capacityBytes = data.capacity_bytes != null ? nb(data.capacity_bytes) : null;

        return {
          blsKey,
          ipAddress:        data.ip_address  ? String(data.ip_address)  : null,
          availabilityZone: az,
          locationName:     AZ_LABEL[az] ?? az,
          capacityBytes,
          netAddress:       data.net_address ? String(data.net_address) : null,
          state,
        };
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

// Build full provider object from address + metadata
function buildProvider(
  address: string,
  meta: SpMeta | null,
  defaultState: "Active" | "Waitlisted",
  idx: number
) {
  const addressShort = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : `SP-${idx}`;
  const az           = meta?.availabilityZone ?? "unknown";
  const geoBase      = ZONE_GEO[az] ?? null;

  return {
    address,
    addressShort,
    availabilityZone: az,
    locationName:     AZ_LABEL[az] ?? "Unknown",
    state:            meta?.state ?? defaultState,
    health:           "Unknown" as const, // TCP check done at VPS level
    blsKey:           meta?.blsKey ?? "",
    fullBlsKey:       meta?.blsKey ?? "",
    ipAddress:        meta?.ipAddress ?? null,
    netAddress:       meta?.netAddress ?? null,
    capacityBytes:    meta?.capacityBytes ?? null,
    capacityTiB:      meta?.capacityBytes ? meta.capacityBytes / (1024 ** 4) : null,
    tcpChecked:       false,
    geo:              geoBase ? { ...geoBase, source: "zone-fallback" } : null,
  };
}

export async function GET(req: NextRequest) {
  const network   = (req.nextUrl.searchParams.get("network") ?? "shelbynet") as NetworkId;
  const fetchMeta = req.nextUrl.searchParams.get("meta") !== "0"; // ?meta=0 to skip tier 2

  if (network !== "shelbynet" && network !== "testnet") {
    return NextResponse.json({ ok: false, error: "Invalid network" }, { status: 400 });
  }

  // Tier 1: get operator addresses
  const { active, waitlisted } = await getOperatorAddresses(network);

  if (active.length === 0 && waitlisted.length === 0) {
    // Try VPS fallback
    const vpsUrl = process.env.SHELBY_API_URL ?? "";
    if (vpsUrl) {
      try {
        const r = await fetch(`${vpsUrl}/api/geo-sync/providers?network=${network}`, {
          signal: AbortSignal.timeout(8_000),
        });
        if (r.ok) {
          const d = await r.json() as Record<string, unknown>;
          return NextResponse.json({ ...d, source: "vps-fallback" }, {
            headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
          });
        }
      } catch { /* VPS also down */ }
    }
    return NextResponse.json({
      ok: true, network, source: "no-data",
      data: { providers: [], count: 0 },
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "public, max-age=30" } });
  }

  // Tier 2: fetch metadata for each operator (per guide step 4)
  // Limit concurrency to avoid rate limiting
  const BATCH = 5;
  const providers: ReturnType<typeof buildProvider>[] = [];

  const allOperators = [
    ...active.map(a => ({ addr: a, state: "Active" as const })),
    ...waitlisted.map(w => ({ addr: w, state: "Waitlisted" as const })),
  ];

  if (fetchMeta) {
    for (let i = 0; i < allOperators.length; i += BATCH) {
      const batch   = allOperators.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(({ addr }) => fetchSpMetadata(addr, network))
      );
      results.forEach((result, j) => {
        const { addr, state } = batch[j];
        const meta = result.status === "fulfilled" ? result.value : null;
        providers.push(buildProvider(addr, meta, state, i + j));
      });
    }
  } else {
    // Quick mode: no tier 2, just build from addresses
    allOperators.forEach(({ addr, state }, i) => {
      providers.push(buildProvider(addr, null, state, i));
    });
  }

  return NextResponse.json({
    ok: true, network,
    source: fetchMeta ? "node-rest-2tier" : "node-rest-tier1-only",
    data: { providers, count: providers.length },
    fetchedAt: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}