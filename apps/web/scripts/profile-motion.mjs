/**
 * plan11.md task 1: exercise the representative marketing routes at a desktop and a mobile size
 * and record what the browser actually did — frame pacing while idle, while the pointer moves, and
 * while the page is scrolled down and back up; load metrics (FCP/LCP/CLS); how much JS and CSS was
 * transferred; how much layout and style work the browser did; and which animations were running
 * at rest. Output is machine-readable JSON under the gitignored `artifacts/motion-profile/`, so a
 * before and an after run can be compared number for number instead of by feel.
 *
 *   npm run build                                   # profile the production build, never dev
 *   node scripts/profile-motion.mjs --label baseline
 *   node scripts/profile-motion.mjs --label after --routes /,/subjects --viewports desktop --runs 1
 *
 *   --label <name>       output file name (artifacts/motion-profile/<name>.json)   [run]
 *   --runs <n>           independent runs per route/viewport; results are medians  [3]
 *   --routes <a,b,c>     routes to profile        [/, /subjects, /maths-tuition, /about, /book]
 *   --viewports <a,b>    desktop (1440x900) and/or mobile (390x844)                [both]
 *   --base-url <url>     use an already-running server instead of starting `next start`
 *   --port <n>           port for the server the script starts                     [3200]
 *   --out <dir>          output directory
 *   --cpu-throttle <n>   slow the main thread n-fold (CDP), approximating a midrange phone; a
 *                        fast machine hides main-thread cost that a 4x throttle exposes    [1]
 *   --trace              also record Chromium's trace and count paint / raster / layout events per
 *                        phase. Tracing slows the page down, so a --trace run's frame timings are
 *                        not comparable to a normal run's — use it for *how much work*, not *how
 *                        fast*, and keep the two kinds of run separate.
 *   --reduced            emulate prefers-reduced-motion: reduce
 *   --quick              one short run, for smoke-testing the script itself
 *
 * The frame numbers come from lib/motion/frameProfiler.ts itself — the script transpiles that file
 * and injects it into every page — so the overlay and this script cannot drift apart.
 *
 * Read the numbers with the environment in mind: they are only comparable between runs on the same
 * machine. In a container or CI runner Chromium renders in software (the report records the GL
 * renderer), which is far slower than a real GPU; treat absolute values as a lower bound on what
 * a device does and the before/after *difference* as the result.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);

const DEFAULT_ROUTES = ["/", "/subjects", "/maths-tuition", "/about", "/book"];

const VIEWPORTS = {
  desktop: {
    name: "desktop-1440x900",
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    gesture: "mouse",
    scrollSpeed: 1800,
    reverseSpeed: 3000,
  },
  mobile: {
    name: "mobile-390x844",
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    gesture: "touch",
    scrollSpeed: 1600,
    reverseSpeed: 2800,
  },
};

const CDP_COUNTERS = ["LayoutCount", "RecalcStyleCount"];
const CDP_DURATIONS = ["LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"];

function parseArgs(argv) {
  const options = {
    label: "run",
    runs: 3,
    routes: DEFAULT_ROUTES,
    viewports: Object.keys(VIEWPORTS),
    baseUrl: null,
    port: 3200,
    out: resolve(root, "artifacts", "motion-profile"),
    cpuThrottle: 1,
    trace: false,
    reduced: false,
    quick: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${argument} needs a value`);
      return argv[index];
    };
    switch (argument) {
      case "--label":
        options.label = value();
        break;
      case "--runs":
        options.runs = Number(value());
        break;
      case "--routes":
        options.routes = value().split(",").filter(Boolean);
        break;
      case "--viewports":
        options.viewports = value().split(",").filter(Boolean);
        break;
      case "--base-url":
        options.baseUrl = value().replace(/\/$/, "");
        break;
      case "--port":
        options.port = Number(value());
        break;
      case "--out":
        options.out = resolve(value());
        break;
      case "--cpu-throttle":
        options.cpuThrottle = Number(value());
        break;
      case "--trace":
        options.trace = true;
        break;
      case "--reduced":
        options.reduced = true;
        break;
      case "--quick":
        options.quick = true;
        options.runs = 1;
        break;
      default:
        throw new Error(`Unknown argument: ${argument} (see the header of this file for usage)`);
    }
  }
  if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error("--runs must be a positive integer");
  if (!(options.cpuThrottle >= 1)) throw new Error("--cpu-throttle must be a number >= 1");
  for (const name of options.viewports) {
    if (!VIEWPORTS[name]) throw new Error(`Unknown viewport "${name}" (use: ${Object.keys(VIEWPORTS).join(", ")})`);
  }
  return options;
}

function chromePath() {
  const managed = chromium.executablePath();
  const candidates = [
    process.env.CHROME_PATH,
    managed,
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) throw new Error("No Chromium executable found. Set CHROME_PATH to run the profiler.");
  return executable;
}

/**
 * Everything injected before the page's own scripts: the real frame profiler (transpiled from
 * the TypeScript source) plus observers for the load metrics that need to be captured as they
 * happen rather than read back afterwards.
 */
