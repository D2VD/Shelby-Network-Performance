const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
});

module.exports = withNextra({
  images: { unoptimized: true },
  // Static export — deploys through the same Cloudflare Pages pipeline
  // already used for the main dashboard.
  output: 'export',
});
