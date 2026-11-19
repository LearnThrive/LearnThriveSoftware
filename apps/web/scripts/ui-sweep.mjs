/**
 * UI sweep capture (docs/ui-sweep/FINDINGS.md): screenshots of every signed-in route for each role, at four widths, in light and dark,
 * plus an axe (WCAG 2 A/AA) run per route. Run against a development server (in-memory seed data only):
 *
 *   node --import tsx scripts/ui-sweep.mjs <before|after> [--base http://localhost:3105] [--only admin,tutor] [--axe-only]
 *
 * The development seed names its demo people after real testers. Every screenshot masks those names first (text, form values
 * and labels), replacing each word with a synthetic one of the same length and initial, so layouts are unchanged and no real
 * name reaches an image. The names are read from the seed itself, never written down here. The output folders are gitignored.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { TEAM } from "../../../packages/data/src/inMemoryProvider.ts";
import { DEV_ACCOUNTS } from "../src/lib/dev/accounts.ts";
import { SITE_BANK_DETAILS } from "../src/lib/bank/siteBankDetails.ts";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const args = process.argv.slice(2);
const phase = args[0] === "after" ? "after" : "before";
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = flag("--base") ?? "http://localhost:3105";
const only = flag("--only")?.split(",");
const axeOnly = args.includes("--axe-only");
const match = flag("--match");
const outDir = resolve(import.meta.dirname, "..", "..", "..", "docs", "ui-sweep", phase);

const VIEWPORTS = [
  { name: "375", width: 375, height: 812 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
  { name: "2560", width: 2560, height: 1440 },
];
const THEMES = ["light", "dark"];

// ---- Name masking -------------------------------------------------------------------------------------------------------------
const SYNTHETIC = "orelanistumbadey";
function pseudo(word, seed) {
  let out = word[0];
  for (let i = 1; i < word.length; i += 1) out += SYNTHETIC[(seed + i * 3) % SYNTHETIC.length];
  return word[0] === word[0].toUpperCase() ? out : out.toLowerCase();
}
const GENERIC = new Set(["Admin", "Tutor", "Client", "Student", "Parent", "Test", "Junior", "Library", "Member", "New", "Visitor", "Disabled", "Account", "and", "junior", "tutor", "learner", "Sam", "Pat", "Robin", "Parent-Test", "Junior-Test", "Peer-Test"]);
const realWords = new Set();
for (const p of TEAM) { p.name.split(/\s+/).forEach((w) => realWords.add(w)); realWords.add(p.key); }
for (const a of DEV_ACCOUNTS) a.name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).forEach((w) => realWords.add(w));
const MASKS = [...realWords].filter((w) => w.length > 2 && !GENERIC.has(w)).sort((a, b) => b.length - a.length)
  .map((w, i) => [w, pseudo(w, i * 5)]);
// The company's real bank account (the parent Fees page shows it): read from the site's own copy, replaced with obviously fake values.
const BANK = SITE_BANK_DETAILS;
const sortCodeShown = BANK.sortCode.replace(/^(\d\d)(\d\d)(\d\d)$/, "$1-$2-$3");
MASKS.unshift([BANK.accountNumber, "12345678"], [sortCodeShown, "00-00-00"], [BANK.sortCode, "000000"], [BANK.bankName, "EXAMPLE BANK PLC"]);
/** Values that must never reach a screenshot: if any survives masking, the screenshot is skipped and the manifest says so. */
const FORBIDDEN = [BANK.accountNumber, sortCodeShown, BANK.sortCode, BANK.bankName, ...realWords].filter((w) => w.length > 2 && !GENERIC.has(w));

function maskInPage(masks) {
  const patterns = masks.map(([from, to]) => [new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to]);
  const swap = (s) => patterns.reduce((acc, [re, to]) => acc.replace(re, (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to.toLowerCase())), s);
  const walk = (root) => {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) { const v = swap(n.nodeValue ?? ""); if (v !== n.nodeValue) n.nodeValue = v; }
    root.querySelectorAll?.("input, textarea").forEach((el) => { const v = swap(el.value); if (v !== el.value) el.value = v; });
    root.querySelectorAll?.("[title], [aria-label], [placeholder], [alt]").forEach((el) => {
      for (const attr of ["title", "aria-label", "placeholder", "alt"]) { const a = el.getAttribute(attr); if (a) el.setAttribute(attr, swap(a)); }
    });
  };
  walk(document.body);
  document.querySelectorAll("iframe").forEach((f) => { try { if (f.contentDocument?.body) walk(f.contentDocument.body); } catch { /* cross-origin */ } });
}

