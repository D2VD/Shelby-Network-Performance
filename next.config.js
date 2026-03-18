/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@shelby-protocol/sdk",
    "@shelby-protocol/clay-codes",
    "@aptos-labs/ts-sdk",
    "@aptos-labs/aptos-client",
    "got",
  ],

  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@shelby-protocol/clay-codes/dist/*.wasm",
      "./node_modules/@shelby-protocol/clay-codes/dist/*.js",
    ],
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

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false, net: false, tls: false, crypto: false,
        stream: false, path: false, http: false, https: false, zlib: false,
      };
    }
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },

  images: { unoptimized: true },
};

module.exports = nextConfig;