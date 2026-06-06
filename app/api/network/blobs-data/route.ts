// app/api/network/blobs-data/route.ts — v1.0
// Server-side proxy for blob queries to Shelby dedicated indexer.
// Bypasses browser CSP — indexer URL only reachable server-side.
// Testnet has no blobs table → returns empty with a note.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBYNET_INDEXER =
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql";
const PAGE_SIZE = 20;

function buildWhereClause(status: string): string {
  if (status === "active")  return `_and: [{ is_written: { _eq: 1 } }, { is_deleted: { _eq: 0 } }]`;
  if (status === "pending") return `_and: [{ is_written: { _eq: 0 } }, { is_deleted: { _eq: 0 } }]`;
  if (status === "deleted") return `is_deleted: { _eq: 1 }`;
  return `is_written: { _eq: 1 }`; // "all"
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  const status  = req.nextUrl.searchParams.get("status")  ?? "active";
  const cursor  = req.nextUrl.searchParams.get("cursor")  ?? "";

  if (network === "testnet") {
    return NextResponse.json({
      ok: true, network, blobs: [], nextCursor: "",
      note: "Blob table unavailable on Testnet — uses generic Aptos V3 indexer",
    });
  }

  const offset = cursor ? `offset: ${Number(cursor)}` : "";
  const query = `{
    blobs(
      where: { ${buildWhereClause(status)} }
      order_by: { id: desc }
      limit: ${PAGE_SIZE}
      ${offset}
    ) {
      id
      owner
      size
      is_written
      is_deleted
      created_at
    }
  }`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.SHELBY_API_KEY;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    const r = await fetch(SHELBYNET_INDEXER, {
      method: "POST", headers,
      body:   JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `Indexer HTTP ${r.status}`, blobs: [], nextCursor: "" },
        { status: 200 }
      );
    }

    const json = await r.json() as { data?: Record<string, unknown>; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      return NextResponse.json(
        { ok: false, error: json.errors[0].message, blobs: [], nextCursor: "" },
        { status: 200 }
      );
    }

    const rows = ((json.data as Record<string, unknown>)?.blobs ?? []) as Array<Record<string, unknown>>;

    const blobs = rows.map(row => {
      const isWritten = Boolean(row.is_written);
      const isDeleted = Boolean(row.is_deleted);
      const blobStatus: "active" | "pending" | "deleted" | "unknown" =
        isDeleted ? "deleted" : isWritten ? "active" : "pending";
      return {
        blobId:       String(row.id ?? ""),
        owner:        String(row.owner ?? ""),
        size:         Number(row.size ?? 0),
        status:       blobStatus,
        registeredAt: String(row.created_at ?? ""),
      };
    });

    const newCursor = rows.length >= PAGE_SIZE
      ? String(Number(cursor || "0") + rows.length)
      : "";

    return NextResponse.json(
      { ok: true, network, blobs, nextCursor: newCursor },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } }
    );
  } catch (e: unknown) {
    const isTimeout = e instanceof Error &&
      (e.message.includes("abort") || e.message.includes("timeout"));
    return NextResponse.json(
      {
        ok: false,
        error: isTimeout ? "Indexer timed out" : (e as Error).message,
        blobs: [],
        nextCursor: "",
      },
      { status: 200 }
    );
  }
}