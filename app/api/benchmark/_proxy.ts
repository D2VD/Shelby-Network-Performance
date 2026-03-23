// app/api/benchmark/_proxy.ts
// Helper dùng chung cho tất cả benchmark routes.
// Tất cả benchmark logic thực sự chạy trong Benchmark Worker (có SDK + WASM).
// Next.js routes chỉ proxy request sang Worker — không chứa logic.

import { NextRequest, NextResponse } from "next/server";

const BENCHMARK_WORKER_URL =
  process.env.SHELBY_BENCHMARK_WORKER_URL ??
  "https://shelby-benchmark.doanvandanh20000.workers.dev";

export async function proxyToBenchmarkWorker(
  req: NextRequest,
  workerPath: string,
  method: "GET" | "POST" = "GET",
  body?: object
): Promise<NextResponse> {
  try {
    const workerRes = await fetch(`${BENCHMARK_WORKER_URL}${workerPath}`, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body:    method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal:  AbortSignal.timeout(60_000), // 60s cho upload lớn
    });

    const data = await workerRes.json();
    return NextResponse.json(data, { status: workerRes.status });
  } catch (err: any) {
    // Worker down hoặc timeout
    return NextResponse.json(
      {
        error: `Benchmark Worker unreachable: ${err.message}`,
        hint:  "Deploy benchmark worker: npm run benchmark:deploy",
        workerUrl: BENCHMARK_WORKER_URL,
      },
      { status: 503 }
    );
  }
}

// Lấy body từ request một lần duy nhất
export async function parseBody(req: NextRequest): Promise<Record<string, any>> {
  try { return await req.json(); }
  catch { return {}; }
}
