#!/usr/bin/env node
/**
 * Makes the real accounts on a Supabase project from a list (launch checklist 3.2.8). No screen can make the first administrator, and no
 * screen ever makes an administrator at all, so the staff accounts start here; every later family is made from the admin screens.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=<the server connection string> \
 *     node --import tsx scripts/create-account.mjs --file <list.json> --host <the database host>
 *
 * That is a DRY RUN: it prints the names, roles and usernames, says which usernames are already taken, and changes nothing. Show that to
 * the owner. The real run adds --apply --passwords <a new file>:
 *
 *     ... --file <list.json> --host <host> --apply --passwords <a new file>
 *
 * The list is a JSON array, kept outside this repository:
 *
 *   [
 *     { "username": "alvi", "displayName": "Alvi Hossain", "linkedEmail": "...", "role": "ADMIN", "teaches": true, "subjects": ["Maths"] },
 *     { "username": "brian", "displayName": "Brian ...", "linkedEmail": "...", "role": "ADMIN" },
 *     { "username": "sam.tutor", "displayName": "Sam ...", "linkedEmail": "...", "role": "TUTOR" },
 *     { "username": "a.parent", "displayName": "A Parent", "linkedEmail": "...", "role": "CLIENT" },
 *     { "username": "kit-4821", "displayName": "Kit", "role": "STUDENT", "parent": "a.parent", "yearGroup": "Year 9" }
 *   ]
 *
 * A child takes their parent's linked email, and their parent must come first in the list or already exist. `teaches` gives an
 * administrator a tutor record; a TUTOR always has one.
 *
 * It refuses unless ALL of these hold:
 *   - --host is given and is the host of DATABASE_URL, and SUPABASE_URL is the same project;
 *   - the database is not on this machine, unless --local-stack says that is what you mean (the real-stack tests);
 *   - the list and the passwords file are both OUTSIDE this repository, and the passwords file does not exist yet;
 *   - the list is valid as a whole: one bad row stops everything before anything is written;
 *   - the operator types the host (scripts/_target.mjs) and then the number of accounts.
 *
 * Each temporary password goes to the passwords file and nowhere else: never the console, a log or a chat. The owner hands each one over
 * and the person must choose their own at first sign-in. The console gets counters only. Each account is its own transaction: a refused
 * one is removed again and reported, and the ones before it stand, so fix the row and re-run with what is left.
 */
