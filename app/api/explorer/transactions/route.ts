// app/api/explorer/transactions/route.ts
// Server-side proxy → VPS backend → Shelby/Aptos V3 indexer.
// Running server-side means NO CSP restriction on external indexer calls.

import { NextRequest, NextResponse } from "next/server";
export const runtime = 'edge';
const VPS_BASE     = (process.env.VPS_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";

function jsonHeaders(ttl = 15): HeadersInit {
  return {
    "Content-Type":  "application/json",
    "Cache-Control": `public, s-maxage=${ttl}, stale-while-revalidate=30`,
  };
}

/* ── GET /api/explorer/transactions ─────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const network  = searchParams.get("network")  ?? "testnet";
    const address  = searchParams.get("address")  ?? "";
    const type     = searchParams.get("type")     ?? "all"; // all | register_blob | stage_code_chunk
    const limit    = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
    const cursor   = searchParams.get("cursor")   ?? "";

    if (!VPS_BASE) {
      return NextResponse.json(
        { error: "VPS_API_URL is not configured", transactions: [] },
        { status: 503, headers: jsonHeaders() }
      );
    }

    /* Build VPS URL */
    const target = new URL(`${VPS_BASE}/explorer/transactions`);
    target.searchParams.set("network", network);
    if (address) target.searchParams.set("address", address);
    if (type !== "all") target.searchParams.set("type", type);
    target.searchParams.set("limit",   String(limit));
    if (cursor) target.searchParams.set("cursor", cursor);

    const upstream = await fetch(target.toString(), {
      headers: {
        "Authorization": `Bearer ${INTERNAL_KEY}`,
        "Content-Type":  "application/json",
      },
      next: { revalidate: 15 },
    });

    /* Guard against HTML error pages from VPS / Cloudflare */
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await upstream.text();
      console.error("[/api/explorer/transactions] VPS returned non-JSON:", text.slice(0, 300));
      return NextResponse.json(
        {
          error:        "Upstream returned unexpected content",
          status:       upstream.status,
          transactions: [],
        },
        { status: 502, headers: jsonHeaders() }
      );
    }

    const data = await upstream.json() as Record<string, unknown>;

    if (!upstream.ok) {
      return NextResponse.json(
        { error: data["error"] ?? "Upstream error", transactions: [], ...data },
        { status: upstream.status, headers: jsonHeaders() }
      );
    }

    return NextResponse.json(data, { headers: jsonHeaders() });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/explorer/transactions]", message);
    return NextResponse.json(
      { error: "Failed to fetch transactions", detail: message, transactions: [] },
      { status: 500, headers: jsonHeaders() }
    );
  }
}