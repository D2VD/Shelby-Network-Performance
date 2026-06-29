// app/api/pricing/competitors/route.ts — v1.0
// CF Pages edge proxy. Forwards to VPS backend; returns 503 on any failure
// so the frontend's hardcoded fallback takes over cleanly.

export const runtime = "edge";

const SHELBY_API_URL = process.env.SHELBY_API_URL!;

export async function GET(): Promise<Response> {
  try {
    const res = await fetch(`${SHELBY_API_URL}/api/pricing/competitors`);

    if (!res.ok) {
      console.error(`[pricing-proxy] VPS returned ${res.status}`);
      return new Response("unavailable", { status: 503 });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    console.error("[pricing-proxy] Fetch failed:", err);
    return new Response("unavailable", { status: 503 });
  }
}