/**
 * app/api/network/transaction/route.ts — v1.2
 *
 * Fix: was returning HTTP 400 with "Provide version or hash parameter" when
 *      called with no params. Now returns { ok:true, tx:null } gracefully
 *      so the Explorer page never surfaces an error for a bare GET.
 *
 * Usage:
 *   GET /api/network/transaction?network=shelbynet&version=12345
 *   GET /api/network/transaction?network=shelbynet&hash=0xabc...
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const SHELBYNET_INDEXER = "https://api.shelbynet.shelby.xyz/v1/graphql";
const TESTNET_INDEXER   = "https://api.testnet.aptoslabs.com/v1/graphql";

function buildQuery(version?: string, hash?: string): string {
  const where = version
    ? `where: { transaction_version: { _eq: "${version}" } }`
    : hash
    ? `where: { hash: { _eq: "${hash}" } }`
    : "";

  return `{
    user_transactions(
      ${where}
      order_by: { transaction_version: desc }
      limit: 1
    ) {
      transaction_version
      sender
      sequence_number
      max_gas_amount
      gas_unit_price
      expiration_timestamp_secs
      timestamp
      entry_function_id_str
      success
    }
  }`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const network = searchParams.get("network") ?? "shelbynet";
  let   version = searchParams.get("version") ?? "";
  const hash    = searchParams.get("hash") ?? "";

  // Normalise: strip leading "v" — "v12345" → "12345"
  if (version.toLowerCase().startsWith("v")) version = version.slice(1);

  // No params → graceful empty (not an error)
  if (!version && !hash) {
    return NextResponse.json({ ok: true, network, tx: null });
  }

  const apiKey = network === "testnet"
    ? process.env.SHELBY_TESTNET_API_KEY
    : process.env.SHELBY_API_KEY;
  const url    = network === "testnet" ? TESTNET_INDEXER : SHELBYNET_INDEXER;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: `Missing API key for ${network}` },
      { status: 500 },
    );
  }

  try {
    const r = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body:   JSON.stringify({ query: buildQuery(version || undefined, hash || undefined) }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => r.statusText);
      return NextResponse.json(
        { ok: false, error: `Indexer ${r.status}: ${text}` },
        { status: 502 },
      );
    }

    const j = await r.json() as any;

    if (j.errors?.length) {
      return NextResponse.json(
        { ok: false, error: j.errors.map((e: any) => e.message).join("; ") },
        { status: 502 },
      );
    }

    const txs = j?.data?.user_transactions ?? [];
    return NextResponse.json({ ok: true, network, tx: txs[0] ?? null });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}