function buildInitScript() {
  const profilerSource = ts.transpileModule(
    readFileSync(resolve(root, "src", "lib", "motion", "frameProfiler.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;

  return `(() => {
    const profilerModule = { exports: {} };
    ((exports, module) => {
${profilerSource}
    })(profilerModule.exports, profilerModule);
    window.__ltProfiler = profilerModule.exports;

    const perf = (window.__ltPerf = { fcp: 0, lcp: 0, lcpElement: null, cls: 0, longTasks: 0, longTaskBlockingMs: 0 });
    const observe = (type, onEntry) => {
      try {
        new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
      } catch {
        /* an entry type this browser cannot report simply stays at zero */
      }
    };
    observe("paint", (entry) => { if (entry.name === "first-contentful-paint") perf.fcp = entry.startTime; });
    observe("largest-contentful-paint", (entry) => {
      perf.lcp = entry.startTime;
      // Which element is the LCP candidate matters as much as when: an LCP that moves later because
      // a reveal held the headline at opacity 0 is a regression this number alone cannot explain.
      const element = entry.element;
      const classes = element && typeof element.className === "string" ? element.className.trim().split(/\s+/)[0] : "";
      perf.lcpElement = element
        ? \`\${element.tagName.toLowerCase()}\${classes ? "." + classes : ""}: \${(element.textContent || entry.url || "").trim().slice(0, 40)}\`
        : entry.url || null;
    });
    observe("layout-shift", (entry) => { if (!entry.hadRecentInput) perf.cls += entry.value; });
    observe("longtask", (entry) => {
      perf.longTasks += 1;
      perf.longTaskBlockingMs += Math.max(0, entry.duration - 50);
    });
  })();`;
}

function median(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

const round = (value, digits = 2) => Number(value.toFixed(digits));

async function startServer(port) {
  assertBuilt();
  const output = [];
  const nextBin = require.resolve("next/dist/bin/next");
  const server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk.toString()));
  server.stderr.on("data", (chunk) => output.push(chunk.toString()));

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(baseUrl)).ok) return { baseUrl, stop: () => stopServer(server) };
    } catch {
      /* still starting */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  server.kill("SIGTERM");
  throw new Error(`\`next start\` did not come up on port ${port}.\n${output.join("")}`);
}

function assertBuilt() {
  if (!existsSync(resolve(root, ".next", "BUILD_ID"))) {
    throw new Error("No production build found. Run `npm run build` first — profiling `next dev` measures the dev server, not the site.");
  }
}

