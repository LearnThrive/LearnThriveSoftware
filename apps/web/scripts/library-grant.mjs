#!/usr/bin/env node
/**
 * Administrator access grants (plan19 phases D and E): give a family the Library without a subscription or a tuition
 * assignment (for example an enrolled family before their assignment records are entered), or take it away.
 *
 *   npm run library:grant -- --email parent@example.com --reason "enrolled: Maths with J. Smith" [--ends 2027-07-31]
 *   npm run library:grant -- --revoke <grant id>
 *   npm run library:grant -- --list --email parent@example.com
 *
 * The family must have signed up first (the account has to exist). A grant is recorded with its reason and optional end
 * date, revoking ends it at once, and it is the same kind of entitlement the checks already read (canAccess). Needs
 * DATABASE_URL in the environment; it is never printed.
 */
import { SqlLibraryStore } from "@learnthrive/data/library";
import { createExecutor } from "../src/lib/db.ts";

const args = process.argv.slice(2);
const value = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error('Usage:\n  npm run library:grant -- --email <address> --reason "<why>" [--ends YYYY-MM-DD]\n  npm run library:grant -- --revoke <grant id>\n  npm run library:grant -- --list --email <address>');
  process.exit(message ? 2 : 0);
}
if (args.includes("--help") || args.includes("-h")) usage();
if (!process.env.DATABASE_URL?.trim()) usage("DATABASE_URL is required.");

const email = value("--email")?.trim().toLowerCase();
const revoke = value("--revoke");
const list = args.includes("--list");
const reason = value("--reason")?.trim();
const endsText = value("--ends");
if (!revoke && !email) usage("--email is required (or --revoke <id>).");
if (!revoke && !list && (!reason || reason.length > 500)) usage('--reason "<why>" is required (up to 500 characters).');
let endsAt = null;
if (endsText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsText) || Number.isNaN(Date.parse(`${endsText}T00:00:00Z`))) usage("--ends must be a date like 2027-07-31.");
  endsAt = new Date(`${endsText}T23:59:59Z`);
  if (endsAt <= new Date()) usage("--ends must be in the future.");
}

const { executor, close } = await createExecutor(process.env.DATABASE_URL.trim());
const store = new SqlLibraryStore(executor);
try {
  if (revoke) {
    const ok = await store.billing.revokeGrant(revoke, new Date());
    console.log(ok ? "Revoked: access from that grant has ended." : "No active grant with that id.");
    process.exitCode = ok ? 0 : 1;
  } else {
    const users = await executor.query("select id from auth.users where lower(email) = $1", [email]);
    if (!users[0]) {
      console.error("No account with that email address. The family must sign up first.");
      process.exit(1);
    }
    const clientId = await store.accounts.ensureClient(users[0].id);
    if (list) {
      const rows = await executor.query("select id, reason, starts_at, ends_at, revoked_at from public.admin_grants where client_id = $1 order by created_at", [clientId]);
      if (rows.length === 0) console.log("No grants.");
      for (const r of rows) console.log(`${r.id}  ${r.revoked_at ? "revoked" : "active "}  from ${new Date(r.starts_at).toISOString().slice(0, 10)}${r.ends_at ? ` to ${new Date(r.ends_at).toISOString().slice(0, 10)}` : ""}  ${r.reason}`);
    } else {
      const grant = await store.billing.createGrant({ clientId, reason, endsAt });
      console.log(`Granted. Grant id ${grant.id}${endsAt ? `, ends ${endsText}` : ", no end date"}. Revoke with: npm run library:grant -- --revoke ${grant.id}`);
    }
  }
} finally {
  await close();
}
