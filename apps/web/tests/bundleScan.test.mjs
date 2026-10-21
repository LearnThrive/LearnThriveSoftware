import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { needlesFor, scanForLeaks } from "../scripts/check-bundle.mjs";

// The search behind `npm run check:bundle` (which builds with sentinel secrets and searches what a browser can receive). The full
// build is too slow for the unit suite, so this proves the search itself: it finds a value, a name, nested files and binary files,
// stays quiet on clean output, honours the "what a browser can receive" filter, and reports names, never values.

const SENTINELS = { SUPABASE_SERVICE_ROLE_KEY: "SENTINEL_SUPABASE_SERVICE_ROLE_KEY_abc123", DATABASE_URL: "postgresql://sentinel_user:SENTINEL_DATABASE_URL_abc123@sentinel-host.invalid:6543/postgres" };
const NEEDLES = needlesFor(SENTINELS);

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "lt-bundle-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "latin1");
  }
  return dir;
}

test("a clean build output has no hits", () => {
  const dir = tree({ "static/chunks/app.js": "console.log('hello', process.env.NEXT_PUBLIC_SITE_URL)", "server/app/index.html": "<html>fine</html>", "static/css/a.css": "a{color:red}" });
  try {
    const { hits, scanned } = scanForLeaks(dir, NEEDLES);
    assert.deepEqual(hits, []);
    assert.equal(scanned, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a secret's value or its name in client code or a prerendered page is found, wherever it is nested", () => {
  const dir = tree({
    "static/chunks/deep/er/page.js": `var k="${SENTINELS.SUPABASE_SERVICE_ROLE_KEY}";`,
    "static/chunks/other.js": "var u = process.env.DATABASE_URL;",
    "server/app/library/page.html": `<script>{"url":"${SENTINELS.DATABASE_URL}"}</script>`,
    "server/app/clean.html": "<p>nothing</p>",
    "static/media/font.woff2": `\u0000\u0001binary ${SENTINELS.SUPABASE_SERVICE_ROLE_KEY} ÿ`,
  });
  try {
    const { hits } = scanForLeaks(dir, NEEDLES);
    const by = (file) => hits.filter((h) => h.file.replace(/\\/g, "/") === file).map((h) => h.label).sort();
    // (A sentinel value contains its variable's name, so a value hit is reported with the name hit too.)
    assert.deepEqual(by("static/chunks/deep/er/page.js"), ["the name SUPABASE_SERVICE_ROLE_KEY", "the value of SUPABASE_SERVICE_ROLE_KEY"]);
    assert.deepEqual(by("static/chunks/other.js"), ["the name DATABASE_URL"], "a name in client code means server-only code was bundled for the browser");
    assert.deepEqual(by("server/app/library/page.html"), ["the name DATABASE_URL", "the value of DATABASE_URL"]);
    assert.deepEqual(by("server/app/clean.html"), []);
    assert.deepEqual(by("static/media/font.woff2"), ["the name SUPABASE_SERVICE_ROLE_KEY", "the value of SUPABASE_SERVICE_ROLE_KEY"], "binary files are searched too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only what a browser can receive is searched: server-only output may mention a secret", () => {
  const dir = tree({ "server/chunks/db.js": `process.env.DATABASE_URL // ${SENTINELS.DATABASE_URL}`, "static/chunks/app.js": "ok" });
  try {
    const reachable = (file) => /[\\/]static[\\/]/.test(file);
    assert.deepEqual(scanForLeaks(dir, NEEDLES, { accept: reachable }).hits, [], "the server chunk is not sent to browsers");
    assert.equal(scanForLeaks(dir, NEEDLES).hits.length > 0, true, "without the filter it would be found");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a report names what was found and never prints a secret's value; a missing folder is just empty", () => {
  const dir = tree({ "static/a.js": SENTINELS.SUPABASE_SERVICE_ROLE_KEY });
  try {
    const { hits } = scanForLeaks(dir, NEEDLES);
    const printed = JSON.stringify(hits);
    assert.ok(!printed.includes("SENTINEL_"), "labels hold names only");
    assert.match(printed, /the value of SUPABASE_SERVICE_ROLE_KEY/);
    assert.deepEqual(scanForLeaks(join(dir, "does-not-exist"), NEEDLES), { hits: [], scanned: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