function stopServer(server) {
  return new Promise((done) => {
    if (server.exitCode !== null) return done();
    server.once("exit", () => done());
    server.kill("SIGTERM");
    setTimeout(() => server.kill("SIGKILL"), 5000).unref();
  });
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

function diffMetrics(before, after) {
  const delta = {};
  for (const name of CDP_COUNTERS) delta[name] = Math.round((after[name] ?? 0) - (before[name] ?? 0));
  // CDP reports durations in seconds.
  for (const name of CDP_DURATIONS) delta[name] = round(((after[name] ?? 0) - (before[name] ?? 0)) * 1000, 1);
  return delta;
}

// The trace events that say how much rendering work a phase caused. `Paint` is Blink recording a
// layer's display list on the main thread; `RasterTask` is the compositor turning display lists into
// pixels on worker threads (the cost a needlessly repainted layer really pays); the rest are the
// other stages a frame can be dragged through.
const TRACE_EVENTS = ["Paint", "PrePaint", "RasterTask", "UpdateLayoutTree", "Layout", "CompositeLayers"];

async function startTrace(cdp) {
  const events = [];
  const onData = ({ value }) => {
    for (const event of value) if (TRACE_EVENTS.includes(event.name) && event.ph === "X") events.push(event);
  };
  cdp.on("Tracing.dataCollected", onData);
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu",
  });
  return { events, onData };
}

async function stopTrace(cdp, trace) {
  const complete = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
  await cdp.send("Tracing.end");
  await complete;
  cdp.off("Tracing.dataCollected", trace.onData);
  const summary = {};
  for (const name of TRACE_EVENTS) {
    const matching = trace.events.filter((event) => event.name === name);
    summary[name] = { count: matching.length, ms: round(matching.reduce((total, event) => total + (event.dur || 0), 0) / 1000, 1) };
  }
  return summary;
}

/** Runs `action` while the real frame profiler samples the page, and returns what it saw. */
async function measurePhase(page, cdp, action, options = {}) {
  const trace = options.trace ? await startTrace(cdp) : null;
  const before = await cdpMetrics(cdp);
  await page.evaluate(() => {
    const profiler = window.__ltProfiler.createFrameProfiler({ windowSize: 200_000 });
    window.__ltActiveProfiler = profiler;
    profiler.start();
  });
  const detail = await action();
  const frames = await page.evaluate(() => {
    const profiler = window.__ltActiveProfiler;
    profiler.stop();
    return profiler.snapshot();
  });
  const after = await cdpMetrics(cdp);
  const traced = trace ? { trace: await stopTrace(cdp, trace) } : {};
  // A scroll phase returns how far it actually moved the page; keep it as evidence in the output.
  return {
    frames,
    cdp: diffMetrics(before, after),
    ...traced,
    ...(typeof detail === "number" ? { scrolledPx: detail } : {}),
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * One touch swipe through the browser's real touch pipeline: touchStart, a stream of touchMove
 * events paced by the clock (so the swipe has a genuine, constant speed), touchEnd. This is used
 * instead of CDP's `Input.synthesizeScrollGesture` for touch because that call reports success and
 * scrolls nothing under mobile emulation — an earlier version of this script recorded a minute of
 * "scrolling" per mobile route in which the page never moved.
 */
async function touchSwipe(cdp, x, fromY, toY, durationMs) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
  const started = Date.now();
  for (;;) {
    const progress = Math.min(1, (Date.now() - started) / durationMs);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: fromY + (toY - fromY) * progress }],
    });
    if (progress >= 1) break;
    await sleep(4);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * Scrolls the whole page in one direction by real input (never `scrollTo`/`scrollBy`), and returns
 * how far it actually moved. Throws if it did not get anywhere near the far end: a scroll phase
 * that silently scrolled nothing produces plausible-looking, worthless frame statistics.
 */
