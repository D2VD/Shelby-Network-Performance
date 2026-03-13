// app/api/network/providers/route.ts
// Fetches real storage provider list from Shelbynet RPC
// Data matches what Shelby Explorer shows

import { NextResponse } from "next/server";
import type { StorageProvider, ApiResult, NetworkStats } from "@/lib/types";

const RPC  = "https://api.shelbynet.shelby.xyz/shelby";
const NODE = "https://api.shelbynet.shelby.xyz/v1";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function rpcPost(method: string, params: unknown[] = []) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 30 },
  });
  if (!r.ok) throw new Error(`RPC ${r.status}: ${method}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

function truncate(addr: string, front = 6, back = 4): string {
  if (!addr || addr.length <= front + back + 3) return addr;
  return `${addr.slice(0, front)}...${addr.slice(-back)}`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET() {
  const fetchedAt = new Date().toISOString();

  try {
    // Get storage provider list via RPC
    let providers: StorageProvider[] = [];
    let rpcError: string | null = null;

    try {
      // Try the Shelby custom RPC method for storage providers
      const result = await rpcPost("shelby_getStorageProviders", []);

      // The result is an array of provider objects
      if (Array.isArray(result)) {
        providers = result.map((p: any) => ({
          address:          p.address ?? p.id ?? "",
          addressShort:     truncate(p.address ?? p.id ?? ""),
          availabilityZone: p.availability_zone ?? p.availabilityZone ?? "unknown",
          state:            p.state ?? "Active",
          health:           p.health ?? p.active_health ?? "Healthy",
          blsKey:           truncate(p.bls_key ?? p.blsKey ?? "", 6, 4),
          capacityTiB:      p.capacity ? Number(p.capacity) / (1024 ** 4) : undefined,
          usedTiB:          p.used     ? Number(p.used)     / (1024 ** 4) : undefined,
        }));
      }
    } catch (err: any) {
      rpcError = err.message;

      // Fallback: try alternative RPC method name
      try {
        const result2 = await rpcPost("shelby_storageProviders", []);
        if (Array.isArray(result2)) {
          providers = result2.map((p: any) => ({
            address:          p.address ?? "",
            addressShort:     truncate(p.address ?? ""),
            availabilityZone: p.availability_zone ?? "unknown",
            state:            p.state ?? "Active",
            health:           p.health ?? "Healthy",
            blsKey:           truncate(p.bls_key ?? "", 6, 4),
          }));
          rpcError = null;
        }
      } catch (err2: any) {
        rpcError = `Primary: ${rpcError} | Fallback: ${err2.message}`;
      }
    }

    // If RPC failed entirely, return error (no fake data)
    if (providers.length === 0 && rpcError) {
      const body: ApiResult<never> = {
        ok: false,
        error: `Cannot fetch storage providers: ${rpcError}`,
        fetchedAt,
      };
      return NextResponse.json(body, { status: 503 });
    }

    const body: ApiResult<{ providers: StorageProvider[]; count: number }> = {
      ok: true,
      data: { providers, count: providers.length },
      fetchedAt,
    };
    return NextResponse.json(body);

  } catch (err: any) {
    const body: ApiResult<never> = {
      ok: false,
      error: err.message ?? "Unknown error",
      fetchedAt,
    };
    return NextResponse.json(body, { status: 500 });
  }
}