// app/api/network/providers/route.ts — v3.0
// Lấy Storage Provider data trực tiếp từ on-chain RPC + Indexer
// KHÔNG phụ thuộc vào CF KV hay bất kỳ cache layer nào nữa — data từ source truth
// Cache 60s (SPs không thay đổi thường xuyên)

import { type NextRequest, NextResponse } from "next/server";
import { VPS_API_URL } from "@/app/api/_proxy";

export const runtime = "edge";

const SHELBY_NODE     = "https://api.shelbynet.shelby.xyz/v1";
const SHELBY_INDEXER  = "https://api.shelbynet.shelby.xyz/v1/graphql";
const CORE_ADDRESS    = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

// Approximate lat/lng từ zone name (cho map positioning)
const ZONE_GEO: Record<string, { lat: number; lng: number; city: string; country: string; countryCode: string }> = {
  dc_asia:      { lat:   1.35, lng: 103.82, city: "Singapore",  country: "Singapore",      countryCode: "SG" },
  dc_australia: { lat: -33.87, lng: 151.21, city: "Sydney",     country: "Australia",      countryCode: "AU" },
  dc_europe:    { lat:  50.11, lng:   8.68, city: "Frankfurt",  country: "Germany",         countryCode: "DE" },
  dc_us_east:   { lat:  39.04, lng: -77.44, city: "Virginia",   country: "United States",  countryCode: "US" },
  dc_us_west:   { lat:  37.34, lng:-121.89, city: "San Jose",   country: "United States",  countryCode: "US" },
};

function nb(v: any, fb = 0): number {
  const x = Number(v ?? fb);
  return isNaN(x) ? fb : x;
}

// Fetch SPs từ on-chain resource
// Shelby contract lưu SPs trong storage_provider_registry::StorageProviders
// grouped by availability zone (az_key → [SP entries])
async function fetchStorageProviders(): Promise<any[]> {
  const url = `${SHELBY_NODE}/accounts/${CORE_ADDRESS}/resource/${CORE_ADDRESS}::storage_provider_registry::StorageProviders`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error(`SP registry HTTP ${r.status}`);
  const data = await r.json() as any;

  const providers: any[] = [];

  // Parse active_providers_by_az structure
  // Structure: { data: { active_providers_by_az: { root: { children: { entries: [ { key: "dc_asia", value: { value: [SP...] } } ] } } } } }
  const entries: any[] = data?.data?.active_providers_by_az?.root?.children?.entries ?? [];

  entries.forEach((entry: any) => {
    const zone    = entry.key as string;
    const spArray: any[] = entry.value?.value ?? [];

    spArray.forEach((sp: any, idx: number) => {
      const address = sp.addr ?? sp.address ?? "";
      const geoInfo = ZONE_GEO[zone];

      providers.push({
        address:          address,
        addressShort:     address ? `${address.slice(0, 6)}…${address.slice(-4)}` : `SP-${zone}-${idx}`,
        availabilityZone: zone,
        state:            sp.state ?? "Active",
        health:           sp.health ?? (sp.is_faulty ? "Faulty" : "Healthy"),
        blsKey:           sp.bls_pk ?? sp.bls_key ?? "",
        fullBlsKey:       sp.bls_pk ?? "",
        capacityTiB:      sp.capacity_bytes ? nb(sp.capacity_bytes) / (1024 ** 4) : null,
        netAddress:       sp.net_address ?? null,
        geo: geoInfo ? {
          lat:         geoInfo.lat,
          lng:         geoInfo.lng,
          city:        geoInfo.city,
          country:     geoInfo.country,
          countryCode: geoInfo.countryCode,
          source:      "zone-fallback" as const,
        } : null,
      });
    });
  });

  return providers;
}

// Fallback: query Indexer nếu on-chain resource parse thất bại
async function fetchSPsFromIndexer(): Promise<any[]> {
  const query = `{
    account_transactions(
      where: {
        account_address: { _eq: "${CORE_ADDRESS}" }
      }
      order_by: { transaction_version: desc }
      limit: 1
    ) {
      transaction_version
    }
  }`;

  // Indexer không có direct SP table — chỉ dùng để verify connectivity
  const r = await fetch(SHELBY_INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`Indexer HTTP ${r.status}`);
  return []; // Trả empty, trigger VPS fallback
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") ?? "shelbynet";

  // Testnet: không có data
  if (network === "testnet") {
    return NextResponse.json({
      ok: true,
      network,
      source: "none",
      data: { providers: [], count: 0 },
      fetchedAt: new Date().toISOString(),
    }, {
      headers: { "Cache-Control": "public, max-age=30" },
    });
  }

  // Try 1: On-chain RPC (most accurate)
  try {
    const providers = await fetchStorageProviders();
    if (providers.length > 0) {
      return NextResponse.json({
        ok: true,
        network,
        source: "on-chain-rpc",
        data: { providers, count: providers.length },
        fetchedAt: new Date().toISOString(),
      }, {
        headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
      });
    }
  } catch (e1: any) {
    console.warn("[providers] on-chain RPC failed:", e1.message);
  }

  // Try 2: VPS proxy (VPS có SDK đọc đầy đủ hơn)
  try {
    const res = await fetch(
      `${VPS_API_URL}/api/geo-sync/providers?network=${network}`,
      { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } }
    );
    if (res.ok) {
      const data = await res.json() as any;
      if (data.data?.providers?.length > 0) {
        return NextResponse.json({
          ...data,
          source: "vps-sdk",
          fetchedAt: new Date().toISOString(),
        }, {
          headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
        });
      }
    }
  } catch (e2: any) {
    console.warn("[providers] VPS fallback failed:", e2.message);
  }

  // Fallback: empty response
  return NextResponse.json({
    ok: false,
    network,
    source: "none",
    error: "Unable to fetch provider data",
    data: { providers: [], count: 0 },
    fetchedAt: new Date().toISOString(),
  }, { status: 200 }); // 200 để frontend không crash
}