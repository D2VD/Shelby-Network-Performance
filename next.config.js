/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Legacy dashboard routes → new clean routes
      { source: "/dashboard",           destination: "/network",  permanent: true  },
      { source: "/dashboard/providers", destination: "/map",      permanent: true  },
      { source: "/dashboard/charts",    destination: "/network",  permanent: true  },
      { source: "/dashboard/:path*",    destination: "/network",  permanent: false },

      // Analytics / Charts → Network (tabbed)
      { source: "/analytics",           destination: "/network",              permanent: true },
      { source: "/charts",              destination: "/network?tab=timeseries", permanent: true },

      // Old /map/page.tsx re-export kept — no redirect needed
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options",            value: "nosniff" },
          { key: "X-Frame-Options",                   value: "DENY" },
          { key: "Referrer-Policy",                   value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection",                  value: "1; mode=block" },
          { key: "Permissions-Policy",                value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              "connect-src 'self' https://api.shelbynet.shelby.xyz https://api.testnet.aptoslabs.com https://shelby-analytics.site wss:",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/geo/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/api/network/stats",
        headers: [{ key: "Cache-Control", value: "public, max-age=15, stale-while-revalidate=60" }],
      },
      {
        source: "/api/network/providers",
        headers: [{ key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" }],
      },
      {
        source: "/api/benchmark/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },

  images: { unoptimized: true },
};

module.exports = nextConfig;