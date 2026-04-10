/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Redirects: old routes → new clean routes ────────────────────────────────
  async redirects() {
    return [
      // /dashboard → /analytics
      {
        source: "/dashboard",
        destination: "/analytics",
        permanent: true,
      },
      // /dashboard/providers → /map
      {
        source: "/dashboard/providers",
        destination: "/map",
        permanent: true,
      },
      // /dashboard/charts → /charts
      {
        source: "/dashboard/charts",
        destination: "/charts",
        permanent: true,
      },
      // Handle any nested /dashboard/* catch-all
      {
        source: "/dashboard/:path*",
        destination: "/analytics",
        permanent: false,
      },
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