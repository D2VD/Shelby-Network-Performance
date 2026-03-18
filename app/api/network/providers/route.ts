// app/api/network/providers/route.ts — v2.0 (Phase 3)
// ─ Priority 1: Cloudflare KV (populated bởi geo-sync Worker)
// ─ Priority 2: Indexer GraphQL trực tiếp (có geo zone-fallback)
// ─ Priority 3: RPC on-chain (có geo zone-fallback)
// ─ Luôn trả về 200 với data.providers = [] nếu mọi nguồn đều fail

import { NextRequest, NextResponse } from "next/server";
import type { StorageProvider, KVNodeRecord } from "@/lib/types";
import { ZONE_META } from "@/lib/types";

export const runtime    = "edge";
export const revalidate = 60;

// ── Network config ────────────────────────────────────────────────────────────
const NETWORK_CONFIG: Record<string, {
  coreAddress: string;
  nodeUrl:     string;
  indexerUrl:  string;
}> = {
  shelbynet: {
    coreAddress: "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a",
    nodeUrl:     "https://api.shelbynet.shelby.xyz/v1",
    indexerUrl:  "https://api.shelbynet.shelby.xyz/v1/graphql",
  },
  testnet: {
    coreAddress: "0xc63d6a5efb0080a6029403131715bd4971e1149f7cc099aac69bb0069b3ddbf5",
    nodeUrl:     "https://api.testnet.aptoslabs.com/v1",
    indexerUrl:  "https://api.testnet.aptoslabs.com/v1/graphql",
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function truncate(addr: string, front = 6, back = 4): string {
  if (!addr || addr.length <= front + back + 3) return addr;
  return `${addr.slice(0, front)}...${addr.slice(-back)}`;
}

function zoneToCoords(zone: string): [number, number] {
  const meta = ZONE_META[zone];
  if (meta) return [meta.fallbackLng, meta.fallbackLat];
  return [0, 0];
}

// ── Source 1: Read from Cloudflare KV ────────────────────────────────────────
async function readFromKV(
  networkParam: string
): Promise<StorageProvider[] | null> {
  try {
    // KV binding là Cloudflare-specific, chỉ khả dụng khi chạy trên CF edge
    // Truy cập qua process.env binding (CF injects KV as env var)
    const kv = networkParam === "shelbynet"
      ? (process.env as any).SHELBY_KV_MAINNET
      : (process.env as any).SHELBY_KV_TESTNET;

    if (!kv) return null; // Running locally or KV not bound

    // Read index
    const indexStr: string | null = await kv.get("index:providers");
    if (!indexStr) return null;

    const index: { addresses: string[] } = JSON.parse(indexStr);
    if (!index.addresses?.length) return null;

    // Read all node records in parallel
    const nodeStrings: (string | null)[] = await Promise.all(
      index.addresses.map((addr: string) => kv.get(`node:${addr}`))
    );

    const providers = nodeStrings
      .filter((s): s is string => s !== null && s !== undefined)
      .map((s): StorageProvider => {
        const r: KVNodeRecord = JSON.parse(s);
        return {
          address:          r.address,
          addressShort:     r.addressShort,
          availabilityZone: r.availabilityZone,
          state:            r.state as any,
          health:           r.health as any,
          blsKey:           r.blsKey,
          fullBlsKey:       r.fullBlsKey,
          capacityTiB:      r.capacityTiB,
          netAddress:       r.netAddress,
          geo:              r.geo,
          // Coordinates từ Geo-IP (chính xác)
          coordinates:      [r.geo.lng, r.geo.lat],
        };
      });

    return providers.length > 0 ? providers : null;
  } catch (e) {
    console.warn("[providers] KV read failed:", e);
    return null;
  }
}

// ── Source 2: Indexer GraphQL ─────────────────────────────────────────────────
async function fetchFromIndexer(
  indexerUrl: string
): Promise<any[] | null> {
  try {
    const query = `query {
      current_storage_providers {
        address zone state health bls_key capacity used net_address
      }
    }`;

    const res = await fetch(indexerUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query }),
      signal:  AbortSignal.timeout(4000),
    });

    if (!res.ok) return null;
    const json = await res.json() as any;
    const sps  = json.data?.current_storage_providers;
    return sps?.length ? sps : null;
  } catch {
    return null;
  }
}

