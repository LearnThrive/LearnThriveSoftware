import { defineConfig, devices } from '@playwright/test';

// Separate from apps/classroom's Playwright suite (different app, different port, different
// concerns — this covers auth/session/role-guard behaviour that genuinely needs a real running
// Next.js server and real cookies, not just unit-testable pure functions).
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One shared dev-mode Next.js server (single Node process, on-demand route compilation) backs
  // every worker here — it doesn't scale with CPU count the way a production server would, and
  // running one worker per spec file (Playwright's CPU-based default, now 8+ files) has produced
  // genuine resource-contention flakes (a dropped RSC stream, a slow response landing on the
  // conflict-detection path instead of a clean redirect) rather than real bugs — reproducibly
  // gone when the same file runs alone. Capping workers, and retrying locally too (not just in
  // CI), trades a little wall-clock time for a suite that means what it reports either way.
  workers: 4,
  retries: 1,
  reporter: 'list',
  use: {
    // Must be "localhost", not "127.0.0.1" — Next.js 16 dev's origin protection treats them as
    // different origins and silently 403s every /_next/static chunk request from 127.0.0.1,
    // which (found the hard way, via a fully non-interactive page) blocks all client JS from
    // loading at all, breaking every button/form on the page with no visible error banner.
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  // Two dev servers: the default one (the Library at its shipped `info` phase) and a second with the catalogue open
  // (LIBRARY_PHASE=enrolled), on its own build folder because Next locks one dev server per folder.
  webServer: [{
    // Must run in dev mode (NODE_ENV=development) — DevelopmentAuthProvider deliberately
    // refuses to run under NODE_ENV=production (see assertNotProductionWithoutRealProvider in
    // src/lib/auth/devProvider.ts), so `next start` would crash the whole auth flow by design.
    command: 'npm run dev -- -p 3100',
    // plan15 Wave 3: the theme toggle and dark theme are behind this flag (src/lib/theme.ts).
    // CAREERS_OPEN_FOR_TESTING opens the application and reconfirmation forms while the safeguarding agreement is
    // still a draft (lib/careers-config.ts). It is ignored by a production build, so `next start` never honours it.
    env: { NEXT_PUBLIC_THEME_TOGGLE: '1', CAREERS_OPEN_FOR_TESTING: '1' },
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
  },
  {
    command: 'npm run dev -- -p 3101',
    env: { NEXT_PUBLIC_THEME_TOGGLE: '1', CAREERS_OPEN_FOR_TESTING: '1', LIBRARY_PHASE: 'enrolled', NEXT_DIST_DIR: '.next-3101' },
    url: 'http://localhost:3101',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
  }],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /library-open\.spec\.ts/ },
    // The Library with its catalogue open (phase D onwards): its own server and its own in-memory data.
    { name: 'library-open', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3101' }, testMatch: /library-open\.spec\.ts/ },
  ],
});
