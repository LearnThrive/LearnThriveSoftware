#!/usr/bin/env node
/**
 * Makes an existing account an administrator (plan20 section 4). Roles cannot be self-assigned: the sign-up trigger always creates
 * CLIENT, no browser key can write profiles.role, and there is no admin screen that promotes anyone. This is the one way in, run by
 * a person who holds the database connection string.
 *
 *   DATABASE_URL=<the server connection string> node scripts/promote-admin.mjs --email person@example.com --host <the database host>
 *
 * It refuses unless ALL of these hold:
 *   - --host is given and is the host of DATABASE_URL (so it is never run against a database by accident: a local one needs
 *     --host 127.0.0.1, the hosted one --host db.<ref>.supabase.co or the pooler's host);
 *   - the address already has an account, and that address is CONFIRMED (the person opened the emailed link);
 *   - the operator types the email address again at the prompt (a pipe works too: it is the same typing);
 *   - for a database that is not on this machine, also types the host (scripts/_target.mjs), at a real terminal.
 *
 * It writes profiles.role through the server connection and prints one counter-only line to the console: which host, the outcome and
 * how many administrators there are now. Never the email, a name, a key or the connection string. Nothing else is changed.
 * A tutor is linked by the documented SQL step instead (docs/AUTHENTICATION.md): a tutors row needs a display name and is not a login role.
 */
import { createInterface } from "node:readline/promises";
import postgres from "postgres";
import { confirmHosted, describeTarget, option } from "./_target.mjs";

const args = process.argv.slice(2);
const refuse = (message, code = 3) => {
  console.error(message);
  process.exit(code);
};

const url = process.env.DATABASE_URL?.trim();
const email = option(args, "--email")?.trim().toLowerCase();
const host = option(args, "--host")?.trim().toLowerCase();
if (args.includes("--help") || args.includes("-h")) refuse("Usage: DATABASE_URL=... node scripts/promote-admin.mjs --email <address> --host <the database host>", 0);
if (!url) refuse("DATABASE_URL is required (the server connection string; it is never printed).", 2);
if (!email || !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) refuse("--email <address> is required.", 2);
if (!host) refuse("--host <the database host> is required: say which database this is for, even a local one (--host 127.0.0.1).", 3);

const target = describeTarget(url);
if (host !== target.host) refuse(`--host ${host} is not the host of DATABASE_URL. Nothing was done.`, 3);
// A database that is not on this machine also needs the host typed at a real terminal, before anything is read or written.
await confirmHosted({ url, args, action: "make an account an administrator" });

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
const line = (outcome, extra = {}) => console.log(JSON.stringify({ event: "promote-admin", outcome, host: target.host, at: new Date().toISOString(), ...extra }));

try {
  const [found] = await sql`select id, email_confirmed from public.auth_user_by_email(${email})`;
  if (!found) {
    line("no_account");
    refuse("There is no account with that address. The person must sign up and confirm their email first.", 1);
  }
  if (!found.email_confirmed) {
    line("unconfirmed");
    refuse("That account has not confirmed its email address yet. Ask the person to open the link in the confirmation email first.", 1);
  }
  const [profile] = await sql`select role from public.profiles where id = ${found.id}`;
  if (!profile) {
    line("no_profile");
    refuse("The account has no profile row (the sign-up trigger did not run). Nothing was changed.", 1);
  }
  if (profile.role === "ADMIN") {
    line("already_admin");
    console.log("That account is already an administrator. Nothing was changed.");
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`This makes the account for ${email} an ADMINISTRATOR (currently ${profile.role}) on ${target.host}.\nType the email address again to confirm: `)).trim().toLowerCase();
  rl.close();
  if (!process.stdin.isTTY) console.log(); // a pipe does not echo the Enter: end the prompt's line
  if (typed !== email) {
    line("not_confirmed");
    refuse("That did not match. Nothing was changed.", 3);
  }

  const changed = await sql`update public.profiles set role = 'ADMIN' where id = ${found.id} and role <> 'ADMIN'`;
  const [{ admins }] = await sql`select count(*)::int as admins from public.profiles where role = 'ADMIN'`;
  line(changed.count === 1 ? "promoted" : "unchanged", { administrators: admins });
  console.log(changed.count === 1 ? `Done. The account is now an administrator (${admins} in total). They must sign in again for it to take effect.` : "Nothing was changed.");
} finally {
  await sql.end({ timeout: 5 });
}
