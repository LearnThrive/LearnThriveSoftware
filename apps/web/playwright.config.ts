import { defineConfig, devices } from '@playwright/test';

// Separate from apps/classroom's Playwright suite (different app, different port, different
// concerns — this covers auth/session/role-guard behaviour that genuinely needs a real running
// Next.js server and real cookies, not just unit-testable pure functions).
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    // Must be "localhost", not "127.0.0.1" — Next.js 16 dev's origin protection treats them as
    // different origins and silently 403s every /_next/static chunk request from 127.0.0.1,
    // which (found the hard way, via a fully non-interactive page) blocks all client JS from
    // loading at all, breaking every button/form on the page with no visible error banner.
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Must run in dev mode (NODE_ENV=development) — DevelopmentAuthProvider deliberately
    // refuses to run under NODE_ENV=production (see assertNotProductionWithoutRealProvider in
    // src/lib/auth/devProvider.ts), so `next start` would crash the whole auth flow by design.
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
