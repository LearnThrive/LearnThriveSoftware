#!/usr/bin/env node
/**
 * Proves no secret can reach a browser (plan20 section 8) by looking at the BUILT output, not just the source.
 *
 *   npm run check:bundle              builds into .next-bundle-check with made-up secret values, then searches what a browser can receive
 *   npm run check:bundle -- --reuse   searches an existing .next-bundle-check build (skips the slow build)
 *
 * Every secret variable in the registry is given a unique, recognisable sentinel value for the build. Then everything that is sent to a
 * browser is searched for those sentinels AND for the secret variables' names: the client JavaScript and CSS (static/), prerendered
 * pages and their data (server/app/**.html, .rsc, .json), and the public folder. A name in client code means server-only code was
 * bundled for the browser even if its value was not inlined. Server-only output (server/chunks, server/pages code) is not searched:
 * it never leaves the server.
 *
 * It makes no network call and reads no .env file: the sentinel values are generated here, in memory, for this run.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REGISTRY } from "./env-registry.mjs";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = ".next-bundle-check";

/** Every file under `dir` containing one of the needles ({ text, label }). Returns { hits: [{ file, label }], scanned }. Read as latin1 so binaries are safe. */
export function scanForLeaks(dir, needles, { accept = () => true } = {}) {
  const hits = [];
  let scanned = 0;
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (accept(full)) {
        scanned += 1;
        const text = readFileSync(full, "latin1");
        for (const needle of needles) if (text.includes(needle.text)) hits.push({ file: relative(dir, full), label: needle.label });
      }
    }
  };
  if (existsSync(dir)) visit(dir);
  return { hits, scanned };
}

/** The needles: for each secret variable its sentinel value and its name, labelled by name so a report never prints a value. */
export function needlesFor(sentinels) {
  return Object.entries(sentinels).flatMap(([name, value]) => [
    { text: value, label: `the value of ${name}` },
    { text: name, label: `the name ${name}` },
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reuse = process.argv.includes("--reuse");
  const secrets = REGISTRY.filter((v) => v.secret).map((v) => v.name);
  const run = randomBytes(6).toString("hex");
  const sentinels = Object.fromEntries(secrets.map((name) => [name, `SENTINEL_${name}_${run}`]));
  // URL-shaped secrets get a plausible shape so the build's own validation does not reject them, with the sentinel inside.
  sentinels.DATABASE_URL = `postgresql://sentinel_user:SENTINEL_DATABASE_URL_${run}@sentinel-host.invalid:6543/postgres`;
  const dist = join(WEB, DIST);
  if (!reuse) {
    rmSync(dist, { recursive: true, force: true });
    console.log(`Building into ${DIST} with ${secrets.length} sentinel secrets (this takes a minute or two)...`);
    // Next is started directly (no shell), so nothing is concatenated into a command line.
    const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
    const build = spawnSync(process.execPath, [next, "build"], { cwd: WEB, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", env: { ...process.env, ...sentinels, NEXT_DIST_DIR: DIST, NODE_ENV: "production", SUPABASE_URL: "https://sentinelsentinelsent.supabase.co", SUPABASE_ANON_KEY: `sb_publishable_${"S".repeat(30)}` } });
    if (build.status !== 0) {
      console.error(`The build failed (exit ${build.status}):\n${String(build.stderr).slice(-1500)}`);
      process.exit(2);
    }
  } else if (!existsSync(dist)) {
    console.error(`No build at ${DIST}; run without --reuse first.`);
    process.exit(2);
  }
  // What a browser can receive: client chunks, prerendered pages and their payloads, and the public folder.
  const reachable = (file) => /[\\/]static[\\/]/.test(file) || /[\\/]server[\\/]app[\\/].*\.(html|rsc|json|segment)$/.test(file) || /[\\/]server[\\/]pages[\\/].*\.(html|json)$/.test(file);
  const needles = needlesFor(sentinels);
  const inBuild = scanForLeaks(dist, needles, { accept: reachable });
  const inPublic = scanForLeaks(join(WEB, "public"), needles);
  const hits = [...inBuild.hits.map((h) => ({ ...h, area: DIST })), ...inPublic.hits.map((h) => ({ ...h, area: "public" }))];
  console.log(`Searched ${inBuild.scanned} files a browser can receive from the build and ${inPublic.scanned} public files.`);
  if (hits.length > 0) {
    console.error(`\nLEAK: ${hits.length} hit(s):`);
    for (const h of hits.slice(0, 40)) console.error(`  ${h.area}/${h.file}  contains ${h.label}`);
    process.exit(1);
  }
  console.log("No secret value or name appears in anything a browser can receive.");
}
