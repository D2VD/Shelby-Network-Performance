/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@shelby-protocol/sdk",
    "@shelby-protocol/clay-codes",
    "@aptos-labs/ts-sdk",
    "@aptos-labs/aptos-client",
    "got",
  ],

  // Copy .wasm files into the serverless bundle for Vercel
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@shelby-protocol/clay-codes/dist/*.wasm",
      "./node_modules/@shelby-protocol/clay-codes/dist/*.js",
    ],
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false, net: false, tls: false,
        crypto: false, stream: false, path: false,
        http: false, https: false, zlib: false,
      };
    }
    // Allow importing .wasm files
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};
module.exports = nextConfig;