async function scrollThrough(page, cdp, viewport, direction) {
  const speed = direction === "down" ? viewport.scrollSpeed : viewport.reverseSpeed;
  const distance = Math.round(viewport.height * 0.7);
  const x = Math.round(viewport.width / 2);
  const y = Math.round(viewport.height * (direction === "down" ? 0.85 : 0.15));
  const position = () => page.evaluate(() => Math.round(window.scrollY));
  const range = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  const startedAt = await position();
  const deadline = Date.now() + 90_000;

  const finished = async () => {
    const scrollY = await position();
    return direction === "down" ? range - scrollY <= 2 : scrollY <= 1;
  };

  while (!(await finished())) {
    if (Date.now() > deadline) throw new Error(`Scrolling ${direction} did not finish within 90s`);
    if (viewport.gesture === "touch") {
      // A finger moving up scrolls the page down, and vice versa.
      const to = direction === "down" ? y - distance : y + distance;
      await touchSwipe(cdp, x, y, to, (distance / speed) * 1000);
    } else {
      await cdp.send("Input.synthesizeScrollGesture", {
        x,
        y,
        // Positive scrolls up; negative scrolls down.
        yDistance: direction === "down" ? -distance : distance,
        speed,
        gestureSourceType: "mouse",
        preventFling: true,
      });
    }
  }

  const moved = Math.abs((await position()) - startedAt);
  const expected = direction === "down" ? range - startedAt : startedAt;
  if (expected > 200 && moved < expected * 0.5) {
    throw new Error(`Scrolling ${direction} moved the page ${moved}px of an expected ${expected}px`);
  }
  return moved;
}

async function sweepPointer(page, viewport, durationMs) {
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const t = (Date.now() - started) / durationMs;
    const x = viewport.width * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * Math.PI * 4)));
    const y = viewport.height * (0.2 + 0.5 * (0.5 + 0.5 * Math.cos(t * Math.PI * 3)));
    await page.mouse.move(x, y);
    await page.waitForTimeout(8);
  }
}

async function readLoadMetrics(page) {
  return page.evaluate(() => {
    const perf = window.__ltPerf;
    const resources = performance.getEntriesByType("resource");
    const bucket = (matches) => {
      const list = resources.filter(matches);
      const sum = (key) => list.reduce((total, entry) => total + (entry[key] || 0), 0);
      return { requests: list.length, encodedBytes: sum("encodedBodySize"), decodedBytes: sum("decodedBodySize") };
    };
    const describe = (element) => {
      if (!element || !element.tagName) return null;
      const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/)[0] : "";
      return element.tagName.toLowerCase() + (classes ? `.${classes}` : "");
    };
    return {
      fcpMs: perf.fcp,
      lcpMs: perf.lcp,
      lcpElement: perf.lcpElement,
      cls: perf.cls,
      longTasks: perf.longTasks,
      longTaskBlockingMs: perf.longTaskBlockingMs,
      js: bucket((entry) => /\.js(\?|$)/.test(entry.name)),
      css: bucket((entry) => /\.css(\?|$)/.test(entry.name)),
      domNodes: document.getElementsByTagName("*").length,
      documentHeight: document.documentElement.scrollHeight,
      brokenImages: Array.from(document.images)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src),
      runningAnimations: document
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => ({
          kind: animation.constructor.name,
          name: animation.animationName || animation.transitionProperty || animation.id || "",
          target: describe(animation.effect && animation.effect.target),
        })),
      environment: {
        pointerCoarse: matchMedia("(pointer: coarse)").matches,
        hoverNone: matchMedia("(hover: none)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
      },
    };
  });
}

