import { defineConfig, devices } from '@playwright/test';

// The browser tests that need the REAL local Supabase stack (launch checklist 2.4 and 2.5): ONE dev server started with
// LEARNTHRIVE_SUPABASE_USE=1, so the site runs on real Auth, real Postgres through the production connection code and the real SQL data
// provider instead of the in-memory development backend. Its own build folder, so it never contends with another dev server's lock.
//
//   npm run supabase:start          (once)
//   npm run test:e2e:realstack --workspace=apps/web
//
// Deliberately NOT part of `npm run test:e2e`: that suite must pass with no Docker. Serial, one worker: the two families, two tutors and
// their lessons are shared state, and a reset password stays reset.
export default defineConfig({
  testDir: './tests-e2e-realstack',
  globalSetup: './tests-e2e-realstack/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3105', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- -p 3105',
    env: {
      // The site uses the local Supabase stack (src/lib/dev/localSupabase.ts reads this).
      LEARNTHRIVE_SUPABASE_USE: '1',
      // The stack is already running; this suite never starts or stops the AI and voice containers.
      LEARNTHRIVE_DOCKER: '0',
      NEXT_DIST_DIR: '.next-3105',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3105',
      ASSISTANT_PROVIDER: 'mock',
      VOICE_PROVIDER: 'mock',
      OLLAMA_API_KEY: '',
    },
    url: 'http://localhost:3105',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
