// app/api/explorer/blobs/route.ts
// Server-side proxy → VPS backend → Shelby indexer.
// Running server-side means NO CSP restriction on external indexer calls.
// This route replaces any prior client-side fetch that hit the indexer directly.

import { NextRequest, NextResponse } from "next/server";
export const runtime = 'edge';
const VPS_BASE = (process.env.VPS_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";

/* ── Shared CORS / cache headers ─────────────────────────────────────────── */
function jsonHeaders(ttl = 30): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=60`,
  };
}

/* ── GET /api/explorer/blobs ─────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const network = searchParams.get("network") ?? "testnet";
    const address = searchParams.get("address") ?? "";
    const status  = searchParams.get("status")  ?? "all";   // all | active | pending | deleted
    const limit   = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
    const cursor  = searchParams.get("cursor")  ?? "";

    if (!VPS_BASE) {
      return NextResponse.json(
        { error: "VPS_API_URL is not configured", blobs: [] },
        { status: 503, headers: jsonHeaders() }
      );
    }

    /* Build VPS URL */
    const target = new URL(`${VPS_BASE}/explorer/blobs`);
    target.searchParams.set("network", network);
    if (address) target.searchParams.set("address", address);
    if (status !== "all") target.searchParams.set("status", status);
    target.searchParams.set("limit",   String(limit));
    if (cursor) target.searchParams.set("cursor", cursor);

    const upstream = await fetch(target.toString(), {
      headers: {
        "Authorization": `Bearer ${INTERNAL_KEY}`,
        "Content-Type":  "application/json",
      },
      // Edge caching — blobs don't need sub-second freshness
      next: { revalidate: 30 },
    });

    /* If VPS returns non-JSON (HTML error page), surface a clean error */
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await upstream.text();
      console.error("[/api/explorer/blobs] VPS returned non-JSON:", text.slice(0, 300));
      return NextResponse.json(
        {
          error:  "Upstream returned unexpected content",
          status: upstream.status,
          blobs:  [],
        },
        { status: 502, headers: jsonHeaders() }
      );
    }

    const data = await upstream.json() as Record<string, unknown>;

    if (!upstream.ok) {
      return NextResponse.json(
        { error: data["error"] ?? "Upstream error", blobs: [], ...data },
        { status: upstream.status, headers: jsonHeaders() }
      );
    }

    return NextResponse.json(data, { headers: jsonHeaders() });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/explorer/blobs]", message);
    return NextResponse.json(
      { error: "Failed to fetch blobs", detail: message, blobs: [] },
      { status: 500, headers: jsonHeaders() }
    );
  }
}