// ---- Routes ---------------------------------------------------------------------------------------------------------------------
const LESSON_UP = "/dashboard/lessons/lesson-gcse-maths-upcoming";
const LESSON_DONE = "/dashboard/lessons/lesson-gcse-maths-completed";
const PROGRESS = "/dashboard/progress/student-ayaan-ahmed";
/** `follow`: open the first link on that page matching the pattern (detail pages whose ids the seed makes at random). */
const ROLES = {
  admin: {
    login: "dev.admin",
    routes: [
      "/dashboard", "/dashboard/calendar", "/dashboard/lessons", LESSON_UP, LESSON_DONE, "/dashboard/meetings",
      "/dashboard/admin/people/students", "/dashboard/admin/people/clients", "/dashboard/admin/people/tutors",
      "/dashboard/admin/students/student-ayaan-ahmed", "/dashboard/admin/clients/client-sarah-ahmed", "/dashboard/admin/tutors/tutor-jamie-patel",
      "/dashboard/admin/vetting", "/dashboard/admin/roles", "/dashboard/admin/careers",
      { from: "/dashboard/admin/careers", follow: /\/dashboard\/admin\/careers\/[^/]+$/, name: "admin-careers-detail" },
      "/dashboard/admin/assignments", "/dashboard/admin/assignments/assignment-gcse-maths-ayaan", "/dashboard/admin/lessons/new",
      "/dashboard/reports", "/dashboard/admin/billing", "/dashboard/admin/billing/client-sarah-ahmed", "/dashboard/admin/billing/settings",
      "/dashboard/admin/billing/tutor-pay", "/dashboard/admin/billing/tutor-rates", "/dashboard/notifications", "/dashboard/activity",
      "/dashboard/admin/concerns", { from: "/dashboard/admin/concerns", follow: /\/dashboard\/admin\/concerns\/[^/]+$/, name: "admin-concerns-detail" },
      "/dashboard/settings", PROGRESS, "/403", "/dashboard/lessons/nonexistent-id", "/dashboard/does-not-exist",
      { path: "/dashboard", action: "drawer", name: "dashboard-drawer", widths: ["375"] },
      { path: "/dashboard", action: "usermenu", name: "dashboard-usermenu", widths: ["375", "1440"] },
      { path: "/dashboard/calendar", action: "peek", name: "calendar-peek", widths: ["375", "1440"] },
      { path: "/dev/classroom", name: "classroom-lab" },
    ],
  },
  tutor: {
    login: "dev.tutor",
    routes: [
      "/dashboard", "/dashboard/calendar", "/dashboard/lessons", LESSON_UP, LESSON_DONE, "/dashboard/students", "/dashboard/reports",
      "/dashboard/meetings", "/dashboard/tutor/availability", "/dashboard/tutor/subjects", "/dashboard/notifications", "/dashboard/concerns",
      "/dashboard/settings", PROGRESS, `${LESSON_UP}/classroom`,
    ],
  },
  parent: {
    login: "dev.client",
    routes: [
      "/dashboard", "/dashboard/children", "/dashboard/calendar", "/dashboard/lessons", LESSON_UP, "/dashboard/reports", "/dashboard/billing",
      "/dashboard/notifications", "/dashboard/settings", PROGRESS, "/account", "/account/learners", "/library", "/library/search", "/library/ai",
    ],
  },
  student: {
    login: "dev.student",
    routes: [
      "/dashboard", "/dashboard/calendar", "/dashboard/lessons", LESSON_UP, "/dashboard/reports", "/dashboard/notifications",
      "/dashboard/settings", "/account", "/library", "/library/ai", `${LESSON_UP}/classroom`,
    ],
  },
};

const slug = (p) => p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "") || "root";

async function login(page, username) {
  const account = DEV_ACCOUNTS.find((a) => a.username === username);
  await page.request.post(`${base}/api/auth/logout`);
  await page.goto(`${base}/login`, { timeout: 120_000 });
  await page.getByLabel("Username").fill(username);
  await page.locator('input[name="password"]').fill(account.password);
  await Promise.all([page.waitForURL(/\/(dashboard|library|account)/, { timeout: 120_000 }), page.getByRole("button", { name: "Sign in" }).click()]);
}

