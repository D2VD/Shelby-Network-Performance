/**
 * app/api/network/blobs-data/route.ts — v2.1
 *
 * Fix: order_by field changed from { id: desc } → { created_at: desc }
 *      "field 'id' not found in type: 'blobs_order_by'" — the blobs_order_by
 *      GQL type does not expose an `id` column; created_at is orderable.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBYNET_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
const TESTNET_INDEXER   = "https://api.testnet.aptoslabs.com/v1/graphql";
const PAGE_SIZE         = 30;

function buildQuery(
  status: string | null,
  owner: string | null,
  cursor: number,
): string {
  const conditions: string[] = [];

  if (status && status !== "all") {
    if (status === "active")  conditions.push("is_deleted: { _eq: false }, is_written: { _eq: true }");
    if (status === "pending") conditions.push("is_written: { _eq: false }");
    if (status === "deleted") conditions.push("is_deleted: { _eq: true }");
  }
  if (owner) conditions.push(`owner: { _eq: "${owner}" }`);

  const where = conditions.length ? `where: { ${conditions.join(", ")} }` : "";

  return `{
    blobs(
      ${where}
      order_by: { created_at: desc }
      limit: ${PAGE_SIZE}
      offset: ${cursor}
    ) {
      id
      owner
      size
      is_written
      is_deleted
      created_at
    }
    blobs_aggregate(${where ? where : ""}) {
      aggregate { count }
    }
  }`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const network = searchParams.get("network") ?? "shelbynet";
  const status  = searchParams.get("status");
  const owner   = searchParams.get("owner");
  const cursor  = parseInt(searchParams.get("cursor") ?? "0", 10);

  const apiKey  = network === "testnet"
    ? process.env.SHELBY_TESTNET_API_KEY
    : process.env.SHELBY_API_KEY;
  const url     = network === "testnet" ? TESTNET_INDEXER : SHELBYNET_INDEXER;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: `Missing API key for ${network}` },
      { status: 500 },
    );
  }

  if (network === "testnet") {
    // Testnet blobs indexer not available — return empty with note
    return NextResponse.json({
      ok: true, network, blobs: [], total: 0, cursor: 0, nextCursor: null,
      note: "Blob data not available on testnet indexer",
    });
  }

  try {
    const r = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: buildQuery(status, owner, cursor) }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText);
      return NextResponse.json(
        { ok: false, error: `Indexer responded ${r.status}: ${text}` },
        { status: 502 },
      );
    }

    const j = await r.json() as any;

    // Surface GraphQL errors clearly
    if (j.errors?.length) {
      return NextResponse.json(
        { ok: false, error: j.errors.map((e: any) => e.message).join("; ") },
        { status: 502 },
      );
    }

    const blobs = j?.data?.blobs ?? [];
    const total = j?.data?.blobs_aggregate?.aggregate?.count ?? 0;
    const nextCursor = blobs.length === PAGE_SIZE ? cursor + PAGE_SIZE : null;

    return NextResponse.json({ ok: true, network, blobs, total, cursor, nextCursor });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}