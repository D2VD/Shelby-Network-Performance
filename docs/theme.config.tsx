import React from 'react';

const config = {
  logo: <span style={{ fontWeight: 700 }}>Shelby Analytics Docs</span>,
  project: {
    link: 'https://github.com/', // TODO: replace with actual repo URL
  },
  docsRepositoryBase: 'https://github.com/', // TODO: replace with actual repo URL
  footer: {
    text: `Shelby Analytics — community dashboard for the Shelby Protocol. Not affiliated with the Shelby core team.`,
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Shelby Analytics Docs',
    };
  },
  primaryHue: 210,
  navigation: true,
  darkMode: true,
};

export default config;
