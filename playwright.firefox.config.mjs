import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Separate actual Firefox run. Do not affect the established Chromium suite.
export default defineConfig({
  ...base,
  projects: [{
    name: 'firefox-scope',
    use: {
      ...base.use,
      browserName: 'firefox',
      viewport: { width: 1440, height: 1000 },
      isMobile: false,
      hasTouch: false,
      launchOptions: {},
    },
  }],
});
