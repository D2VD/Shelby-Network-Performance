// app/api/network/blobs-data/route.ts
// Proxies to VPS /network/blobs-data — handles both:
//   ?status=active|failed|all&address=…&cursor=…   (paged blob list)
//   ?name=…                                          (blob name search)
export const runtime = "edge";

const VPS_BASE = (process.env.VPS_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const INTERNAL_KEY = process.env.INTERNAL_API_KEY ?? "";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  if (!VPS_BASE) {
    return Response.json(
      { ok: false, error: "VPS_API_URL is not configured", blobs: [] },
      { status: 503 }
    );
  }

  // Forward all query params as-is (network, status, address, name, cursor, limit)
  const target = `${VPS_BASE}/network/blobs-data?${searchParams.toString()}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        "Authorization": `Bearer ${INTERNAL_KEY}`,
        "Content-Type":  "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    // Guard: VPS down / 502 HTML page → don't pass HTML to the client
    const ct = upstream.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      const text = await upstream.text();
      console.error("[/api/network/blobs-data] non-JSON from VPS:", text.slice(0, 300));
      return Response.json(
        { ok: false, error: `Upstream returned ${upstream.status}`, blobs: [] },
        { status: 502 }
      );
    }

    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/network/blobs-data]", msg);
    return Response.json(
      { ok: false, error: msg.includes("abort") ? "Request timed out" : msg, blobs: [] },
      { status: 500 }
    );
  }
}