async function profileOnce(browser, baseUrl, route, viewport, options) {
  const context = await browser.newContext({
    locale: "en-GB",
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    reducedMotion: options.reduced ? "reduce" : "no-preference",
  });
  try {
    await context.addInitScript({ content: buildInitScript() });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    if (options.cpuThrottle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: options.cpuThrottle });

    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
    if (response?.status() !== 200) throw new Error(`${route} returned ${response?.status()}`);
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(() => Array.from(document.images).every((image) => image.complete), null, { timeout: 10_000 })
      .catch(() => undefined);
    // Let the entrance choreography (CSS rise sequence, hero settle) finish before measuring.
    await page.waitForTimeout(options.quick ? 800 : 1800);

    const load = await readLoadMetrics(page);

    const phases = {};
    phases.idle = await measurePhase(page, cdp, () => page.waitForTimeout(options.quick ? 1000 : 2500), options);
    if (!viewport.hasTouch) {
      phases.pointer = await measurePhase(page, cdp, () => sweepPointer(page, viewport, options.quick ? 800 : 1800), options);
    }
    phases.scrollDown = await measurePhase(page, cdp, () => scrollThrough(page, cdp, viewport, "down"), options);
    // Scene state must survive a fast reverse scroll (plan11.md review focus 5), so measure it.
    phases.scrollUp = await measurePhase(page, cdp, () => scrollThrough(page, cdp, viewport, "up"), options);

    const finalMetrics = await cdpMetrics(cdp);
    const clsAfterScroll = await page.evaluate(() => window.__ltPerf.cls);
    return {
      load,
      clsAfterScroll,
      phases,
      domNodesAtEnd: finalMetrics.Nodes,
      jsHeapMB: round((finalMetrics.JSHeapUsedSize ?? 0) / 1048576, 1),
      pageErrors,
      consoleErrors,
    };
  } finally {
    await context.close();
  }
}

const FRAME_KEYS = [
  "refreshHz",
  "averageFrameMs",
  "p95FrameMs",
  "maxFrameMs",
  "droppedFramePercent",
  "droppedFrames",
  "longTasks",
  "longTaskBlockingMs",
  "frames",
];

function aggregate(runs) {
  const phaseNames = Object.keys(runs[0].phases);
  const phases = {};
  for (const phase of phaseNames) {
    const entry = { frames: {}, cdp: {} };
    for (const key of FRAME_KEYS) entry.frames[key] = round(median(runs.map((run) => run.phases[phase].frames[key])));
    for (const key of [...CDP_COUNTERS, ...CDP_DURATIONS]) {
      entry.cdp[key] = round(median(runs.map((run) => run.phases[phase].cdp[key])), 1);
    }
    if (runs[0].phases[phase].trace) {
      entry.trace = {};
      for (const name of TRACE_EVENTS) {
        entry.trace[name] = {
          count: Math.round(median(runs.map((run) => run.phases[phase].trace[name].count))),
          ms: round(median(runs.map((run) => run.phases[phase].trace[name].ms)), 1),
        };
      }
    }
    if (runs[0].phases[phase].scrolledPx !== undefined) {
      entry.scrolledPx = Math.round(median(runs.map((run) => run.phases[phase].scrolledPx)));
    }
    phases[phase] = entry;
  }
  const loadKeys = ["fcpMs", "lcpMs", "cls", "longTasks", "longTaskBlockingMs", "domNodes", "documentHeight"];
  const load = {};
  for (const key of loadKeys) load[key] = round(median(runs.map((run) => run.load[key])), 3);
  for (const bucket of ["js", "css"]) {
    load[bucket] = {
      requests: Math.round(median(runs.map((run) => run.load[bucket].requests))),
      encodedKB: round(median(runs.map((run) => run.load[bucket].encodedBytes)) / 1024, 1),
      decodedKB: round(median(runs.map((run) => run.load[bucket].decodedBytes)) / 1024, 1),
    };
  }
  // The element that was the LCP candidate in the run whose LCP was the median one is not knowable
  // from medians of numbers; the first run's is representative unless the runs disagree, in which
  // case the distinct answers are listed so the disagreement is visible rather than averaged away.
  load.lcpElement = [...new Set(runs.map((run) => run.load.lcpElement).filter(Boolean))].join(" | ") || null;
  load.clsAfterScroll = round(median(runs.map((run) => run.clsAfterScroll)), 3);
  load.jsHeapMB = round(median(runs.map((run) => run.jsHeapMB)), 1);
  return {
    load,
    // Animations still running at rest are the continuous work later tasks are meant to remove or
    // suspend; report the first run's list rather than a "median" of names.
    runningAnimationsAtRest: runs[0].load.runningAnimations,
    brokenImages: runs[0].load.brokenImages,
    environment: runs[0].load.environment,
    phases,
    pageErrors: runs.flatMap((run) => run.pageErrors),
    consoleErrors: [...new Set(runs.flatMap((run) => run.consoleErrors))],
  };
}

