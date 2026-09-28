/**
 * plan11.md Task 1: exercises representative marketing routes at desktop and mobile viewports,
 * measuring real frame pacing during scroll rather than reporting a static Lighthouse-style
 * score. Output is machine-readable JSON under the gitignored artifacts/ directory so later
 * tasks (and Task 20's final report) can diff before/after numbers instead of relying on
 * "feels smoother" impressions.
 *
 * Deliberately a self-contained in-page sampler (not an import of lib/motion/frameProfiler.ts):
 * that module is TypeScript with no bundler step here, and duplicating ~30 lines of rAF-delta
 * sampling directly into the page.evaluate callback is simpler than transpiling and injecting a
 * second copy of the same module into the browser context for one script.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
// Not a hardcoded "node_modules/next/dist/bin/next" relative path (what scripts/browser-check.mjs
// uses): npm workspaces hoist `next` to the monorepo root's node_modules, not apps/web's own, so
// that relative path never resolves. require.resolve walks Node's real module resolution and
// finds it wherever it actually lives.
const nextBin = require.resolve("next/dist/bin/next");

const root = resolve(import.meta.dirname, "..");
const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = resolve(root, "artifacts", "motion-profile");

const routes = ["/", "/subjects", "/maths-tuition", "/about", "/book"];
const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error("No local Chromium executable found. Set CHROME_PATH to run motion profiling.");
  }
  return executable;
}

async function waitForServer(serverOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Production server did not start in time for motion profiling.\n${serverOutput.join("")}`);
}

/** Runs entirely inside the page: samples rAF deltas for `durationMs` while performing a smooth
    scripted scroll through the page, then derives the same measured-cadence/dropped-frame
    estimate as lib/motion/frameProfiler.ts (kept in sync manually — see the file header). */
async function measureScrollPass(page, durationMs = 2500) {
  return page.evaluate(async (duration) => {
    const intervals = [];
    let last = null;
    let longTasks = 0;
    let po = null;
    try {
      if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        po = new PerformanceObserver((list) => {
          longTasks += list.getEntries().length;
        });
        po.observe({ entryTypes: ["longtask"] });
      }
    } catch {
      po = null;
    }

    const start = performance.now();
    let scrolling = true;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;

    function frame(t) {
      if (last !== null) {
        const delta = t - last;
        if (delta > 0 && delta < 250) intervals.push(delta);
      }
      last = t;
      if (scrolling) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // A smooth scripted scroll for the duration of the measurement window, covering roughly the
    // full page — not scroll-jacking the real page (this is a one-off measurement script, not
    // shipped product code), just driving realistic scroll input to sample real frame cost.
    const scrollStart = performance.now();
    while (performance.now() - start < duration) {
      const elapsed = performance.now() - scrollStart;
      const progress = Math.min(1, elapsed / duration);
      window.scrollTo(0, scrollHeight * progress);
      await new Promise((r) => setTimeout(r, 16));
    }
    scrolling = false;
    po?.disconnect();

    if (intervals.length < 5) {
      return { sampleCount: intervals.length, measuredHz: null, avgFrameIntervalMs: null, p95FrameIntervalMs: null, droppedFramePercent: null, longTaskCount: longTasks };
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
    const lowTailCount = Math.max(3, Math.floor(sorted.length * 0.2));
    const lowTail = sorted.slice(0, lowTailCount);
    const measuredInterval = lowTail.reduce((a, b) => a + b, 0) / lowTail.length;
    const measuredHz = Math.round(1000 / measuredInterval);
    let expected = 0;
    let missed = 0;
    for (const delta of intervals) {
      const framesForGap = Math.max(1, Math.round(delta / measuredInterval));
      expected += framesForGap;
      missed += framesForGap - 1;
    }
    return {
      sampleCount: intervals.length,
      measuredHz,
      avgFrameIntervalMs: avg,
      p95FrameIntervalMs: p95,
      droppedFramePercent: expected > 0 ? (missed / expected) * 100 : 0,
      longTaskCount: longTasks,
    };
  }, durationMs);
}

async function run() {
  assert.ok(existsSync(resolve(root, ".next")), "Run `npm run build` before profiling motion.");
  await mkdir(outDir, { recursive: true });

  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (c) => serverOutput.push(c.toString()));
  server.stderr.on("data", (c) => serverOutput.push(c.toString()));

  let browser;
  const results = [];
  try {
    await waitForServer(serverOutput);
    browser = await chromium.launch({ executablePath: chromePath(), headless: true });

    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      for (const route of routes) {
        await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400); // let entrance animations settle before sampling
        const metrics = await measureScrollPass(page);
        results.push({ route, viewport: viewport.name, ...metrics });
        console.log(`${route} @ ${viewport.name}: hz=${metrics.measuredHz} p95=${metrics.p95FrameIntervalMs?.toFixed(1)}ms dropped=${metrics.droppedFramePercent?.toFixed(1)}% longTasks=${metrics.longTaskCount}`);
      }
      await context.close();
    }

    const outPath = resolve(outDir, `profile-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(outPath, JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  } finally {
    await browser?.close();
    server.kill();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