import { closeSync, existsSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { generateTemporaryPassword } from "../src/lib/account/credentials.ts";
import { SupabaseAccountAdmin } from "../src/lib/account/supabaseAdmin.ts";
import { internalEmailFor, usernameError } from "../src/lib/account/username.ts";
import { emailError } from "../src/lib/account/validation.ts";
import { confirmHosted, describeTarget, option } from "./_target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROLES = ["ADMIN", "TUTOR", "CLIENT", "STUDENT"];

const args = process.argv.slice(2);
const refuse = (message, code = 3) => {
  console.error(message);
  process.exit(code);
};
const inRepository = (path) => {
  const from = relative(REPO, resolve(path));
  return from === "" || (!from.startsWith("..") && !isAbsolute(from));
};

if (args.includes("--help") || args.includes("-h")) refuse("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... node --import tsx scripts/create-account.mjs --file <list.json> --host <the database host> [--apply --passwords <a new file>]", 0);

const apply = args.includes("--apply");
const localStack = args.includes("--local-stack");
const url = process.env.DATABASE_URL?.trim();
const apiUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const listPath = option(args, "--file");
const passwordsPath = option(args, "--passwords");
const host = option(args, "--host")?.trim().toLowerCase();

if (!url) refuse("DATABASE_URL is required (the server connection string; it is never printed).", 2);
if (!apiUrl) refuse("SUPABASE_URL is required.", 2);
if (!serviceKey) refuse("SUPABASE_SERVICE_ROLE_KEY is required (it is never printed).", 2);
if (!listPath) refuse("--file <list.json> is required.", 2);
if (apply && !passwordsPath) refuse("--apply needs --passwords <a new file>: that is the only place the temporary passwords are written.", 2);
if (!host) refuse("--host <the database host> is required: say which database this is for.", 3);

const target = describeTarget(url);
if (host !== target.host) refuse(`--host ${host} is not the host of DATABASE_URL. Nothing was done.`, 3);
if (target.local && !localStack) refuse("This database is on this machine. Pass --local-stack if that is what you mean. Nothing was done.", 3);
const api = describeTarget(apiUrl);
if (api.local !== target.local) refuse("SUPABASE_URL and DATABASE_URL must both be local or both be hosted. Nothing was done.", 3);
if (!api.local && !`${target.user}.${target.host}`.includes(api.host.split(".")[0])) refuse("DATABASE_URL does not belong to the same project as SUPABASE_URL. Nothing was done.", 3);
if (inRepository(listPath)) refuse("The list holds real people's details: keep it outside this repository. Nothing was done.", 3);
if (passwordsPath && inRepository(passwordsPath)) refuse("The passwords file must be outside this repository. Nothing was done.", 3);
if (passwordsPath && existsSync(passwordsPath)) refuse("The passwords file already exists: it is never overwritten. Choose a new file. Nothing was done.", 3);

/** Every problem in the list, so one read shows them all. Nothing is written unless this comes back empty. */
function problemsIn(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ["The list must be a JSON array with at least one account."];
  const problems = [];
  const seen = new Set();
  rows.forEach((row, index) => {
    const at = `Row ${index + 1}`;
    if (typeof row !== "object" || row === null) return problems.push(`${at}: not an object.`);
    const usernameProblem = usernameError(typeof row.username === "string" ? row.username : "");
    if (usernameProblem) problems.push(`${at}: username: ${usernameProblem}`);
    if (seen.has(row.username)) problems.push(`${at}: the username appears twice.`);
    seen.add(row.username);
    if (typeof row.displayName !== "string" || !row.displayName.trim() || row.displayName.length > 80) problems.push(`${at}: displayName is required, at most 80 characters.`);
    if (!ROLES.includes(row.role)) problems.push(`${at}: role must be one of ${ROLES.join(", ")}.`);
    if (row.role === "STUDENT") {
      if (typeof row.parent !== "string" || !row.parent) problems.push(`${at}: a child needs "parent": their parent's username.`);
      if (row.linkedEmail !== undefined) problems.push(`${at}: a child takes their parent's linked email: leave linkedEmail out.`);
    } else {
      const emailProblem = emailError(typeof row.linkedEmail === "string" ? row.linkedEmail.trim().toLowerCase() : "");
      if (emailProblem) problems.push(`${at}: linkedEmail: ${emailProblem}`);
    }
    if (row.teaches !== undefined && row.role !== "ADMIN") problems.push(`${at}: "teaches" is only for an ADMIN: a TUTOR always has a tutor record.`);
  });
  return problems;
}

let rows;
try {
  rows = JSON.parse(readFileSync(listPath, "utf8"));
} catch {
  refuse("The list could not be read as JSON. Nothing was done.", 2);
}
const problems = problemsIn(rows);
if (problems.length > 0) refuse(`The list has problems. Nothing was done.\n  ${problems.join("\n  ")}`, 2);

// Reading which usernames are taken is still a look at a database that is not this machine, so it is confirmed the same way.
await confirmHosted({ url, args, action: apply ? `create ${rows.length} accounts` : "read which usernames are already taken" });

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
const line = (outcome, extra = {}) => console.log(JSON.stringify({ event: "create-account", outcome, host: target.host, at: new Date().toISOString(), ...extra }));

try {
  const names = rows.map((row) => row.username);
  const taken = new Set((await sql`select username from public.profiles where username = any(${names})`).map((row) => row.username));

  console.log(`\n${apply ? "Creating" : "DRY RUN: nothing will change."} ${rows.length} account(s) on ${target.host}:\n`);
  for (const row of rows) {
    const label = row.role === "ADMIN" ? (row.teaches ? "ADMIN and tutor" : "ADMIN only") : row.role;
    console.log(`  ${row.username.padEnd(24)} ${label.padEnd(16)} ${row.displayName}${row.parent ? ` (child of ${row.parent})` : ""}${taken.has(row.username) ? "   ALREADY TAKEN" : ""}`);
  }
  console.log();
  if (taken.size > 0) refuse(`${taken.size} username(s) are already taken. Take them out of the list. Nothing was changed.`, 1);

  if (!apply) {
    line("dry_run", { accounts: rows.length });
    console.log("Show this to the owner. Add --apply --passwords <a new file> to create them.");
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`Type the number of accounts to create (${rows.length}) to confirm: `)).trim();
  rl.close();
  if (!process.stdin.isTTY) console.log();
  if (typed !== String(rows.length)) {
    line("not_confirmed");
    refuse("That did not match. Nothing was changed.", 3);
  }

  const admin = new SupabaseAccountAdmin({ url: apiUrl, serviceKey });
  // Created first and held open, with no read access for anyone else: if it cannot be made, no account is made either.
  const passwords = openSync(passwordsPath, "wx", 0o600);
  let created = 0;
  let failed = 0;
  try {
    for (const row of rows) {
      const parent = row.role === "STUDENT"
        ? (await sql`select p.linked_email, c.id as client_id from public.profiles p join public.clients c on c.owner_profile_id = p.id where p.username = ${row.parent}`)[0]
        : null;
      if (row.role === "STUDENT" && !parent) {
        failed += 1;
        line("no_parent", { row: rows.indexOf(row) + 1 });
        continue;
      }
      const temporaryPassword = generateTemporaryPassword();
      const made = await admin.createUser({ email: internalEmailFor(row.username), password: temporaryPassword, displayName: row.displayName.trim(), adultConfirmed: row.role !== "STUDENT" });
      if (!made.ok) {
        failed += 1;
        line(made.reason, { row: rows.indexOf(row) + 1 });
        continue;
      }
      let tutorId = null;
      let studentId = null;
      let result = "not_eligible";
      try {
        if (row.role === "TUTOR" || row.teaches) {
          tutorId = (await sql`insert into public.tutors (display_name, subjects, contact_email) values (${row.displayName.trim()}, ${row.subjects ?? []}, ${row.linkedEmail.trim().toLowerCase()}) returning id`)[0].id;
        }
        if (row.role === "STUDENT") {
          studentId = (await sql`insert into public.students (client_id, display_name, year_group) values (${parent.client_id}, ${row.displayName.trim()}, ${row.yearGroup ?? null}) returning id`)[0].id;
        }
        const linkedEmail = row.role === "STUDENT" ? parent.linked_email : row.linkedEmail.trim().toLowerCase();
        result = (await sql`select public.provision_account(${made.id}, ${row.username}, ${linkedEmail}, ${row.displayName.trim()}, ${row.role}, ${tutorId}, ${studentId}, ${null}, ${new Date()}) as result`)[0].result;
      } finally {
        if (result !== "ok") {
          await admin.deleteUser(made.id);
          if (tutorId) await sql`delete from public.tutors where id = ${tutorId}`;
          if (studentId) await sql`delete from public.students where id = ${studentId}`;
        }
      }
      if (result !== "ok") {
        failed += 1;
        line(result, { row: rows.indexOf(row) + 1 });
        continue;
      }
      writeSync(passwords, `${row.username}\t${temporaryPassword}\n`);
      created += 1;
    }
  } finally {
    closeSync(passwords);
  }
  const [{ administrators }] = await sql`select count(*)::int as administrators from public.profiles where role = 'ADMIN'`;
  line(failed === 0 ? "created" : "partly_created", { created, failed, administrators });
  console.log(`Created ${created} of ${rows.length}.${failed ? ` ${failed} failed: the JSON lines above name each row, and nothing was left of them.` : ""} The temporary passwords are in the passwords file.`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
