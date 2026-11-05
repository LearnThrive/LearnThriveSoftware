#!/usr/bin/env node
/**
 * Checks a backfill source before any family is loaded (launch checklist 3.3, Phase 9.3).
 *
 *   node --import tsx scripts/backfill-check.mjs --file <source.json> [--strict] [--json]
 *
 * That is the whole tool: it READS ONE FILE and writes nothing, anywhere. No database, no connection string, no host, no key. It is
 * read-only by construction, which is the point — the load itself happens afterwards, through the operator scripts and the admin
 * screens, so this cannot leave a half-loaded project.
 *
 * It reports, in one pass and by externalId only:
 *   - a student with no owning family, or one that is not in the source;
 *   - a second-guardian link naming a student or a family that is not in the source, or the same link twice;
 *   - a duplicate or missing externalId (or one that is an email address), which is what makes any load unsafe;
 *   - a tutor or parent with no usable email, and any value the database would refuse (lengths, a lesson's duration and location type);
 *   - assignments naming an unknown tutor or student, or nobody; lessons with no assignment or a time without an offset;
 *   - and, as warnings for a person to read: a second guardian, a student's surname, a family with no children, a tutor or student on
 *     no assignment, two people sharing a name (never merged), a lesson already in the past, and a student that *looks like* a family
 *     by surname but was NOT linked.
 *
 * It refuses unless:
 *   - --file is given, and the file is OUTSIDE this repository: it holds real people's details;
 *   - the file parses as JSON.
 *
 * Exit codes: 0 loadable, 1 not loadable (or warnings under --strict), 2 usage or unreadable file, 3 refused (the file is inside the
 * repository). The output names records as `students/S-31`, never a person.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKFILL_RULE, checkSource, exampleSource, renderReport } from "../src/lib/backfill/source.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const refuse = (message, code = 3) => {
  console.error(message);
  process.exit(code);
};
const inRepository = (path) => {
  const from = relative(REPO, resolve(path));
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: node --import tsx scripts/backfill-check.mjs <source.json> [--strict] [--json]\n       node --import tsx scripts/backfill-check.mjs <new file.json> --write-template\n\nAlso accepts --file <source.json> or --file=<source.json>. Checking reads one file and writes nothing.\n--write-template writes a valid example to a path that does not exist yet, and never overwrites one.\n--strict makes warnings fail too. --json prints one machine-readable report, counts and codes only.",
  );
  process.exit(0);
}

/** `--file <path>`, `--file=<path>`, or the path on its own.
 *
 * The bare positional form exists because Windows PowerShell 5.1 drops the `--` separator before npm sees it: npm then reads `--file`
 * as one of its own options, consumes it, and passes only the path on to this script (which failed with "--file is required" while the
 * path sat unused). A positional path reaches the script in every shell — PowerShell 5.1, PowerShell 7 and Git Bash alike — so that
 * is the form the docs give, and the flag keeps working where it always did. */
const flagValue = (name) => {
  const at = args.indexOf(name);
  if (at >= 0) return args[at + 1];
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : undefined;
};
const file = flagValue("--file") ?? args.find((arg) => !arg.startsWith("-"));
if (!file) refuse("A source path is required: pass it as the last argument, or with --file <path>.", 2);
if (inRepository(file)) refuse("The source holds real people's details: keep it outside this repository. Nothing was read.", 3);

/*
 * `--write-template` exists because the first run needs a file and nobody should have to hand-write JSON to get one. It is reached
 * through `npm run backfill:template`, with the path positional, because Windows PowerShell 5.1 eats a `--flag` typed on the command
 * line — the same reason the path is positional above.
 */
if (args.includes("--write-template")) {
  if (existsSync(file)) refuse("There is already a file there: a template never overwrites one. Choose a path that does not exist yet.", 3);
  if (!existsSync(dirname(resolve(file)))) refuse("The folder for that path does not exist. Create it first, or choose another path. Nothing was written.", 2);
  writeFileSync(file, `${JSON.stringify(exampleSource(), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log("Wrote an example source to that path, and changed nothing else. It is fictional and already valid.");
  console.log('Now replace it with the real export, or run the check on it as it is to see what a first run looks like:');
  console.log('  npm run backfill:check --workspace=apps/web "<the same path>"');
  process.exit(0);
}

if (!existsSync(file)) {
  refuse(
    'There is no file at that path, so there is nothing to check yet.\nCreate a valid example to start from (it never overwrites):\n  npm run backfill:template --workspace=apps/web "<the same path>"',
    2,
  );
}

let raw;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch {
  refuse("That file could not be read as JSON. Nothing was done.", 2);
}

const report = checkSource(raw);

if (args.includes("--json")) {
  console.log(
    JSON.stringify({
      event: "backfill-check",
      ok: report.ok,
      clean: report.clean,
      errors: report.errors,
      warnings: report.warnings,
      counts: report.counts,
      findings: report.findings,
    }),
  );
} else {
  console.log(`\n${renderReport(report)}\n`);
  console.log(`Next: ${report.ok ? "this source may be loaded (Phase 9.3, one family at a time, checked with them on a call)." : "fix the problems above in the source and run this again. Nothing has been loaded."}`);
}

if (!report.ok) process.exit(1);
if (args.includes("--strict") && report.warnings > 0) {
  console.error("--strict: the warnings above stop the load as well.");
  process.exit(1);
}
if (!args.includes("--json")) console.log(BACKFILL_RULE);
