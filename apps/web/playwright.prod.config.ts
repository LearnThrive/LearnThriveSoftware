import { defineConfig, devices } from '@playwright/test';

// plan15 Wave 12: the smoke suite for the PRODUCTION build (`next build && next start`), the thing that is
// actually deployed. Separate from playwright.config.ts on purpose: that one drives a dev server with the
// development auth provider; this one must run against NODE_ENV=production, where the portal is closed
// (lib/portal.ts), development tools are 404s (proxy.ts) and the CSP/HSTS headers exist.
//
//   npm run build && NODE_ENV=production npx next start -p 3200      (in one terminal)
//   npm run test:prod-smoke                                           (in another)
//
// Chromium always. Firefox and WebKit run the same suite when PW_CROSS_BROWSER=1 (CI sets it; locally
// `npx playwright install firefox webkit` first). It sends nothing real: no enquiry is ever submitted
// with a valid, human-paced payload, so it is safe to point at a server that has live email credentials.
const crossBrowser = process.env.PW_CROSS_BROWSER === '1';

export default defineConfig({
  testDir: './tests-prod',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PROD_BASE_URL ?? 'http://localhost:3200',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(crossBrowser
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
          { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
        ]
      : []),
  ],
});
