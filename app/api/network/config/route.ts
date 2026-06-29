// app/api/network/config/route.ts — v1.0
// CF Pages edge proxy → VPS /api/network/config
// Returns chunk size for the calculator. Falls back to 503 on error.

export const runtime = "edge";

const SHELBY_API_URL = process.env.SHELBY_API_URL!;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const network = searchParams.get("network") ?? "shelbynet";

  try {
    const res = await fetch(
      `${SHELBY_API_URL}/api/network/config?network=${network}`,
    );

    if (!res.ok) {
      console.error(`[config-proxy] VPS returned ${res.status}`);
      return new Response("unavailable", { status: 503 });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    console.error("[config-proxy] Fetch failed:", err);
    return new Response("unavailable", { status: 503 });
  }
}