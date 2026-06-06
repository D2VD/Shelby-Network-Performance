// app/api/network/transaction/route.ts — v1.0
// Single transaction detail lookup by version number or "v{N}" hash string.
// Fixes 404 when Explorer clicks a transaction row for detail view.

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBYNET_INDEXER =
  "https://api.shelbynet.aptoslabs.com/nocode/v1/public/cmforrguw0042s601fn71f9l2/v1/graphql";
const TESTNET_INDEXER = "https://api.testnet.aptoslabs.com/v1/graphql";
const CORE = "0x85fdb9a176ab8ef1d9d9c1b60d60b3924f0800ac1de1cc2085fb0b8bb4988e6a";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const network = req.nextUrl.searchParams.get("network") ?? "shelbynet";
  const raw     = req.nextUrl.searchParams.get("version") ?? req.nextUrl.searchParams.get("hash") ?? "";

  if (!raw) {
    return NextResponse.json({ ok: false, error: "Provide version or hash parameter" }, { status: 400 });
  }

  // Accept "v12345" or plain "12345"
  const version = raw.startsWith("v") ? raw.slice(1) : raw;
  if (!/^\d+$/.test(version)) {
    return NextResponse.json({ ok: true, network, tx: null, note: "Hash-based lookup not supported — use version number" });
  }

  const indexerUrl = network === "testnet" ? TESTNET_INDEXER : SHELBYNET_INDEXER;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = network === "testnet" ? process.env.SHELBY_TESTNET_API_KEY : process.env.SHELBY_API_KEY;
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const query = `{
    txs: account_transactions(
      where: {
        account_address: { _eq: "${CORE}" }
        transaction_version: { _eq: "${version}" }
      }
      limit: 1
    ) {
      transaction_version
      user_transaction {
        entry_function_id_str
        sender
        timestamp
        success
        gas_used
      }
    }
  }`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    const r = await fetch(indexerUrl, {
      method: "POST", headers,
      body:   JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `Indexer HTTP ${r.status}`, tx: null }, { status: 200 });
    }

    const json = await r.json() as { data?: Record<string, unknown> };
    const rows = ((json.data as Record<string, unknown>)?.txs ?? []) as Array<Record<string, unknown>>;

    if (!rows.length) {
      return NextResponse.json({ ok: true, network, tx: null });
    }

    const row = rows[0];
    const ut  = (row.user_transaction ?? {}) as Record<string, unknown>;

    return NextResponse.json(
      {
        ok: true, network,
        tx: {
          hash:      `v${row.transaction_version}`,
          version:   String(row.transaction_version ?? ""),
          type:      String(ut.entry_function_id_str ?? ""),
          sender:    String(ut.sender ?? ""),
          success:   Boolean(ut.success ?? true),
          timestamp: String(ut.timestamp ?? ""),
          gasUsed:   Number(ut.gas_used ?? 0),
        },
      },
      { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message, tx: null }, { status: 200 });
  }
}