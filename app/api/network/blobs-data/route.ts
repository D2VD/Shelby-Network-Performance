// app/api/network/blobs-data/route.ts
// v4.0 — Part 1 of blob-search-503 fix
//
// CHANGE FROM v3.x:
// SHELBY_WORKER_URL already includes "/api/geo-sync" as part of its value —
// it is the geo-sync service URL, NOT a general API base. Including it in
// VPS_URLS produced a nonsensical second attempt
// (https://api.shelbyanalytics.site/api/geo-sync/api/network/blobs-data),
// which always 404'd and added noise to error messages.
//
// Only SHELBY_API_URL is valid for /api/network/* endpoints.
//
// NOTE: this route will still return 502 until Part 2 is deployed —
// api/src/routes/network.ts (/blobs-data) must be mounted on the VPS so
// that GET https://api.shelbyanalytics.site/api/network/blobs-data exists.
// See HANDOFF-blob-search-503.md.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const VPS_URLS = [process.env.SHELBY_API_URL].filter(Boolean) as string[];

const SHELBYNET_API_KEY = process.env.SHELBY_API_KEY ?? "";
const TESTNET_API_KEY = process.env.SHELBY_TESTNET_API_KEY ?? "";

type SupportedNetwork = "shelbynet" | "testnet";

function isSupportedNetwork(value: string | null): value is SupportedNetwork {
  return value === "shelbynet" || value === "testnet";
}

function apiKeyForNetwork(network: SupportedNetwork): string {
  return network === "testnet" ? TESTNET_API_KEY : SHELBYNET_API_KEY;
}

interface BlobsDataPayload {
  ok: boolean;
  blobs?: unknown[];
  error?: string;
  note?: string;
  [key: string]: unknown;
}

function isBlobsDataPayload(value: unknown): value is BlobsDataPayload {
  return typeof value === "object" && value !== null && "ok" in value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const networkParam = searchParams.get("network");
  const network: SupportedNetwork = isSupportedNetwork(networkParam)
    ? networkParam
    : "shelbynet";

  const name = searchParams.get("name")?.trim() ?? "";
  const limit = searchParams.get("limit") ?? "50";
  const cursor = searchParams.get("cursor") ?? "";

  if (VPS_URLS.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Backend not configured",
        note: "SHELBY_API_URL is not set in the environment.",
      } satisfies BlobsDataPayload,
      { status: 500 }
    );
  }

  const apiKey = apiKeyForNetwork(network);
  const errors: string[] = [];

  for (const baseUrl of VPS_URLS) {
    const upstream = new URL("/api/network/blobs-data", baseUrl);
    upstream.searchParams.set("network", network);
    upstream.searchParams.set("limit", limit);
    if (name) upstream.searchParams.set("name", name);
    if (cursor) upstream.searchParams.set("cursor", cursor);

    try {
      const upstreamResponse = await fetch(upstream.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        cache: "no-store",
      });

      // Content-type guard BEFORE calling .json() — surfaces 404/502 HTML
      // pages from misconfigured routes as clean errors instead of a
      // JSON-parse crash.
      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        const bodyText = await upstreamResponse.text();
        errors.push(
          `${baseUrl} -> HTTP ${upstreamResponse.status} (${contentType || "no content-type"}): ${bodyText.slice(0, 200)}`
        );
        continue;
      }

      const payload: unknown = await upstreamResponse.json();

      if (!isBlobsDataPayload(payload)) {
        errors.push(`${baseUrl} -> unexpected JSON shape`);
        continue;
      }

      if (!upstreamResponse.ok || payload.ok === false) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : `HTTP ${upstreamResponse.status}`;
        errors.push(`${baseUrl} -> ${message}`);
        continue;
      }

      return NextResponse.json(payload, { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown fetch error";
      errors.push(`${baseUrl} -> ${message}`);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Blob search is currently unavailable.",
      note: errors.join(" | "),
    } satisfies BlobsDataPayload,
    { status: 502 }
  );
}