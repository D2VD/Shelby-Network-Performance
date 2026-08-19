/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/dashboard",           destination: "/network",              permanent: true  },
      { source: "/dashboard/providers", destination: "/map",                  permanent: true  },
      { source: "/dashboard/charts",    destination: "/network",              permanent: true  },
      { source: "/dashboard/:path*",    destination: "/network",              permanent: false },
      { source: "/analytics",           destination: "/network",              permanent: true  },
      { source: "/charts",              destination: "/network?tab=timeseries", permanent: true },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options",        value: "DENY"    },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection",       value: "1; mode=block" },
          { key: "Permissions-Policy",     value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",

              // Scripts: allow self, eval (Next.js HMR), inline (Next.js hydration),
              // jsdelivr (react-simple-maps world-atlas via script tag),
              // cloudflare analytics (production), and cobe WebGL wasm
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' " +
                "https://cdn.jsdelivr.net " +
                "https://unpkg.com " +
                "https://static.cloudflareinsights.com",

              // Styles
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

              // Fonts
              "font-src 'self' https://fonts.gstatic.com",

              // Images
              "img-src 'self' data: blob: https:",

              // Fetch / XHR / WebSocket connections
              // cdn.jsdelivr.net and unpkg.com: react-simple-maps world-atlas JSON
              // ====== NEW CSP PATCH LOGIC START ======
              "connect-src 'self' " +
                "https://api.shelbynet.shelby.xyz " +
                "https://api.testnet.aptoslabs.com " +
                "https://shelby-analytics.site " +
                "https://cdn.jsdelivr.net " +
                "https://unpkg.com " +
                "https://static.cloudflareinsights.com " +
                "https://api.shelbyanalytics.site " +
                "wss://api.shelbyanalytics.site " +
                "wss:",
              // ====== NEW CSP PATCH LOGIC END ======

              // Workers: cobe uses a WebGL worker internally
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
      { source: "/_next/static/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
        {
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    { source: "/_next/static/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/geo/(.*)",          headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      { source: "/api/network/stats", headers: [{ key: "Cache-Control", value: "public, max-age=15, stale-while-revalidate=60" }] },
      { source: "/api/network/providers", headers: [{ key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" }] },
      { source: "/api/benchmark/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },

  images: { unoptimized: true },
};

module.exports = nextConfig;