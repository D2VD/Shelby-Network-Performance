// app/api/benchmark/diagnose/route.ts — v2
// Thêm: kiểm tra Benchmark Worker có deploy và reachable không (check đầu tiên)
// Fix: phân biệt "worker chưa deploy" vs "checks fail"

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const BENCHMARK_WORKER_URL =
  process.env.SHELBY_BENCHMARK_WORKER_URL ??
  "https://shelby-benchmark.doanvandanh20000.workers.dev";

export async function GET(_req: NextRequest) {
  // ── Bước 0: Kiểm tra Worker có up không ──────────────────────────────────
  // Làm trước tiên — nếu worker down, toàn bộ checks đều vô nghĩa
  try {
    const healthRes = await fetch(`${BENCHMARK_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(8_000),
    });

    const contentType = healthRes.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      // HTML response = worker chưa deploy
      return NextResponse.json({
        ready:      false,
        passCount:  0,
        failCount:  1,
        warnCount:  0,
        workerDeployed: false,
        checks: [{
          name:   "Benchmark Worker",
          status: "fail",
          value:  `HTTP ${healthRes.status} — trả về HTML (không phải JSON)`,
          hint:   "Worker chưa được deploy. Chạy: npm run benchmark:deploy",
        }],
        summary: "Benchmark Worker chưa được deploy",
        deploySteps: [
          "npm run benchmark:deploy",
          "npx wrangler secret put SHELBY_PRIVATE_KEY --config workers/wrangler.benchmark.toml",
          "npx wrangler secret put SHELBY_WALLET_ADDRESS --config workers/wrangler.benchmark.toml",
          `Thêm vào CF Pages env: SHELBY_BENCHMARK_WORKER_URL=${BENCHMARK_WORKER_URL}`,
        ],
        workerUrl: BENCHMARK_WORKER_URL,
      });
    }

    const health = await healthRes.json() as any;
    if (!health?.ok) {
      return NextResponse.json({
        ready: false, failCount: 1, passCount: 0, warnCount: 0,
        workerDeployed: false,
        checks: [{ name: "Benchmark Worker", status: "fail", value: "Worker unhealthy", hint: JSON.stringify(health) }],
        summary: "Benchmark Worker unhealthy",
        workerUrl: BENCHMARK_WORKER_URL,
      });
    }

    // Worker OK — delegate full diagnose sang Worker (nó có private key + WASM)
    const diagRes = await fetch(`${BENCHMARK_WORKER_URL}/diagnose`, {
      signal: AbortSignal.timeout(30_000),
    });

    const diagContentType = diagRes.headers.get("content-type") ?? "";
    if (!diagContentType.includes("application/json")) {
      throw new Error("Worker /diagnose trả HTML");
    }

    const diag = await diagRes.json() as any;

    // Inject worker status vào đầu checks list
    return NextResponse.json({
      ...diag,
      workerDeployed: true,
      workerVersion:  health.version,
      checks: [
        {
          name:   "Benchmark Worker",
          status: "pass",
          value:  `v${health.version} · ${BENCHMARK_WORKER_URL.replace("https://", "")}`,
        },
        ...(diag.checks ?? []),
      ],
      passCount: (diag.passCount ?? 0) + 1,
    });

  } catch (err: any) {
    const isDNS  = err.message?.includes("fetch failed") || err.message?.includes("ENOTFOUND");
    const isSSL  = err.message?.includes("SSL") || err.message?.includes("1042");
    const isTout = err.name === "TimeoutError" || err.message?.includes("timeout");

    return NextResponse.json({
      ready:      false,
      passCount:  0,
      failCount:  1,
      warnCount:  0,
      workerDeployed: false,
      checks: [{
        name:   "Benchmark Worker",
        status: "fail",
        value:  err.message?.slice(0, 100) ?? "Unreachable",
        hint: isDNS || isSSL
          ? `Worker subdomain không tồn tại. Deploy trước: npm run benchmark:deploy`
          : isTout
          ? "Worker timeout — kiểm tra CF Dashboard xem worker có active không"
          : "Không kết nối được Worker",
      }],
      summary: "Benchmark Worker chưa deploy hoặc không thể kết nối",
      deploySteps: [
        "1. npm run benchmark:deploy",
        "2. npx wrangler secret put SHELBY_PRIVATE_KEY --config workers/wrangler.benchmark.toml",
        "3. npx wrangler secret put SHELBY_WALLET_ADDRESS --config workers/wrangler.benchmark.toml",
        "4. (Optional) npx wrangler secret put SHELBY_API_KEY --config workers/wrangler.benchmark.toml",
      ],
      workerUrl: BENCHMARK_WORKER_URL,
    });
  }
}