// ── Source 3: RPC on-chain ────────────────────────────────────────────────────
async function fetchFromRPC(
  nodeUrl:     string,
  coreAddress: string
): Promise<any[] | null> {
  try {
    const regRes = await fetch(
      `${nodeUrl}/accounts/${coreAddress}/resource/${coreAddress}::storage_provider_registry::StorageProviders`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!regRes.ok) return null;

    const regJson = await regRes.json() as any;
    const zones: any[] = regJson?.data?.active_providers_by_az?.root?.children?.entries ?? [];
    if (!zones.length) return null;

    const nodes: any[] = [];
    for (const zone of zones) {
      for (const node of (zone.value?.value ?? [])) {
        // Try to get SP details
        let blsKey = "", netAddress = "";
        try {
          const spRes = await fetch(
            `${nodeUrl}/accounts/${node.addr}/resource/${coreAddress}::storage_provider::StorageProvider`,
            { signal: AbortSignal.timeout(3000) }
          );
          if (spRes.ok) {
            const sp = await spRes.json() as any;
            blsKey     = sp?.data?.bls_public_key?.bytes ?? "";
            netAddress = sp?.data?.net_address ?? "";
          }
        } catch { /* skip */ }

        nodes.push({
          address:     node.addr,
          zone:        zone.key,
          state:       "Active",
          health:      node.status?.condition === 0 ? "Healthy" : "Faulty",
          bls_key:     blsKey,
          net_address: netAddress,
          capacity:    node.status?.quota?.value,
        });
      }
    }
    return nodes.length ? nodes : null;
  } catch {
    return null;
  }
}

// ── Map raw provider → StorageProvider with zone-fallback coords ───────────────
function mapRawProvider(p: any): StorageProvider {
  return {
    address:          p.address,
    addressShort:     truncate(p.address),
    availabilityZone: p.zone ?? "unknown",
    state:            p.state ?? "Active",
    health:           p.health ?? "Healthy",
    blsKey:           p.bls_key ? truncate(p.bls_key, 8, 8) : "—",
    fullBlsKey:       p.bls_key ?? "",
    capacityTiB:      p.capacity ? Number(p.capacity) / (1024 ** 4) : undefined,
    netAddress:       p.net_address ?? "",
    geo: {
      lat:    zoneToCoords(p.zone ?? "")[1],
      lng:    zoneToCoords(p.zone ?? "")[0],
      source: "zone-fallback",
      geocodedAt: new Date().toISOString(),
    },
    // Coordinates từ zone-fallback (chờ Worker geocode)
    coordinates: zoneToCoords(p.zone ?? ""),
  };
}

// ── Main GET handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const fetchedAt    = new Date().toISOString();
  const { searchParams } = new URL(req.url);
  const networkParam = searchParams.get("network") || "shelbynet";
  const cfg          = NETWORK_CONFIG[networkParam] ?? NETWORK_CONFIG.shelbynet;

  let providers:  StorageProvider[] = [];
  let dataSource: string = "none";

  // ── Priority 1: KV (Worker đã geocode) ───────────────────────────────────
  const kvProviders = await readFromKV(networkParam);
  if (kvProviders?.length) {
    providers  = kvProviders;
    dataSource = "kv-geo";
    console.log(`[providers] Served ${providers.length} providers from KV`);
  }

  // ── Priority 2: Indexer GraphQL ───────────────────────────────────────────
  if (!providers.length) {
    const rawIndexer = await fetchFromIndexer(cfg.indexerUrl);
    if (rawIndexer?.length) {
      providers  = rawIndexer.map(mapRawProvider);
      dataSource = "indexer";
      console.log(`[providers] Served ${providers.length} providers from Indexer`);
    }
  }

  // ── Priority 3: RPC on-chain ──────────────────────────────────────────────
  if (!providers.length) {
    const rawRPC = await fetchFromRPC(cfg.nodeUrl, cfg.coreAddress);
    if (rawRPC?.length) {
      providers  = rawRPC.map(mapRawProvider);
      dataSource = "rpc";
      console.log(`[providers] Served ${providers.length} providers from RPC`);
    }
  }

  if (providers.length === 0) {
    return NextResponse.json({
      ok:      false,
      network: networkParam,
      error:   "All data sources unavailable",
      source:  "none",
      data:    { providers: [], count: 0 },
      fetchedAt,
    }, { status: 200 }); // 200 agar UI tự xử lý
  }

  return NextResponse.json({
    ok:         true,
    network:    networkParam,
    source:     dataSource,
    data:       { providers, count: providers.length },
    fetchedAt,
  });
}