async function settle(page) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
}

async function act(page, action) {
  if (action === "drawer") await page.getByRole("button", { name: "Open navigation" }).click();
  if (action === "usermenu") await page.getByRole("button", { name: "Account menu" }).click();
  if (action === "peek") { await page.locator(".fc-event").first().click(); await page.locator(".lesson-peek__panel").waitFor({ timeout: 10_000 }).catch(() => {}); }
  await page.waitForTimeout(400);
}

async function runAxe(page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")) }));
  });
}

const manifest = [];
const browser = await chromium.launch();
try {
  for (const [role, def] of Object.entries(ROLES)) {
    if (only && !only.includes(role)) continue;
    for (const theme of THEMES) {
      const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 300)));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
      await login(page, def.login);
      for (const entry of def.routes) {
        const route = typeof entry === "string" ? { path: entry } : entry;
        const name = route.name ?? slug(route.path ?? route.from);
        if (match && !(route.path ?? route.from).includes(match)) continue;
        let target = route.path;
        if (route.follow) {
          await page.goto(`${base}${route.from}`, { timeout: 120_000 });
          const href = await page.locator("a[href]").evaluateAll((as, src) => as.map((a) => a.getAttribute("href")).find((h) => new RegExp(src).test(h ?? "")), route.follow.source);
          if (!href) { manifest.push({ role, theme, name, skipped: "no detail link on the list page" }); continue; }
          target = href;
        }
        for (const vp of VIEWPORTS) {
          if (route.widths && !route.widths.includes(vp.name)) continue;
          if (axeOnly && !["375", "1440"].includes(vp.name)) continue;
          errors.length = 0;
          await page.setViewportSize({ width: vp.width, height: vp.height });
          let status = 0;
          try {
            const res = await page.goto(`${base}${target}`, { timeout: 120_000, waitUntil: "domcontentloaded" });
            status = res?.status() ?? 0;
            await settle(page);
            if (route.action) await act(page, route.action);
          } catch (error) { errors.push(`navigation: ${String(error).slice(0, 200)}`); }
          const metrics = await page.evaluate(() => ({
            url: location.pathname,
            overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
            wide: [...document.querySelectorAll("main *, .app-topbar *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; })
              .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`),
            smallTargets: window.innerWidth <= 400 ? [...document.querySelectorAll("a, button, [role=button], input, select")].filter((el) => {
              const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(el).visibility !== "hidden";
            }).length : undefined,
          })).catch(() => ({}));
          let axe;
          if (vp.name === "1440" || vp.name === "375") axe = await runAxe(page).catch((e) => [{ id: "axe-failed", help: String(e).slice(0, 200) }]);
          const findLeak = () => page.evaluate((words) => {
            const text = `${document.body.innerText} ${[...document.querySelectorAll("input, textarea")].map((el) => el.value).join(" ")}`;
            return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
          }, FORBIDDEN).catch(() => true);
          await page.evaluate(maskInPage, MASKS).catch(() => {});
          let leaked = await findLeak();
          // A late re-render (hydration, a client fetch) can put a name back after masking: settle, mask again, check again.
          if (leaked) { await page.waitForTimeout(800); await page.evaluate(maskInPage, MASKS).catch(() => {}); leaked = await findLeak(); }
          const file = `${role}__${name}__${vp.name}__${theme}.jpg`;
          if (leaked) errors.push("screenshot skipped: a real name or bank detail survived masking");
          if (!axeOnly && !leaked) {
            await mkdir(outDir, { recursive: true });
            await page.screenshot({ path: resolve(outDir, file), fullPage: true, type: "jpeg", quality: 55 }).catch((e) => errors.push(`screenshot: ${String(e).slice(0, 120)}`));
          }
          manifest.push({ role, theme, name, path: target, width: vp.width, status, file, ...metrics, axe, errors: [...new Set(errors)] });
          process.stdout.write(`${role} ${theme} ${vp.name} ${target} ${status}${axe?.length ? ` axe:${axe.length}` : ""}\n`);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await mkdir(outDir, { recursive: true });
  const name = `manifest${only ? `-${only.join("-")}` : ""}${match ? `-${slug(match)}` : ""}.json`;
  // The manifest records routes, sizes and axe results only; masking applies to screenshots, so names never land in it.
  await writeFile(resolve(outDir, name), JSON.stringify(manifest, null, 1));
}
