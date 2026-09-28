/**
 * Turns the JSON that scripts/profile-motion.mjs writes into markdown, so a measurement can be
 * pasted into a document and a before/after pair can be read at a glance (plan11.md tasks 1 and 20).
 *
 *   node scripts/compare-motion-profiles.mjs artifacts/motion-profile/baseline.json
 *       a summary of one run
 *   node scripts/compare-motion-profiles.mjs artifacts/motion-profile/baseline.json artifacts/motion-profile/after.json
 *       the same tables with each cell as "before → after (change)"
 *
 * Rows are matched on route + viewport; a row present in only one file is skipped with a note.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [beforePath, afterPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
if (!beforePath) {
  console.error("usage: compare-motion-profiles.mjs <report.json> [after.json]");
  process.exit(1);
}

const load = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const before = load(beforePath);
const after = afterPath ? load(afterPath) : null;
const key = (row) => `${row.route}|${row.viewport}`;
const afterByKey = after ? new Map(after.results.map((row) => [key(row), row])) : null;

const number = (value, digits = 0) => (Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : "–");

/** "171" alone, or "171 → 12 (−93%)" when there is an after value to compare with. */
function cell(pick, digits = 0, { absolute = false } = {}) {
  return (row, other) => {
    const a = pick(row);
    if (!other) return number(a, digits);
    const b = pick(other);
    if (a === b) return `${number(a, digits)} → ${number(b, digits)}`;
    const change = absolute
      ? `${b - a >= 0 ? "+" : "−"}${number(Math.abs(b - a), digits + 1)}`
      : a === 0
        ? "new"
        : `${b - a >= 0 ? "+" : "−"}${number(Math.abs(((b - a) / a) * 100), 0)}%`;
    return `${number(a, digits)} → ${number(b, digits)} (${change})`;
  };
}

const phaseFrames = (phase, field) => (row) => row.phases[phase]?.frames[field] ?? NaN;
const phaseCdp = (phase, field) => (row) => row.phases[phase]?.cdp[field] ?? NaN;

const tables = [
  {
    title: "Load and size",
    columns: [
      ["LCP ms", cell((r) => r.load.lcpMs)],
      ["FCP ms", cell((r) => r.load.fcpMs)],
      ["CLS", cell((r) => r.load.cls, 3, { absolute: true })],
      ["JS KB (gz)", cell((r) => r.load.js.encodedKB, 1)],
      ["CSS KB (gz)", cell((r) => r.load.css.encodedKB, 1)],
      ["Long tasks / blocking ms", (r, o) => {
        const one = (x) => `${x.load.longTasks} / ${number(x.load.longTaskBlockingMs)}`;
        return o ? `${one(r)} → ${one(o)}` : one(r);
      }],
      ["DOM nodes", cell((r) => r.load.domNodes)],
    ],
  },
  ...["scrollDown", "scrollUp"].map((phase) => ({
    title: phase === "scrollDown" ? "Scrolling down the whole page" : "Scrolling back up (fast reverse)",
    columns: [
      ["p95 frame ms", cell(phaseFrames(phase, "p95FrameMs"), 1)],
      ["Dropped %", cell(phaseFrames(phase, "droppedFramePercent"), 1, { absolute: true })],
      ["Layouts", cell(phaseCdp(phase, "LayoutCount"))],
      ["Style recalcs", cell(phaseCdp(phase, "RecalcStyleCount"))],
      ["Script ms", cell(phaseCdp(phase, "ScriptDuration"), 0)],
      ["Main-thread task ms", cell(phaseCdp(phase, "TaskDuration"), 0)],
    ],
  })),
  {
    title: "At rest (nothing scrolling, nothing moving the pointer)",
    columns: [
      ["Dropped %", cell(phaseFrames("idle", "droppedFramePercent"), 1, { absolute: true })],
      ["Style recalcs per frame", cell((r) => phaseCdp("idle", "RecalcStyleCount")(r) / Math.max(1, phaseFrames("idle", "frames")(r)), 2, { absolute: true })],
      ["Script ms", cell(phaseCdp("idle", "ScriptDuration"), 1)],
      ["Animations still running", (r, o) => {
        const names = (x) => (x.runningAnimationsAtRest.length ? x.runningAnimationsAtRest.map((a) => a.name.replace(/^.*__/, "")).join(", ") : "none");
        return o ? `${names(r)} → ${names(o)}` : names(r);
      }],
    ],
  },
];

const out = [];
out.push(`_${before.meta.label}${after ? ` vs ${after.meta.label}` : ""} · Chromium ${before.meta.chromium} · ${before.meta.glRenderer}_`);
out.push(`_commit ${before.meta.commit}${after ? ` → ${after.meta.commit}` : ""} · ${before.meta.runsPerRoute} run(s) per row, medians · CPU throttle ${before.meta.cpuThrottle ?? 1}×${after && (after.meta.cpuThrottle ?? 1) !== (before.meta.cpuThrottle ?? 1) ? ` (after: ${after.meta.cpuThrottle}×)` : ""}_`);

for (const table of tables) {
  out.push("", `### ${table.title}`, "");
  out.push(`| Route | Viewport | ${table.columns.map(([name]) => name).join(" | ")} |`);
  out.push(`| --- | --- | ${table.columns.map(() => "---").join(" | ")} |`);
  for (const row of before.results) {
    const other = afterByKey ? afterByKey.get(key(row)) : null;
    if (afterByKey && !other) continue;
    out.push(`| \`${row.route}\` | ${row.viewport} | ${table.columns.map(([, render]) => render(row, other)).join(" | ")} |`);
  }
}

if (afterByKey) {
  const skipped = before.results.filter((row) => !afterByKey.has(key(row))).map((row) => `${row.route} @ ${row.viewport}`);
  if (skipped.length) out.push("", `_Not in the after run, skipped: ${skipped.join(", ")}_`);
}

console.log(out.join("\n"));
