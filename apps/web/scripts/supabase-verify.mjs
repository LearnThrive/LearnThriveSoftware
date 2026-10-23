#!/usr/bin/env node
/**
 * Probes that a Supabase project is set up the way the site needs it (plan20 section 6). It only ever READS, with the publishable key
 * (the key every visitor's browser could hold), and reports PASS, FAIL or NOTE for each rule. It makes no account, writes no row and
 * uploads nothing. No key is ever printed.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> node scripts/supabase-verify.mjs [flags]
 *
 *   --expect-graphql on|off     the GraphQL endpoint (default: off)
 *   --expect-signup open|closed whether anyone may create an account (default: open; the owner's choice, docs/SUPABASE_DASHBOARD_CHECKLIST.md)
 *
 * Exit status 0: no FAIL. 1: at least one FAIL. 2: it could not run.
 *
 * What a probe cannot see from outside, and so is NOT checked here (it needs a signed-in test account or the dashboard): the password
 * rules and leaked-password check, email templates and sender, session lengths, MFA, backups, the spend cap. Those are in the checklist.
 * Local-only: against the CLI's local stack a few differences are reported as NOTE, not FAIL (its gateway also serves Studio's /pg/).
 */
import { pathToFileURL } from "node:url";

/** Every table in public (a test compares this with the migrations, so a new table cannot be forgotten). */
export const PUBLIC_TABLES = [
  "admin_grants", "assignment_students", "billing_customers", "chat_file_chunks", "chat_files", "chat_messages", "chat_sessions", "client_students", "clients",
  "consents", "download_events", "entitlements", "identity_audit", "learner_identities", "learner_invitations", "lesson_activity", "lesson_attendance", "lesson_reports", "lesson_students", "lessons", "notifications", "paper_assessment_versions", "paper_jobs", "platform_settings", "profiles", "resource_files", "resources", "students", "stripe_webhook_events",
  "subscriptions", "supervised_contexts", "tuition_assignments", "tutor_availability_blocks", "tutors", "usage_counters",
];
const NOT_EXPOSED_SCHEMAS = ["private", "auth", "storage", "extensions", "pg_catalog", "information_schema", "vault", "supabase_migrations", "graphql_public"];
const BUCKETS = ["library", "chat-uploads"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export async function runProbes({ url, key, expectGraphql = "off", expectSignup = "open", fetchImpl = fetch, assumeLocal } = {}) {
  const base = url.replace(/\/+$/, "");
  // Local means this machine; `assumeLocal: false` lets a test hold a localhost fake to the hosted rules.
  const local = assumeLocal ?? LOCAL_HOSTS.has(new URL(base).hostname);
  const results = [];
  const add = (level, id, text) => results.push({ level, id, text });
  const pass = (id, text) => add("pass", id, text);
  const fail = (id, text) => add("fail", id, text);
  const note = (id, text) => add("note", id, text);
  const redact = (text) => String(text).split(key).join("<key>");

  const call = async (path, { method = "GET", headers = {}, body, bearer = false } = {}) => {
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { apikey: key, ...(bearer ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      return { status: response.status, json, text, headers: response.headers };
    } catch (error) {
      return { status: 0, json: null, text: redact(error.message), headers: new Headers() };
    }
  };
  const refused = (r) => r.status === 401 || r.status === 403 || r.status === 404 || r.status === 400 || r.status === 406;

  // 1. Transport --------------------------------------------------------------------------------------------------
  if (new URL(base).protocol === "https:" || local) pass("transport", local ? "the local stack (plain HTTP on this machine)" : "HTTPS");
  else fail("transport", "the project URL is not HTTPS");
  const reach = await call("/auth/v1/settings");
  if (reach.status !== 200) {
    fail("reach", `the project did not answer the publishable key (HTTP ${reach.status}); check SUPABASE_URL and SUPABASE_ANON_KEY`);
    return results;
  }
  pass("reach", "the project answers, and accepts the key sent as the apikey header alone");
  const withBearer = await call("/auth/v1/settings", { bearer: true });
  note("key-bearer", withBearer.status === 200 ? "the key is also accepted as a bearer token" : `the key is NOT accepted as a bearer token (HTTP ${withBearer.status}): the site sends only the apikey header for sb_ keys, which is right`);

  // 2. Auth settings visible from outside ------------------------------------------------------------------------
  const settings = reach.json ?? {};
  const providers = Object.entries(settings.external ?? {}).filter(([, on]) => on).map(([name]) => name);
  if (providers.length === 1 && providers[0] === "email") pass("providers", "only email sign-in is on (no social login, no phone, no anonymous sign-ins)");
  else fail("providers", `sign-in methods on: ${providers.join(", ") || "none"} (only "email" is allowed)`);
  if (settings.mailer_autoconfirm === false) pass("confirm-email", "an email address must be confirmed before sign-in");
  else fail("confirm-email", "email confirmation is OFF: anyone could sign in with an address they do not own");
  const open = settings.disable_signup === false;
  if ((expectSignup === "open") === open) pass("signup", open ? "anyone may create an account (as chosen)" : "sign-up is closed (as chosen: invite only)");
  else fail("signup", `sign-up is ${open ? "open" : "closed"} but the checklist says ${expectSignup}`);
  if (settings.saml_enabled) fail("saml", "SAML single sign-on is on, which the site does not use");

  // 3. The Data API: unauthenticated callers ------------------------------------------------------------------------
  let leaked = [];
  let listed = [];
  for (const table of PUBLIC_TABLES) {
    const r = await call(`/rest/v1/${table}?select=*&limit=1`);
    if (table === "resources") {
      if (r.status === 200) listed = r.json ?? [];
      else fail("anon-resources", `the public catalogue answered HTTP ${r.status}`);
      continue;
    }
    // A table leaks only if it hands rows to an anonymous caller. A refusal, an empty list (RLS hid every row) or an error is not data.
    const gaveRows = r.status >= 200 && r.status < 300 && (Array.isArray(r.json) ? r.json.length > 0 : r.json !== null && r.json !== "");
    if (gaveRows) leaked.push(`${table} (HTTP ${r.status})`);
  }
  if (leaked.length === 0) pass("anon-tables", `no table except the published catalogue returns a row to an anonymous caller (${PUBLIC_TABLES.length - 1} checked)`);
  else fail("anon-tables", `anonymous callers can read: ${leaked.join(", ")}`);
  if (listed.length && listed.some((row) => "storage_path" in row || "bucket" in row || "checksum_sha256" in row)) fail("no-paths", "the catalogue exposes file paths or checksums");
  else pass("no-paths", "the catalogue rows hold no file path, bucket or checksum");
  const files = await call("/rest/v1/resource_files?select=storage_path&limit=1");
  if (files.status === 200 && (files.json ?? []).length > 0) fail("anon-file-paths", "anonymous callers can read file paths");
  else pass("anon-file-paths", "file paths are not readable");
  const writes = await call("/rest/v1/resources?id=not.is.null", { method: "PATCH", body: { published_at: null }, headers: { Prefer: "return=minimal" } });
  if (writes.status >= 200 && writes.status < 300) fail("anon-write", "an anonymous PATCH on resources was accepted");
  else pass("anon-write", "an anonymous write to the catalogue is refused");

  // 4. Schemas and endpoints that must not be exposed ----------------------------------------------------------------
  const exposed = [];
  for (const schema of NOT_EXPOSED_SCHEMAS) {
    const r = await call("/rest/v1/profiles?select=*&limit=1", { headers: { "Accept-Profile": schema } });
    if (r.status === 200 || (r.status !== 406 && r.status !== 404 && !refused(r))) exposed.push(`${schema} (HTTP ${r.status})`);
    else if (r.status === 200) exposed.push(schema);
  }
  if (exposed.length === 0) pass("schemas", `only the public schema is exposed (${NOT_EXPOSED_SCHEMAS.length} others refused: private, auth, storage, ...)`);
  else fail("schemas", `the Data API answered for: ${exposed.join(", ")}`);
  const graphql = await call("/graphql/v1", { method: "POST", body: { query: "{ __typename }" } });
  const graphqlOn = graphql.status === 200;
  if ((expectGraphql === "on") === graphqlOn) pass("graphql", graphqlOn ? "GraphQL is on (as chosen)" : "the GraphQL endpoint is off");
  else fail("graphql", `GraphQL is ${graphqlOn ? "on" : "off"} but the checklist says ${expectGraphql}`);
  const spec = await call("/rest/v1/", { headers: { Accept: "application/openapi+json" } });
  const described = Object.keys(spec.json?.paths ?? {}).filter((p) => p !== "/");
  if (spec.status === 200 && described.some((p) => p !== "/resources" && !p.startsWith("/rpc/"))) fail("openapi", `the schema description shows an anonymous caller: ${described.filter((p) => p !== "/resources").join(", ")}`);
  else pass("openapi", "the schema description shows an anonymous caller nothing beyond the catalogue");
  const meta = await call("/pg/tables");
  if (meta.status === 200) (local ? note : fail)("meta", local ? "LOCAL ONLY: the CLI's gateway serves Studio's database tool at /pg/ with no key; it must be 404 on the hosted project" : "the database metadata endpoint /pg/ answers; it must not be reachable");
  else pass("meta", "the database metadata endpoint is not reachable");

  // 5. Storage ----------------------------------------------------------------------------------------------------
  const storageProblems = [];
  for (const bucket of BUCKETS) {
    const direct = await call(`/storage/v1/object/public/${bucket}/probe.pdf`);
    if (direct.status === 200) storageProblems.push(`${bucket} serves public URLs`);
    const list = await call(`/storage/v1/object/list/${bucket}`, { method: "POST", body: { prefix: "", limit: 5 } });
    if (list.status === 200 && Array.isArray(list.json) && list.json.length > 0) storageProblems.push(`${bucket} can be listed anonymously`);
    const read = await call(`/storage/v1/object/${bucket}/probe.pdf`);
    if (read.status === 200) storageProblems.push(`${bucket} serves an object without a signature`);
    const write = await call(`/storage/v1/object/${bucket}/probe-${Date.now()}.txt`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: undefined });
    if (write.status === 200) storageProblems.push(`${bucket} accepted an anonymous upload`);
  }
  const buckets = await call("/storage/v1/bucket");
  if (buckets.status === 200 && Array.isArray(buckets.json) && buckets.json.some((b) => b.public === true)) storageProblems.push("a bucket is marked public");
  if (storageProblems.length === 0) pass("storage", `the buckets (${BUCKETS.join(", ")}) are private: no public URL, no anonymous listing, read or upload`);
  else fail("storage", storageProblems.join("; "));

  // 6. What the responses give away ------------------------------------------------------------------------------
  const sample = await call("/rest/v1/clients?select=*");
  const bodies = [sample.text, graphql.text].join("\n"); // error responses (the /pg/ body is the local-only probe above)
  if (/\bat [\w$.]+ \(|node_modules|\/usr\/|\/var\/|C:\\\\|postgres(ql)?:\/\/|password=|secret|service_role|BEGIN (RSA|PRIVATE)/i.test(bodies)) fail("leaks", "an error response contains a stack trace, a file path, a connection string or a secret");
  else pass("leaks", "error responses hold no stack trace, path, connection string or secret");
  if (sample.headers.get("x-powered-by")) fail("powered-by", `a response header names the software: x-powered-by: ${sample.headers.get("x-powered-by")}`);
  else pass("powered-by", "no x-powered-by header");
  if (/hint/i.test(sample.text) && /GRANT/.test(sample.text)) note("hints", "a refusal names the table and suggests a GRANT (PostgREST's default hint): it confirms the table exists, which the repository already makes public, and cannot be switched off");
  const server = sample.headers.get("server");
  if (server && /\/[0-9]/.test(server)) note("server-header", `the Server header carries a version (${server})${local ? ": local stack only" : ""}`);
  if (sample.headers.get("access-control-allow-origin") === "*") note("cors", "the API allows any origin (Access-Control-Allow-Origin: *). That is Supabase's fixed behaviour; the site's own pages never call it from a browser (connect-src 'self'), so nothing depends on this");

  return results;
}

const ICON = { pass: "PASS", fail: "FAIL", note: "NOTE" };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_ANON_KEY (the publishable key) are required, in the environment.");
    process.exit(2);
  }
  const expectGraphql = option("--expect-graphql", "off");
  const expectSignup = option("--expect-signup", "open");
  if (!["on", "off"].includes(expectGraphql) || !["open", "closed"].includes(expectSignup)) {
    console.error("--expect-graphql takes on|off and --expect-signup takes open|closed.");
    process.exit(2);
  }
  const results = await runProbes({ url, key, expectGraphql, expectSignup });
  console.log(`Supabase probes for ${new URL(url).host} (read-only, publishable key only)\n`);
  for (const r of results) console.log(`${ICON[r.level]}  ${r.id.padEnd(16)} ${r.text.split(key).join("<key>")}`);
  const fails = results.filter((r) => r.level === "fail").length;
  console.log(`\n${results.filter((r) => r.level === "pass").length} passed, ${fails} failed, ${results.filter((r) => r.level === "note").length} noted.`);
  process.exit(fails > 0 ? 1 : 0);
}
