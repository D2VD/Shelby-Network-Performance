/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@shelby-protocol/sdk", "@aptos-labs/ts-sdk"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false, net: false, tls: false,
        crypto: false, stream: false, path: false,
      };
    }
    return config;
  },
};
module.exports = nextConfig;