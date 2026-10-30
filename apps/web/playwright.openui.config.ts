import { defineConfig, devices } from '@playwright/test';

// Only what the interactive-answer specs need: ONE dev server (the Library open, the MOCK provider that writes scripted interfaces, no model, no
// network, no key) on its own build folder, so it never contends with another dev server's lock. Run it with `npm run test:e2e:openui`.
export default defineConfig({
  testDir: './tests-e2e',
  testMatch: /study-buddy-openui\.spec\.ts/,
  timeout: 60_000,
  fullyParallel: false,
  workers: 2,
  retries: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- -p 3101',
    env: {
      LEARNTHRIVE_DOCKER: '0',
      NEXT_PUBLIC_THEME_TOGGLE: '1',
      LIBRARY_PHASE: 'enrolled',
      NEXT_DIST_DIR: '.next-3101',
      ASSISTANT_PROVIDER: 'mock',
      VOICE_PROVIDER: 'mock',
      ASSISTANT_DAILY_MESSAGES: '500',
      ASSISTANT_PER_MINUTE: '60',
      // Hermetic: no research key, and nothing at the default search address, so the quotation checks have nothing to read (a developer's own .env
      // must not turn these into live web searches). An empty value is still "set", so Next does not fill it in from a file.
      OLLAMA_API_KEY: '',
      RESEARCH_PROVIDER: 'searxng',
      SEARXNG_BASE_URL: 'http://127.0.0.1:9',
      CRAWL4AI_ENABLED: 'off',
    },
    url: 'http://localhost:3101',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    stdout: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
