#!/usr/bin/env node
/**
 * Library import tool (plan19 phase D): a folder of PDFs plus library.json  ->  private storage + resource rows.
 *
 *   npm run library:import -- --dir ./library-content            dry run: checks everything, writes nothing
 *   npm run library:import -- --dir ./library-content --apply    uploads the files, then upserts the rows
 *
 * The folder holds library.json (see docs/LIBRARY.md for the format and an example) and the PDFs it names. Every
 * file is checked with the same code the careers uploads use (real type, size, no scripts, not encrypted) and every
 * resource must say who made it (`authorship`). One problem anywhere stops the whole run.
 *
 * Settings come from the environment, never from a file in the repo, and are never printed:
 *   DATABASE_URL                Postgres connection string (dry run reads it too, to find what is already imported)
 *   SUPABASE_URL                project URL (apply only)
 *   SUPABASE_SERVICE_ROLE_KEY   service role key, for the private `library` bucket (apply only)
 *
 * Run with a staging project first. No admin UI exists in this plan: this is the way content goes in.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SqlLibraryStore, InMemoryLibraryStore } from "@learnthrive/data/library";
import { createExecutor } from "../src/lib/db.ts";
import { applyImport, planImport } from "../src/lib/library/import.ts";
import { SupabaseLibraryStorage } from "../src/lib/library/storage.ts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error("Usage: npm run library:import -- --dir <folder> [--apply]");
  process.exit(message ? 2 : 0);
}

if (flag("--help") || flag("-h")) usage();
const dirArg = value("--dir");
if (!dirArg) usage("--dir <folder> is required.");
const dir = resolve(dirArg);
if (!existsSync(dir)) usage(`The folder ${dir} does not exist.`);
const apply = flag("--apply");

const env = process.env;
if (apply) {
  for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[key]?.trim()) usage(`--apply needs ${key} in the environment.`);
  }
}

const folder = {
  readMetadata: () => {
    const path = join(dir, "library.json");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  },
  readFile: (name) => {
    const path = join(dir, name);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  },
};

let close = async () => {};
let resources;
if (env.DATABASE_URL?.trim()) {
  const connection = await createExecutor(env.DATABASE_URL.trim());
  close = connection.close;
  resources = new SqlLibraryStore(connection.executor).resources;
  console.log(`Database: ${new URL(env.DATABASE_URL.trim()).hostname}`);
} else {
  resources = new InMemoryLibraryStore().resources;
  console.log("No DATABASE_URL: treating every resource as new.");
}

try {
  const plan = await planImport(folder, resources);
  for (const item of plan.items) {
    const size = item.files.reduce((total, f) => total + f.bytes.length, 0);
    const state = item.metadata.input.publishedAt ? `publishes ${item.metadata.input.publishedAt.toISOString().slice(0, 10)}` : "draft";
    console.log(`${item.action.padEnd(11)} ${item.metadata.input.slug}  v${item.version}  ${item.files.length} file(s), ${(size / 1024).toFixed(0)} KB  [${item.metadata.input.accessTier}, ${state}]`);
  }
  if (plan.problems.length > 0) {
    console.error(`\n${plan.problems.length} problem(s). Nothing was imported:`);
    for (const problem of plan.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else if (!apply) {
    console.log(`\nDry run: ${plan.items.length} resource(s) checked, nothing written. Add --apply to import.`);
  } else {
    const storage = new SupabaseLibraryStorage({ url: env.SUPABASE_URL.trim(), serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY.trim() });
    const summary = await applyImport(plan, { resources, storage });
    console.log(`\nDone: ${summary.created} created, ${summary.updated} updated, ${summary.newVersions} new version(s), ${summary.uploaded} file(s) uploaded.`);
  }
} finally {
  await close();
}