function summaryTable(results) {
  const lines = [];
  const header = [
    "route".padEnd(16),
    "viewport".padEnd(18),
    "LCP ms".padStart(7),
    "CLS".padStart(6),
    "JS KB gz".padStart(9),
    "down p95".padStart(9),
    "down drop%".padStart(11),
    "up p95".padStart(7),
    "up drop%".padStart(9),
    "idle drop%".padStart(11),
    "long tasks".padStart(11),
    "anims".padStart(6),
  ].join(" ");
  lines.push(header, "-".repeat(header.length));
  for (const result of results) {
    const down = result.phases.scrollDown.frames;
    const up = result.phases.scrollUp.frames;
    const idle = result.phases.idle.frames;
    const longTasks = Object.values(result.phases).reduce((total, phase) => total + phase.frames.longTasks, 0);
    lines.push(
      [
        result.route.padEnd(16),
        result.viewport.padEnd(18),
        String(Math.round(result.load.lcpMs)).padStart(7),
        result.load.cls.toFixed(3).padStart(6),
        result.load.js.encodedKB.toFixed(0).padStart(9),
        down.p95FrameMs.toFixed(1).padStart(9),
        down.droppedFramePercent.toFixed(1).padStart(11),
        up.p95FrameMs.toFixed(1).padStart(7),
        up.droppedFramePercent.toFixed(1).padStart(9),
        idle.droppedFramePercent.toFixed(1).padStart(11),
        String(longTasks).padStart(11),
        String(result.runningAnimationsAtRest.length).padStart(6),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = options.baseUrl ? null : await startServer(options.port);
  const baseUrl = options.baseUrl ?? server.baseUrl;

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      // Keep timers and rendering at full rate however the window is (not) shown.
      args: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });

    const gpu = await (async () => {
      const probe = await browser.newPage();
      try {
        return await probe.evaluate(() => {
          const gl = document.createElement("canvas").getContext("webgl");
          const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
          return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl ? "webgl (renderer hidden)" : "no webgl";
        });
      } finally {
        await probe.close();
      }
    })();

    const results = [];
    for (const viewportName of options.viewports) {
      const viewport = VIEWPORTS[viewportName];
      for (const route of options.routes) {
        const runs = [];
        for (let run = 0; run < options.runs; run += 1) {
          process.stdout.write(`  ${route} @ ${viewport.name} run ${run + 1}/${options.runs}\n`);
          runs.push(await profileOnce(browser, baseUrl, route, viewport, options));
        }
        results.push({ route, viewport: viewport.name, ...aggregate(runs), runs });
      }
    }

    let commit = "unknown";
    try {
      commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim();
    } catch {
      /* not a git checkout */
    }

    const report = {
      meta: {
        label: options.label,
        generatedAt: new Date().toISOString(),
        commit,
        node: process.version,
        chromium: browser.version(),
        glRenderer: gpu,
        baseUrl,
        runsPerRoute: options.runs,
        cpuThrottle: options.cpuThrottle,
        traced: options.trace,
        reducedMotion: options.reduced,
        quick: options.quick,
        note:
          "Frame numbers are only comparable between runs on the same machine. A software GL renderer " +
          "(SwiftShader) is far slower than a real GPU: read absolute values as a lower bound and the " +
          "before/after difference as the result. Cadence is inferred from observed frames (see " +
          "lib/motion/frameProfiler.ts), not read from the display.",
      },
      results,
    };

    await mkdir(options.out, { recursive: true });
    const jsonPath = resolve(options.out, `${options.label}.json`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const table = summaryTable(results);
    await writeFile(resolve(options.out, `${options.label}.txt`), `${table}\n`);

    console.log(`\n${table}\n`);
    console.log(`Chromium ${report.meta.chromium} · GL renderer: ${gpu} · commit ${commit}`);
    console.log(`Wrote ${jsonPath}`);
  } finally {
    await browser?.close();
    await server?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
