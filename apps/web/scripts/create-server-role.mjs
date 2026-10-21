#!/usr/bin/env node
/**
 * Creates (or refreshes) the database role the SITE connects as, instead of the all-powerful `postgres` login (plan20 section 3).
 *
 *   DATABASE_ADMIN_URL=<postgres connection string> LEARNTHRIVE_SERVER_PASSWORD=<generated> \
 *     node scripts/create-server-role.mjs [--host <the database host>]
 *
 * The role, `learnthrive_server`, can log in and do the data work the repositories do (select, insert, update, delete on the tables in
 * `public`, use their sequences, run the two lookups that read Auth for it) and nothing else: it cannot create or alter anything, cannot
 * read the other schemas, and is not a superuser. It BYPASSES row level security, by design: the server names the family on every
 * statement, and the policies are the second wall for the browser keys (docs/SUPABASE_MIGRATION.md). Re-run it after a migration
 * adds a table: it re-grants from scratch (revoke all, grant exactly this), so it is safe to repeat.
 *
 * Secrets: both values come from the environment, never a file or an argument. The password is turned into a SCRAM-SHA-256 verifier
 * here and only the verifier is sent, so the password itself never appears in a SQL statement, a server log or this script's output.
 * Make one with:   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *
 * A database that is not on this machine needs --host <its host> AND the host typed again at a prompt (scripts/_target.mjs).
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { confirmHosted } from "./_target.mjs";

export const ROLE = "learnthrive_server";

/** The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802 / 7677). Exported for the tests. */
export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The statements, in order. No password in any of them. */
export function grantStatements(verifier) {
  return [
    `do $$ begin if not exists (select from pg_roles where rolname = '${ROLE}') then create role ${ROLE} login; end if; end $$`,
    // Attributes: log in and bypass row level security, nothing more. A new role is already not a superuser and cannot create roles,
    // databases or replicate; those clauses are NOT written here because Postgres lets only a superuser even name them (the postgres
    // role on Supabase is not one). The connection cap stops a runaway pool.
    `alter role ${ROLE} with login noinherit bypassrls connection limit 30 password '${verifier}'`,
    `alter role ${ROLE} set statement_timeout = '30s'`,
    `alter role ${ROLE} set idle_in_transaction_session_timeout = '30s'`,
    // Start from nothing, then grant exactly what the repositories use.
    `revoke all on all tables in schema public from ${ROLE}`,
    `revoke all on all sequences in schema public from ${ROLE}`,
    `revoke all on all functions in schema public from ${ROLE}`,
    `revoke all on schema public from ${ROLE}`,
    `revoke all on schema private from ${ROLE}`,
    `grant usage on schema public to ${ROLE}`,
    `grant select, insert, update, delete on all tables in schema public to ${ROLE}`,
    `grant usage, select on all sequences in schema public to ${ROLE}`,
    // The two Auth lookups (migration 0009): the role never touches the auth schema itself. And the one private helper the generated
    // search column of resources calls on every insert and update (a generated column runs with the INSERTING role's privileges).
    `grant execute on function public.auth_email(uuid), public.auth_user_by_email(text) to ${ROLE}`,
    `grant usage on schema private to ${ROLE}`,
    `grant execute on function private.tags_to_text(text[]) to ${ROLE}`,
  ];
}

// Runs only when started directly (not when a test imports the helpers above). pathToFileURL is right on Windows and Linux alike.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const url = process.env.DATABASE_ADMIN_URL?.trim();
  const password = process.env.LEARNTHRIVE_SERVER_PASSWORD ?? "";
  if (!url) {
    console.error("DATABASE_ADMIN_URL is required (the postgres connection string of the database to set the role up on).");
    process.exit(2);
  }
  if (password.length < 32 || !/^[\x21-\x7e]+$/.test(password)) {
    console.error("LEARNTHRIVE_SERVER_PASSWORD is required: at least 32 printable characters, no spaces.\nMake one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"");
    process.exit(2);
  }
  const target = await confirmHosted({ url, args, action: `create or refresh the database role ${ROLE}` });
  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      for (const statement of grantStatements(scramVerifier(password))) await tx.unsafe(statement);
    });
    const [role] = await sql`select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin, rolconnlimit from pg_roles where rolname = ${ROLE}`;
    const [{ tables }] = await sql`select count(*)::int as tables from information_schema.role_table_grants where grantee = ${ROLE} and table_schema = 'public' and privilege_type = 'SELECT'`;
    console.log(`Role ${ROLE} is ready on ${target.host}: can log in, bypassrls ${role.rolbypassrls}, superuser ${role.rolsuper}, ${tables} public tables granted.`);
    console.log("Connect the site as it through the pooler (user is learnthrive_server.<project ref> on the hosted pooler) and keep the password only in the server environment.");
  } catch (error) {
    console.error(`Could not set the role up: ${String(error.message).replace(password, "***").slice(0, 300)}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
