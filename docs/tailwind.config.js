module.exports = {
  content: [
    './pages/**/*.{js,jsx,ts,tsx,md,mdx}',
    './components/**/*.{js,jsx,ts,tsx,md,mdx}',
    './theme.config.tsx',
    // nextra-theme-docs ships its own components; without this, Tailwind
    // purges classes the theme itself relies on.
    './node_modules/nextra-theme-docs/dist/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
