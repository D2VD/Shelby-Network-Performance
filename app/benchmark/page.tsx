"use client";
// app/benchmark/page.tsx
//
// FIX 2026-08-02: was importing everything (including @aptos-labs/wallet-
// adapter-react, via use-wallet-session.ts) statically. Even in a "use
// client" file, Next.js still builds a server-side module reference for
// client components, so that static import chain was being resolved by the
// server webpack compiler too — which fails, because wallet-adapter-core's
// dependency tree pulls in `got` (via @aptos-labs/ts-sdk's Node client) and
// @telegram-apps/bridge (via @aptos-connect/*, Telegram Mini App wallet
// support), neither of which resolve in this project's Cloudflare Pages
// build target.
//
// Fix: ALL wallet-dependent code now lives in benchmark-page-client.tsx,
// loaded here via next/dynamic with ssr:false. That isolates the entire
// import chain inside a dynamic chunk that's excluded from server-side
// compilation — this file itself has zero wallet-adapter-related imports,
// so nothing here can drag that dependency tree back into the build.
//
// Matches this project's existing convention for other browser-only libs
// (map component, eCharts — see timeseries-chart.tsx header).

import dynamic from "next/dynamic";

const BenchmarkPageClient = dynamic(() => import("./benchmark-page-client"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted, #8b8b9a)", fontSize: 13 }}>
      Loading benchmark tool…
    </div>
  ),
});

export default function BenchmarkPage() {
  return <BenchmarkPageClient />;
}