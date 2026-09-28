import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

// plan11.md task 3: the public site has ONE Motion runtime. These are architecture guards, not
// behaviour tests — they fail the moment someone re-introduces a per-component <LazyMotion>, or
// pulls in the full `motion.*` components that LazyMotion exists to keep out of the bundle. The
// behaviour (the runtime actually being present, tiers following the device, no hydration
// warnings) is covered by tests-e2e/marketing-motion.spec.ts.

const root = resolve(import.meta.dirname, "..");
const srcDir = join(root, "src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

const files = sourceFiles(srcDir).map((path) => ({
  path,
  name: relative(root, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8"),
}));

const filesMatching = (pattern) => files.filter(({ source }) => pattern.test(source)).map(({ name }) => name);

test("<LazyMotion> is mounted in exactly one place: MotionRuntime", () => {
  const usages = filesMatching(/<LazyMotion\b|import\s*\{[^}]*\bLazyMotion\b[^}]*\}\s*from/);
  assert.deepEqual(usages, ["src/components/motion/MotionRuntime.tsx"]);
});

test("<MotionConfig> is mounted in exactly one place: MotionRuntime", () => {
  const usages = filesMatching(/<MotionConfig\b|import\s*\{[^}]*\bMotionConfig\b[^}]*\}\s*from/);
  assert.deepEqual(usages, ["src/components/motion/MotionRuntime.tsx"]);
});

test("nothing imports the full `motion` component — every animated element is `m.*` under LazyMotion", () => {
  const offenders = filesMatching(
    /import\s*\{[^}]*\bmotion\b[^}]*\}\s*from\s*["']framer-motion["']|import\s*\*\s*as\s+motion\s+from\s*["']framer-motion/,
  );
  assert.deepEqual(offenders, []);
});

test("the shared runtime uses the synchronous domAnimation bundle, not domMax and not an async load", () => {
  const runtime = files.find(({ name }) => name === "src/components/motion/MotionRuntime.tsx").source;
  assert.match(runtime, /features=\{domAnimation\}/);
  // Usage, not mention: the runtime's own comment explains why domMax is absent.
  assert.doesNotMatch(runtime, /features=\{domMax\}|import\s*\{[^}]*\bdomMax\b/);
  // An async feature bundle would leave `m` components in their (opacity: 0) initial state until
  // it arrived, so content would wait on a download.
  assert.doesNotMatch(runtime, /features=\{\s*\(\)\s*=>/);
});

test("the shared runtime is strict and defers to the visitor's reduced-motion setting", () => {
  const runtime = files.find(({ name }) => name === "src/components/motion/MotionRuntime.tsx").source;
  assert.match(runtime, /<LazyMotion[^>]*\bstrict\b/);
  assert.match(runtime, /reducedMotion="user"/);
});

test("the (public) layout wraps the shell in MotionRuntime", () => {
  const layout = files.find(({ name }) => name === "src/app/(public)/layout.tsx").source;
  assert.match(layout, /<MotionRuntime>[\s\S]*<PublicShell>[\s\S]*<\/MotionRuntime>/);
});

test("the authenticated app and the classroom do not pull in the marketing motion runtime", () => {
  const offenders = files
    .filter(({ name }) => name.startsWith("src/app/(app)/") || name.startsWith("src/features/classroom/"))
    .filter(({ source }) => /components\/motion\/|lib\/motion\/(activity|capabilities|frameProfiler|debug)/.test(source))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);
});
