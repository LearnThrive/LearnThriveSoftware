// The Supabase foundation against the REAL local stack (plan20): real Postgres 17, real Auth (GoTrue), real PostgREST, real Storage,
// real mail catcher. Skipped unless SUPABASE_LOCAL=1, with the stack running (`npx supabase start`):
//
//   SUPABASE_LOCAL=1 npx tsx --test src/realstack.test.ts        (from packages/data)
//
// Every rule that rls.test.ts proves on PGlite is tried again here the way an attacker would, over HTTP, as a person holding a real
// access token and the publishable key. A refused request is a 401 or 403 with SQLSTATE 42501; a request RLS hides is an empty list.
// The harness (./testing/realstack.ts) refuses to run against anything that is not this machine.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { MIGRATIONS_DIR } from "./testing/pglite";
import { auth, deleteUser, lastMail, newUser, openDb, PASSWORD, rest, rpc, runId, signIn, stack, type NewUser, type Reply, type Sql, type Stack } from "./testing/realstack";

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const SHA = "c".repeat(64);
const ZERO = "00000000-0000-0000-0000-000000000000";

const PERMISSION = /permission denied/i;
const RLS = /row-level security/i;

function refused(r: Reply, message?: RegExp, label = "") {
  assert.ok(r.status === 401 || r.status === 403, `${label} expected a refusal, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  assert.equal(r.body?.code, "42501", `${label} ${JSON.stringify(r.body).slice(0, 200)}`);
  if (message) assert.match(String(r.body.message), message, label);
}
const rows = (r: Reply, label = "") => {
  assert.equal(r.status, 200, `${label} ${JSON.stringify(r.body).slice(0, 200)}`);
  assert.ok(Array.isArray(r.body), label);
  return r.body as Array<Record<string, any>>;
};
const ids = (list: Array<Record<string, any>>, col = "id") => list.map((x) => String(x[col])).sort();

describe("the real local Supabase stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npx supabase start)" }, () => {
  let s: Stack;
  let sql: Sql;
  const created: string[] = [];
  const me = {} as Record<"alice" | "bob" | "carol" | "dora" | "admin" | "tom" | "tara" | "nobody" | "minorish", NewUser & { token: string; clientId?: string; studentIds: string[] }>;
  const asg = {} as Record<"GA" | "GB" | "GG" | "GE", string>;
  const res = {} as Record<"members" | "sample" | "draft" | "scheduled", string>;
  const seeded: Record<"A" | "B", Record<string, string>> = { A: {}, B: {} };
  let tomId = "";
  let taraId = "";

  // postgres.js returns a Result (an Array subclass); plain arrays compare cleanly with deepEqual.
  const own = async (text: string, params: unknown[] = []) => [...((await sql.unsafe(text, params as never[])) as unknown as Array<Record<string, any>>)];
  const as = (who: keyof typeof me) => me[who].token;
  const get = (who: keyof typeof me | null, path: string) => rest(s, who ? as(who) : null, "GET", path);

  async function person(key: keyof typeof me, options: { name: string; adult?: boolean; metadata?: Record<string, unknown> }) {
    const u = await newUser(s, options);
    created.push(u.id);
    me[key] = { ...u, token: await signIn(s, u.email, u.password), studentIds: [] };
  }

  async function family(key: "alice" | "bob" | "carol" | "dora", students: string[]) {
    const f = me[key];
    const client = await rest(s, f.token, "POST", "/clients", { body: { owner_profile_id: f.id } });
    f.clientId = rows({ ...client, status: client.status === 201 ? 200 : client.status }, `client for ${key}`)[0]!.id;
    for (const name of students) {
      const st = await rest(s, f.token, "POST", "/students", { body: { client_id: f.clientId, display_name: name } });
      f.studentIds.push(rows({ ...st, status: st.status === 201 ? 200 : st.status }, `student ${name}`)[0]!.id);
    }
  }

  before(async () => {
    s = stack();
    sql = openDb(s);
    await person("alice", { name: "Alice" });
    await person("bob", { name: "Bob" });
    await person("carol", { name: "Carol" });
    await person("dora", { name: "Dora" });
    await person("admin", { name: "Admin" });
    await person("tom", { name: "Tom" });
    await person("tara", { name: "Tara" });
    await person("nobody", { name: "Nobody" });
    await person("minorish", { name: "Minorish", adult: false });
    // Roles are set by the server, never by the person (a real operator would use promote-admin).
    await own("update public.profiles set role = 'ADMIN' where id = $1", [me.admin.id]);
    await own("update public.profiles set role = 'TUTOR' where id = any($1)", [[me.tom.id, me.tara.id]]);
    // The access tokens were issued before the role change; sign in again so the tokens are fresh.
    for (const k of ["admin", "tom", "tara"] as const) me[k].token = await signIn(s, me[k].email, me[k].password);

    await family("alice", ["Ava", "Alex"]);
    await family("bob", ["Ben"]);
    await family("carol", ["Cy"]);
    await family("dora", ["Dee"]);
    const [ava] = me.alice.studentIds;
    const [ben] = me.bob.studentIds;
    const [cy] = me.carol.studentIds;
    const [dee] = me.dora.studentIds;

    tomId = (await own("insert into public.tutors (profile_id, display_name) values ($1, $2) returning id", [me.tom.id, `rs-${runId} Tom`]))[0]!.id;
    taraId = (await own("insert into public.tutors (profile_id, display_name) values ($1, $2) returning id", [me.tara.id, `rs-${runId} Tara`]))[0]!.id;
    const assignment = async (key: keyof typeof asg, tutor: string, status: string, students: string[]) => {
      asg[key] = (await own("insert into public.tuition_assignments (title, subject, tutor_id, status) values ($1,'Maths',$2,$3) returning id", [`rs-${runId} ${key}`, tutor, status]))[0]!.id;
      for (const st of students) await own("insert into public.assignment_students (assignment_id, student_id) values ($1,$2)", [asg[key], st]);
    };
    await assignment("GA", tomId, "ACTIVE", [ava!]);
    await assignment("GB", taraId, "PAUSED", [ben!]);
    await assignment("GG", tomId, "ACTIVE", [ava!, dee!]);
    await assignment("GE", tomId, "ENDED", [cy!]);

    const resource = async (slug: string, tier: string, published: string | null) =>
      (await own(
        "insert into public.resources (slug, title, subject, level, topic, resource_type, access_tier, authorship, published_at) values ($1,$2,'Maths','GCSE','Algebra','worksheet',$3,'LearnThrive Tuition',$4) returning id",
        [`rs-${runId}-${slug}`, slug, tier, published],
      ))[0]!.id;
    res.members = await resource("pub-members", "members", new Date(Date.now() - 60_000).toISOString());
    res.sample = await resource("pub-sample", "free_sample", new Date(Date.now() - 60_000).toISOString());
    res.draft = await resource("draft", "members", null);
    res.scheduled = await resource("scheduled", "members", new Date(Date.now() + 86_400_000).toISOString());
    for (const [i, r] of Object.values(res).entries()) {
      await own("insert into public.resource_files (resource_id, storage_path, bytes, content_type, checksum_sha256) values ($1,$2,100,'application/pdf',$3)", [r, `rs-${runId}/file-${i}.pdf`, SHA]);
    }

    for (const [tag, who, n] of [["A", me.alice, 1], ["B", me.bob, 2]] as const) {
      const d = seeded[tag];
      await own("insert into public.billing_customers (client_id, stripe_customer_id) values ($1,$2)", [who.clientId, `cus_${runId}${n}`]);
      d.subscription = (await own("insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1,$2,'price_x','active','month') returning id", [who.clientId, `sub_${runId}${n}`]))[0]!.id;
      await own("insert into public.entitlements (client_id, source, subscription_id) values ($1,'subscription',$2)", [who.clientId, d.subscription]);
      d.grant = (await own("insert into public.admin_grants (client_id, reason) values ($1,'rs') returning id", [who.clientId]))[0]!.id;
      await own("insert into public.download_events (client_id, resource_id) values ($1,$2)", [who.clientId, res.members]);
      await own("insert into public.usage_counters (client_id, kind, window_start, count) values ($1,'assistant_message_day', date_trunc('day', now()), 3)", [who.clientId]);
      await own("insert into public.consents (profile_id, kind, version, text_sha256) values ($1,'terms','1',$2)", [who.id, SHA]);
      d.session = (await own("insert into public.chat_sessions (client_id, student_id, title) values ($1,$2,'Help') returning id", [who.clientId, who.studentIds[0]]))[0]!.id;
      d.message = (await own("insert into public.chat_messages (session_id, role, content) values ($1,'user','a secret question') returning id", [d.session]))[0]!.id;
      await own("insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1,$2,$3,10,'image/png')", [d.session, d.message, `rs-${runId}/${tag}.png`]);
    }
    await own("insert into public.entitlements (client_id, source, assignment_id) values ($1,'enrolled',$2)", [me.alice.clientId, asg.GA]);
    await own("insert into public.stripe_webhook_events (event_id, event_type) values ($1,'invoice.paid')", [`evt_${runId}`]);
  });

  after(async () => {
    if (!s) return;
    // Remove only what this run made (deleting a user cascades to their profile, family account, students, chats and counters).
    await own("delete from public.tuition_assignments where title like $1", [`rs-${runId} %`]);
    await own("delete from public.resources where slug like $1", [`rs-${runId}-%`]);
    await own("delete from public.tutors where display_name like $1", [`rs-${runId} %`]);
    await own("delete from public.stripe_webhook_events where event_id = $1", [`evt_${runId}`]);
    await own("delete from public.download_events where client_id is null");
    for (const id of created) await deleteUser(s, id);
    await sql.end({ timeout: 5 });
  });

  // ---------------------------------------------------------------------------------------------------------------- the server

  describe("the database itself", () => {
    test("every migration is applied, the server is Postgres 17, RLS is on for every table", async () => {
      const applied = (await own("select version from supabase_migrations.schema_migrations order by version")).map((r) => r.version);
      // Every file in supabase/migrations, in order: nothing missing and nothing extra applied.
      assert.deepEqual(applied, readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).map((f) => f.slice(0, 4)).sort());
      assert.match((await own("show server_version"))[0]!.server_version, /^17\./);
      const off = await own("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity");
      assert.deepEqual(off, []);
    });

    test("the stack's Auth user table has no extra trigger path that sets a role: role is CLIENT whatever the sign-up said", async () => {
      const mallory = await newUser(s, { name: "Mallory", metadata: { role: "ADMIN", user_role: "ADMIN", app_role: "ADMIN" } });
      created.push(mallory.id);
      const profile = (await own("select role, adult_confirmed_at, display_name from public.profiles where id = $1", [mallory.id]))[0]!;
      assert.equal(profile.role, "CLIENT");
      assert.ok(profile.adult_confirmed_at, "the adult declaration was recorded");
      assert.equal(profile.display_name, "Mallory");
      const token = await signIn(s, mallory.email, mallory.password);
      refused(await get(null, "/clients?select=id"), PERMISSION, "anon is refused outright");
      assert.deepEqual(rows(await rest(s, token, "GET", "/clients?select=id")), [], "and an 'ADMIN' by sign-up has no family rows, no admin reach");
      assert.deepEqual(rows(await rest(s, token, "GET", "/profiles?select=id,role")).map((r) => r.role), ["CLIENT"], "only her own profile is visible to her");
    });

    test("a sign-up without the adult declaration has no adult_confirmed_at, and so can never open a family account", async () => {
      const profile = (await own("select adult_confirmed_at from public.profiles where id = $1", [me.minorish.id]))[0]!;
      assert.equal(profile.adult_confirmed_at, null);
    });
  });

  // ---------------------------------------------------------------------------------------------------------- Auth, for real

  describe("Auth: sign-up, confirmation, sign-in, reset, refresh, sign-out", () => {
    test("the sign-up journey: unconfirmed cannot sign in, the emailed link carries a token hash to /account/confirm, confirming signs in", async () => {
      const email = `rs-${runId}-journey@example.com`;
      const up = await auth(s, "POST", "/signup", { body: { email, password: PASSWORD, data: { display_name: "Journey", adult_confirmed: true } } });
      assert.equal(up.status, 200, JSON.stringify(up.body));
      created.push(up.body.id);
      // Not confirmed yet: sign-in is refused with the code the site maps to "email_not_confirmed".
      const early = await auth(s, "POST", "/token?grant_type=password", { body: { email, password: PASSWORD } });
      assert.equal(early.status, 400);
      assert.equal(early.body.error_code, "email_not_confirmed");
      // The message: our template, with the site's own confirm page and the one-time token hash (not Supabase's own verify URL).
      const mail = await lastMail(s, email);
      assert.ok(mail, "a confirmation email reached the mail catcher");
      assert.equal(mail.subject, "Confirm your LearnThrive email address");
      const link = /href="([^"]+)"/.exec(mail.html)?.[1]?.replace(/&amp;/g, "&");
      assert.ok(link, "the email has a link");
      const url = new URL(link);
      assert.equal(url.origin + url.pathname, "http://localhost:3000/account/confirm");
      assert.equal(url.searchParams.get("type"), "signup");
      const tokenHash = url.searchParams.get("token_hash");
      assert.ok(tokenHash && tokenHash.length > 20);
      // Spending it (the site does this with a POST on a button press) gives a session; a second spend fails.
      const verified = await auth(s, "POST", "/verify", { body: { type: "signup", token_hash: tokenHash } });
      assert.equal(verified.status, 200, JSON.stringify(verified.body));
      assert.ok(verified.body.access_token && verified.body.refresh_token);
      assert.equal(verified.body.user.email, email);
      const again = await auth(s, "POST", "/verify", { body: { type: "signup", token_hash: tokenHash } });
      assert.notEqual(again.status, 200, "a confirmation link works once");
      // And now the password works, the profile exists, and the token is a real JWT PostgREST accepts.
      const signedIn = await auth(s, "POST", "/token?grant_type=password", { body: { email, password: PASSWORD } });
      assert.equal(signedIn.status, 200);
      const profile = await rest(s, signedIn.body.access_token, "GET", "/profiles?select=display_name,role");
      assert.deepEqual(rows(profile), [{ display_name: "Journey", role: "CLIENT" }]);
    });

    test("password rules: 12 characters minimum and nothing else on composition; at most 72 BYTES (bcrypt), counted in bytes not characters", async () => {
      const signUp = (password: string) => auth(s, "POST", "/signup", { body: { email: `rs-${runId}-pw${Math.random().toString(36).slice(2, 9)}@example.com`, password, data: { display_name: "W", adult_confirmed: true } } });
      for (const password of ["Short-1a", "elevenchars", "Aa1-Aa1-Aa1"]) {
        const r = await signUp(password);
        assert.equal(r.status, 422, `${password.length} characters: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error_code, "weak_password", "the code the site maps to its 'choose a different password' message");
      }
      // The site's own rule is length only, so lower case alone must be accepted (a long passphrase is not a weak password).
      for (const password of ["correct horse battery staple", "a".repeat(12), "é".repeat(36) /* exactly 72 bytes */, "x".repeat(72)]) {
        const r = await signUp(password);
        assert.equal(r.status, 200, `${password.length} characters, ${new TextEncoder().encode(password).length} bytes: ${JSON.stringify(r.body)}`);
        created.push(r.body.id);
      }
      for (const password of ["x".repeat(73), "é".repeat(37) /* 37 characters, 74 bytes */, "correct horse battery staple ".repeat(4)]) {
        const r = await signUp(password);
        assert.equal(r.status, 400, `${new TextEncoder().encode(password).length} bytes: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error_code, "validation_failed");
        assert.match(r.body.msg, /Password cannot be longer than 72/, "what supabaseAuth.ts maps to a password problem, not 'invalid email'");
      }
    });

    test("signing up with an address that already has an account is refused with user_already_exists, creates nothing, and leaves the account untouched", async () => {
      // The real service says so plainly (the site's SupabaseAccountAuth hides it: see the app-level test). The faked-fetch tests
      // assumed this code; here it is confirmed against the real GoTrue.
      const again = await auth(s, "POST", "/signup", { body: { email: me.alice.email, password: PASSWORD, data: { display_name: "Impostor", adult_confirmed: true } } });
      assert.equal(again.status, 422, JSON.stringify(again.body));
      assert.equal(again.body.error_code, "user_already_exists");
      assert.equal((await own("select display_name from public.profiles where id = $1", [me.alice.id]))[0]!.display_name, "Alice", "the real account is untouched");
      assert.equal((await own("select count(*)::int as n from auth.users where lower(email) = lower($1)", [me.alice.email]))[0]!.n, 1);
    });

    test("password reset: the recovery link opens /account/confirm with a token hash; spending it lets the password change; the old password stops working", async () => {
      const u = await newUser(s, { name: "Reset" });
      created.push(u.id);
      const asked = await auth(s, "POST", "/recover", { body: { email: u.email } });
      assert.equal(asked.status, 200);
      const mail = await lastMail(s, u.email);
      assert.ok(mail && /Reset your LearnThrive password/.test(mail.subject));
      const url = new URL(/href="([^"]+)"/.exec(mail.html)![1]!.replace(/&amp;/g, "&"));
      assert.equal(url.pathname, "/account/confirm");
      assert.equal(url.searchParams.get("type"), "recovery");
      const spent = await auth(s, "POST", "/verify", { body: { type: "recovery", token_hash: url.searchParams.get("token_hash") } });
      assert.equal(spent.status, 200, JSON.stringify(spent.body));
      const changed = await auth(s, "PUT", "/user", { token: spent.body.access_token, body: { password: "A-brand-New-Passw0rd" } });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.equal((await auth(s, "POST", "/token?grant_type=password", { body: { email: u.email, password: u.password } })).status, 400);
      assert.equal((await auth(s, "POST", "/token?grant_type=password", { body: { email: u.email, password: "A-brand-New-Passw0rd" } })).status, 200);
      // A weak new password is refused with weak_password.
      const weak = await auth(s, "PUT", "/user", { token: spent.body.access_token, body: { password: "short" } });
      assert.equal(weak.body.error_code, "weak_password");
    });

    test("refresh tokens rotate (single use), and after sign-out the token is dead", async () => {
      const u = await newUser(s, { name: "Refresh" });
      created.push(u.id);
      const first = await auth(s, "POST", "/token?grant_type=password", { body: { email: u.email, password: u.password } });
      assert.equal(first.status, 200);
      const refresh = (token: string) => auth(s, "POST", "/token?grant_type=refresh_token", { body: { refresh_token: token } });
      const second = await refresh(first.body.refresh_token);
      assert.equal(second.status, 200, JSON.stringify(second.body));
      assert.notEqual(second.body.refresh_token, first.body.refresh_token, "a new refresh token every time");
      assert.ok(second.body.expires_in <= 3600);
      const third = await refresh(second.body.refresh_token);
      assert.equal(third.status, 200);
      const fourth = await refresh(third.body.refresh_token);
      assert.equal(fourth.status, 200);
      // Rotation: GoTrue tolerates a spent token being presented again for a short while (the 10 s reuse interval, and the
      // newest predecessors, so a retry after a dropped response still works). A token several generations old, after that
      // interval, is refused. (Measured: with the chain at only two or three deep the oldest token was still accepted.)
      await new Promise((r) => setTimeout(r, 12_000));
      const stale = await refresh(first.body.refresh_token);
      assert.equal(stale.status, 400, "a refresh token three generations old is refused");
      assert.equal(stale.body.error_code, "refresh_token_already_used");
      const out = await auth(s, "POST", "/logout", { token: fourth.body.access_token, body: {} });
      assert.ok(out.status === 204 || out.status === 200);
      assert.equal((await refresh(fourth.body.refresh_token)).status, 400, "after sign-out the session's refresh token is gone");
    });

    test("anonymous sign-ins are off, and no external provider is enabled", async () => {
      const anon = await auth(s, "POST", "/signup", { body: {} });
      assert.ok(anon.status >= 400 && anon.status < 500, `anonymous sign-in: ${anon.status}`);
      const settings = await auth(s, "GET", "/settings");
      assert.equal(settings.status, 200);
      const providers = Object.entries(settings.body.external as Record<string, boolean>).filter(([, on]) => on).map(([name]) => name);
      assert.deepEqual(providers.sort(), ["email"]);
      assert.equal(settings.body.disable_signup, false);
      assert.equal(settings.body.mailer_autoconfirm, false, "email confirmation is required");
    });
  });

  // -------------------------------------------------------------------------------------------------- RLS over real HTTP

  describe("a signed-in user reads only their own family's rows (PostgREST, real tokens)", () => {
    const TABLES: Array<{ table: string; key: string; where: (f: (typeof me)["alice"]) => string }> = [
      { table: "profiles", key: "id", where: (f) => `id = '${f.id}'` },
      { table: "clients", key: "id", where: (f) => `id = '${f.clientId}'` },
      { table: "students", key: "id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "client_students", key: "student_id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "consents", key: "id", where: (f) => `profile_id = '${f.id}'` },
      { table: "subscriptions", key: "id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "entitlements", key: "id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "usage_counters", key: "id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "chat_sessions", key: "id", where: (f) => `client_id = '${f.clientId}'` },
      { table: "chat_messages", key: "id", where: (f) => `session_id in (select id from public.chat_sessions where client_id = '${f.clientId}')` },
      { table: "chat_files", key: "id", where: (f) => `session_id in (select id from public.chat_sessions where client_id = '${f.clientId}')` },
    ];
    for (const spec of TABLES) {
      test(`${spec.table}: Alice sees exactly hers, Bob exactly his, and neither can fetch the other's by id`, async () => {
        for (const [a, b] of [["alice", "bob"], ["bob", "alice"]] as const) {
          const mine = ids(await own(`select ${spec.key} from public.${spec.table} where ${spec.where(me[a])}`), spec.key);
          const theirs = ids(await own(`select ${spec.key} from public.${spec.table} where ${spec.where(me[b])}`), spec.key);
          assert.ok(mine.length > 0 && theirs.length > 0, `fixture for ${spec.table} must not be empty`);
          assert.deepEqual(ids(rows(await get(a, `/${spec.table}?select=${spec.key}`), `${a} ${spec.table}`), spec.key), mine);
          assert.deepEqual(rows(await get(a, `/${spec.table}?select=${spec.key}&${spec.key}=in.(${theirs.join(",")})`)), [], "the other family's rows, asked for by their exact ids");
        }
      });
    }

    test("a user with no family account sees no family rows; only their own profile", async () => {
      for (const { table } of TABLES.filter((t) => t.table !== "profiles" && t.table !== "consents")) assert.deepEqual(rows(await get("nobody", `/${table}?select=*`)), [], table);
      assert.equal(rows(await get("nobody", "/profiles?select=id")).length, 1);
    });

    test("a family not on the group assignment cannot see who else is on it; tutors see their own assignments and no families", async () => {
      assert.deepEqual(ids(rows(await get("alice", "/assignment_students?select=assignment_id")), "assignment_id"), [asg.GA, asg.GG].sort());
      assert.deepEqual(rows(await get("alice", `/assignment_students?select=student_id&assignment_id=eq.${asg.GG}`)).map((r) => r.student_id), [me.alice.studentIds[0]], "not Dee, who shares the group");
      assert.deepEqual(ids(rows(await get("bob", "/tuition_assignments?select=id"))), [asg.GB]);
      assert.deepEqual(ids(rows(await get("tom", "/tuition_assignments?select=id"))), [asg.GA, asg.GE, asg.GG].sort());
      assert.deepEqual(ids(rows(await get("tara", "/tuition_assignments?select=id"))), [asg.GB]);
      for (const t of ["clients", "students", "client_students", "subscriptions", "entitlements", "chat_sessions", "consents", "usage_counters"]) assert.deepEqual(rows(await get("tom", `/${t}?select=*`)), [], t);
    });

    test("a second guardian linked by the server can read the student but not change or delete it, and sees no chats of that family", async () => {
      const ava = me.alice.studentIds[0]!;
      await own("insert into public.client_students (client_id, student_id) values ($1,$2)", [me.bob.clientId, ava]);
      try {
        assert.equal(rows(await get("bob", `/students?select=id&id=eq.${ava}`)).length, 1);
        assert.deepEqual(rows(await rest(s, as("bob"), "PATCH", `/students?id=eq.${ava}`, { body: { display_name: "Hijack" } })), []);
        assert.deepEqual(rows(await rest(s, as("bob"), "DELETE", `/students?id=eq.${ava}`)), []);
        assert.equal((await own("select display_name from public.students where id = $1", [ava]))[0]!.display_name, "Ava");
        assert.deepEqual(ids(rows(await get("bob", "/chat_sessions?select=id"))), [seeded.B.session!]);
      } finally {
        await own("delete from public.client_students where client_id = $1 and student_id = $2", [me.bob.clientId, ava]);
      }
    });
  });

  describe("a user cannot write into another family, or move rows between families", () => {
    const widen = async (grant: string, revoke: string, fn: () => Promise<void>) => {
      await own(grant);
      try {
        await fn();
      } finally {
        await own(revoke);
      }
    };

    test("clients: only your own profile, only after the adult declaration, only once; nothing about it is editable", async () => {
      refused(await rest(s, as("nobody"), "POST", "/clients", { body: { owner_profile_id: me.bob.id } }), RLS, "someone else's profile");
      refused(await rest(s, as("minorish"), "POST", "/clients", { body: { owner_profile_id: me.minorish.id } }), RLS, "no adult declaration");
      const dup = await rest(s, as("alice"), "POST", "/clients", { body: { owner_profile_id: me.alice.id } });
      assert.equal(dup.status, 409, "a second family account for the same person");
      refused(await rest(s, as("alice"), "PATCH", `/clients?id=eq.${me.alice.clientId}`, { body: { owner_profile_id: me.bob.id } }), PERMISSION, "re-own");
      refused(await rest(s, as("alice"), "PATCH", `/clients?id=eq.${me.alice.clientId}`, { body: { active: false } }), PERMISSION, "deactivate");
      refused(await rest(s, as("alice"), "DELETE", `/clients?id=eq.${me.alice.clientId}`), PERMISSION, "delete");
      const made = rows({ ...(await rest(s, as("nobody"), "POST", "/clients", { body: { owner_profile_id: me.nobody.id } })), status: 200 });
      assert.ok(made[0]!.id, "the legitimate path works");
      await own("delete from public.clients where id = $1", [made[0]!.id]);
    });

    test("students: cannot add to, edit, delete or re-parent another family's students; ownership columns are not writable", async () => {
      const ava = me.alice.studentIds[0]!;
      const ben = me.bob.studentIds[0]!;
      refused(await rest(s, as("alice"), "POST", "/students", { body: { client_id: me.bob.clientId, display_name: "Intruder" } }), RLS, "insert into Bob's family");
      assert.deepEqual(rows(await rest(s, as("alice"), "PATCH", `/students?id=eq.${ben}`, { body: { display_name: "Pwned" } })), []);
      assert.deepEqual(rows(await rest(s, as("alice"), "DELETE", `/students?id=eq.${ben}`)), []);
      assert.equal((await own("select display_name from public.students where id = $1", [ben]))[0]!.display_name, "Ben");
      for (const body of [{ client_id: me.bob.clientId }, { is_minor: false }, { active: false }, { id: ZERO }]) refused(await rest(s, as("alice"), "PATCH", `/students?id=eq.${ava}`, { body }), PERMISSION, JSON.stringify(body));
      // Belt and braces: with the column grant widened by mistake, the policy still refuses to move a student.
      await widen("grant update (client_id) on public.students to authenticated", "revoke update (client_id) on public.students from authenticated", async () => {
        refused(await rest(s, as("alice"), "PATCH", `/students?id=eq.${ava}`, { body: { client_id: me.bob.clientId } }), RLS, "move to Bob");
        assert.deepEqual(rows(await rest(s, as("alice"), "PATCH", `/students?id=eq.${ben}`, { body: { client_id: me.alice.clientId } })), [], "pull Bob's student into Alice's family");
      });
      assert.equal((await own("select client_id from public.students where id = $1", [ava]))[0]!.client_id, me.alice.clientId);
      assert.equal((await own("select client_id from public.students where id = $1", [ben]))[0]!.client_id, me.bob.clientId);
      // The owning family can add, rename and remove its own.
      const made = rows({ ...(await rest(s, as("alice"), "POST", "/students", { body: { client_id: me.alice.clientId, display_name: "Temp" } })), status: 200 });
      assert.equal(rows(await rest(s, as("alice"), "PATCH", `/students?id=eq.${made[0]!.id}`, { body: { display_name: "Temp2" } })).length, 1);
      assert.equal(rows(await rest(s, as("alice"), "DELETE", `/students?id=eq.${made[0]!.id}`)).length, 1);
    });

    test("client_students: nobody can link themselves to someone else's student or remove a link", async () => {
      refused(await rest(s, as("alice"), "POST", "/client_students", { body: { client_id: me.alice.clientId, student_id: me.bob.studentIds[0] } }), PERMISSION);
      refused(await rest(s, as("alice"), "DELETE", `/client_students?student_id=eq.${me.alice.studentIds[0]}`), PERMISSION);
      assert.deepEqual(rows(await get("alice", `/students?id=eq.${me.bob.studentIds[0]}`)), []);
    });

    test("consents: only your own profile and your own students; no backdating, no re-pointing, no forging a withdrawal", async () => {
      const post = (who: "alice", profile: string, student: string | null, extra: Record<string, unknown> = {}) =>
        rest(s, as(who), "POST", "/consents", { body: { profile_id: profile, student_id: student, kind: "ai_assistant", version: "1", text_sha256: SHA, ...extra } });
      refused(await post("alice", me.bob.id, null), RLS, "for Bob");
      refused(await post("alice", me.alice.id, me.bob.studentIds[0]!), RLS, "about Bob's child");
      assert.equal((await post("alice", me.alice.id, me.alice.studentIds[0]!)).status, 201);
      refused(await post("alice", me.alice.id, null, { granted_at: "2020-01-01T00:00:00Z" }), PERMISSION, "backdated");
      const bobConsent = (await own("select id from public.consents where profile_id = $1 limit 1", [me.bob.id]))[0]!.id;
      assert.deepEqual(rows(await rest(s, as("alice"), "PATCH", `/consents?id=eq.${bobConsent}`, { body: { withdrawn_at: new Date().toISOString() } })), [], "withdraw Bob's consent");
      const mine = (await own("select id from public.consents where profile_id = $1 limit 1", [me.alice.id]))[0]!.id;
      refused(await rest(s, as("alice"), "PATCH", `/consents?id=eq.${mine}`, { body: { profile_id: me.bob.id } }), PERMISSION, "re-point");
      refused(await rest(s, as("alice"), "DELETE", `/consents?id=eq.${mine}`), PERMISSION, "delete");
      await widen("grant update (profile_id) on public.consents to authenticated", "revoke update (profile_id) on public.consents from authenticated", async () => {
        refused(await rest(s, as("alice"), "PATCH", `/consents?id=eq.${mine}`, { body: { profile_id: me.bob.id } }), RLS, "re-point with a widened grant");
      });
      // Withdrawing your own is allowed, and the time recorded is the SERVER's (0008), whatever the device sent: not the year 2099.
      const withdrawn = rows(await rest(s, as("alice"), "PATCH", `/consents?id=eq.${mine}`, { body: { withdrawn_at: "2099-01-01T00:00:00Z" } }));
      assert.equal(withdrawn.length, 1);
      assert.ok(Math.abs(Date.parse(withdrawn[0]!.withdrawn_at) - Date.now()) < 60_000, `recorded ${withdrawn[0]!.withdrawn_at}`);
      const again = await rest(s, as("alice"), "PATCH", `/consents?id=eq.${mine}`, { body: { withdrawn_at: "2020-01-01T00:00:00Z" } });
      assert.equal(again.status, 400, "a recorded withdrawal cannot be edited");
      assert.match(again.body.message, /cannot be changed or undone/);
    });

    test("chat_sessions: cannot create for, edit, move or hide another family's chats; cannot touch deadlines; deleting hides at once", async () => {
      const post = (client: string | undefined, student: string | null, extra: Record<string, unknown> = {}) => rest(s, as("alice"), "POST", "/chat_sessions", { body: { client_id: client, student_id: student, title: "t", ...extra } });
      refused(await post(me.bob.clientId, null), RLS, "for Bob's family");
      refused(await post(me.alice.clientId, me.bob.studentIds[0]!), RLS, "about Bob's child");
      assert.equal((await post(me.alice.clientId, me.alice.studentIds[0]!)).status, 201);
      refused(await post(me.alice.clientId, null, { delete_after: "2099-01-01T00:00:00Z" }), PERMISSION, "own the deadline");
      const bobSession = seeded.B.session!;
      assert.deepEqual(rows(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${bobSession}`, { body: { title: "x" } })), []);
      refused(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${bobSession}`, { body: { deletion_requested_at: new Date().toISOString() } }), PERMISSION);
      assert.deepEqual((await rpc(s, as("alice"), "request_chat_deletion", { p_session_id: bobSession })).body, false, "someone else's chat: nothing happens");
      refused(await rpc(s, null, "request_chat_deletion", { p_session_id: bobSession }), PERMISSION, "anon");
      assert.deepEqual(ids(rows(await get("bob", `/chat_sessions?select=id&id=eq.${bobSession}`))), [bobSession], "Bob's chat is untouched");
      refused(await rest(s, as("alice"), "DELETE", `/chat_sessions?id=eq.${seeded.A.session}`), PERMISSION);
      for (const body of [{ client_id: me.bob.clientId }, { delete_after: "2099-01-01T00:00:00Z" }, { created_at: new Date().toISOString() }, { id: ZERO }]) refused(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${seeded.A.session}`, { body }), PERMISSION, JSON.stringify(body));
      await widen("grant update (client_id, student_id) on public.chat_sessions to authenticated", "revoke update (client_id, student_id) on public.chat_sessions from authenticated", async () => {
        refused(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${seeded.A.session}`, { body: { client_id: me.bob.clientId } }), RLS);
        refused(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${seeded.A.session}`, { body: { student_id: me.bob.studentIds[0] } }), RLS);
      });
      // Deleting a chat hides it (and its messages and files) at once, and cannot be undone by the user.
      const mine = rows({ ...(await rest(s, as("alice"), "POST", "/chat_sessions", { body: { client_id: me.alice.clientId } })), status: 200 })[0]!.id;
      const message = (await own("insert into public.chat_messages (session_id, role, content) values ($1,'user','x') returning id", [mine]))[0]!.id;
      await own("insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1,$2,'rs/del.png',5,'image/png')", [mine, message]);
      assert.equal(rows(await get("alice", `/chat_messages?select=id&session_id=eq.${mine}`)).length, 1);
      assert.equal((await rpc(s, as("alice"), "request_chat_deletion", { p_session_id: mine })).body, true);
      assert.equal((await rpc(s, as("alice"), "request_chat_deletion", { p_session_id: mine })).body, false, "already requested");
      for (const t of ["chat_sessions?id=eq." + mine, "chat_messages?session_id=eq." + mine, "chat_files?session_id=eq." + mine]) assert.deepEqual(rows(await get("alice", `/${t}`)), [], t);
      refused(await rest(s, as("alice"), "PATCH", `/chat_sessions?id=eq.${mine}`, { body: { deletion_requested_at: null } }), PERMISSION, "undelete");
      assert.equal((await own("select 1 from public.chat_files where session_id = $1", [mine])).length, 1, "the row stays for the retention job");
    });

    test("profiles: you can rename yourself and nothing else; no role escalation, no adult flag, no new profiles", async () => {
      assert.equal(rows(await rest(s, as("alice"), "PATCH", `/profiles?id=eq.${me.alice.id}`, { body: { display_name: "Alice B" } })).length, 1);
      assert.deepEqual(rows(await rest(s, as("alice"), "PATCH", `/profiles?id=eq.${me.bob.id}`, { body: { display_name: "Pwned" } })), []);
      assert.equal((await own("select display_name from public.profiles where id = $1", [me.bob.id]))[0]!.display_name, "Bob");
      for (const body of [{ role: "ADMIN" }, { role: "TUTOR" }, { adult_confirmed_at: new Date().toISOString() }, { created_at: new Date().toISOString() }, { id: me.bob.id }]) refused(await rest(s, as("alice"), "PATCH", `/profiles?id=eq.${me.alice.id}`, { body }), PERMISSION, JSON.stringify(body));
      refused(await rest(s, as("minorish"), "PATCH", `/profiles?id=eq.${me.minorish.id}`, { body: { adult_confirmed_at: new Date().toISOString() } }), PERMISSION, "self-declare adult after the fact");
      refused(await rest(s, as("alice"), "POST", "/profiles", { body: { id: ZERO, role: "ADMIN" } }), PERMISSION, "new profile");
      refused(await rest(s, as("alice"), "DELETE", `/profiles?id=eq.${me.alice.id}`), PERMISSION, "delete");
      assert.equal((await own("select role from public.profiles where id = $1", [me.alice.id]))[0]!.role, "CLIENT");
    });
  });

  describe("tables only the server may write", () => {
    const SERVER_ONLY = ["subscriptions", "entitlements", "usage_counters", "chat_messages", "chat_files", "tutors", "tuition_assignments", "assignment_students", "client_students", "resources", "resource_files", "billing_customers", "admin_grants", "download_events", "stripe_webhook_events"];
    const NEVER_READABLE = ["resource_files", "billing_customers", "admin_grants", "download_events", "stripe_webhook_events"];

    for (const table of SERVER_ONLY) {
      test(`${table}: a signed-in user, an admin and anon can neither insert, update nor delete`, async () => {
        const col = (await own("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_identity = 'NO' and is_generated = 'NEVER' order by ordinal_position limit 1", [table]))[0]!.column_name;
        for (const who of ["alice", "admin", null] as const) {
          const token = who ? as(who) : null;
          refused(await rest(s, token, "POST", `/${table}`, { body: {} }), PERMISSION, `${who} insert`);
          refused(await rest(s, token, "PATCH", `/${table}?${col}=not.is.null`, { body: { [col]: null } }), PERMISSION, `${who} update`);
          refused(await rest(s, token, "DELETE", `/${table}?${col}=not.is.null`), PERMISSION, `${who} delete`);
        }
      });
    }

    for (const table of NEVER_READABLE) {
      test(`${table}: not even readable by a user, an admin or anon; the server (secret key) reads it`, async () => {
        for (const who of ["alice", "admin", null] as const) refused(await rest(s, who ? as(who) : null, "GET", `/${table}?select=*`), PERMISSION, `${who}`);
        assert.ok(rows(await rest(s, null, "GET", `/${table}?select=*`, { key: s.secret })).length > 0, "the server can read it");
      });
    }

    test("a user cannot grant themselves access: entitlements, subscriptions, grants, downloads, webhooks", async () => {
      refused(await rest(s, as("carol"), "POST", "/entitlements", { body: { client_id: me.carol.clientId, source: "admin_grant", admin_grant_id: seeded.A.grant } }), PERMISSION);
      refused(await rest(s, as("carol"), "POST", "/subscriptions", { body: { client_id: me.carol.clientId, stripe_subscription_id: "sub_fake", stripe_price_id: "price_x", status: "active", plan_interval: "year" } }), PERMISSION);
      refused(await rest(s, as("carol"), "PATCH", `/subscriptions?id=not.is.null`, { body: { status: "active" } }), PERMISSION);
      refused(await rest(s, as("alice"), "PATCH", `/entitlements?client_id=eq.${me.alice.clientId}`, { body: { ends_at: null } }), PERMISSION);
      refused(await rest(s, as("carol"), "POST", "/download_events", { body: { client_id: me.carol.clientId, resource_id: res.members } }), PERMISSION);
      refused(await rest(s, as("carol"), "POST", "/stripe_webhook_events", { body: { event_id: "evt_forged", event_type: "invoice.paid" } }), PERMISSION);
      assert.deepEqual(rows(await get("carol", "/entitlements?select=id")), []);
    });

    test("client_is_enrolled is callable by the server only; it follows ACTIVE assignments", async () => {
      const arg = ((await own("select pg_get_function_arguments(oid) as a from pg_proc where proname = 'client_is_enrolled' and pronamespace = 'public'::regnamespace"))[0]!.a as string).split(" ")[0]!;
      refused(await rpc(s, as("alice"), "client_is_enrolled", { [arg]: me.alice.clientId }), PERMISSION, "user");
      refused(await rpc(s, null, "client_is_enrolled", { [arg]: me.alice.clientId }), PERMISSION, "anon");
      const enrolled = async (clientId: string) => (await rpc(s, null, "client_is_enrolled", { [arg]: clientId }, s.secret)).body;
      assert.equal(await enrolled(me.alice.clientId!), true, "Ava is on active GA and GG");
      assert.equal(await enrolled(me.dora.clientId!), true, "Dee is on the active group GG");
      assert.equal(await enrolled(me.bob.clientId!), false, "Ben's only assignment is PAUSED");
      assert.equal(await enrolled(me.carol.clientId!), false, "Cy's assignment has ended");
      assert.equal(await enrolled(ZERO), false);
    });
  });

  describe("the public catalogue", () => {
    const mine = (list: Array<Record<string, any>>) => list.map((r) => r.slug as string).filter((slug) => slug.startsWith(`rs-${runId}-`)).sort();
    test("anon sees published resources only; a user sees the same; an admin also sees drafts and scheduled", async () => {
      const published = [`rs-${runId}-pub-members`, `rs-${runId}-pub-sample`];
      assert.deepEqual(mine(rows(await get(null, "/resources?select=slug"))), published);
      assert.deepEqual(mine(rows(await get("alice", "/resources?select=slug"))), published);
      assert.deepEqual(mine(rows(await get("admin", "/resources?select=slug"))), [`rs-${runId}-draft`, ...published, `rs-${runId}-scheduled`].sort());
    });

    test("file paths are never readable: not the resource_files table, not a join, and the catalogue has no path column", async () => {
      refused(await get(null, "/resource_files?select=storage_path"), PERMISSION, "anon");
      refused(await get("alice", "/resource_files?select=storage_path"), PERMISSION, "user");
      refused(await get("alice", "/resources?select=title,resource_files(storage_path)"), PERMISSION, "embedded join");
      const cols = (await own("select column_name from information_schema.columns where table_name = 'resources' and table_schema = 'public'")).map((c) => c.column_name as string);
      assert.deepEqual(cols.filter((c) => /path|url|bucket|checksum/i.test(c)), []);
    });

    test("anon cannot read anything else in the schema, and nobody but the server can write resources", async () => {
      const others = (await own("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'resources'")).map((r) => r.relname as string);
      assert.ok(others.length >= 19);
      for (const t of others) refused(await get(null, `/${t}?select=*`), PERMISSION, t);
      refused(await rest(s, null, "PATCH", "/resources?id=not.is.null", { body: { published_at: null } }), PERMISSION, "anon unpublish");
      refused(await rest(s, as("alice"), "PATCH", `/resources?id=eq.${res.members}`, { body: { access_tier: "free_sample" } }), PERMISSION, "user retier");
      refused(await rest(s, as("admin"), "PATCH", `/resources?id=eq.${res.members}`, { body: { authorship: "x" } }), PERMISSION, "admin session is not a write path");
      assert.equal(rows(await rest(s, null, "PATCH", `/resources?id=eq.${res.members}`, { body: { version: 1 }, key: s.secret })).length, 1, "the server can");
    });

    test("a scheduled resource appears once its date passes, with no write to the row", async () => {
      assert.equal(rows(await get(null, `/resources?select=id&id=eq.${res.scheduled}`)).length, 0);
      await own("update public.resources set published_at = now() - interval '1 second' where id = $1", [res.scheduled]);
      try {
        assert.equal(rows(await get(null, `/resources?select=id&id=eq.${res.scheduled}`)).length, 1);
      } finally {
        await own("update public.resources set published_at = now() + interval '1 day' where id = $1", [res.scheduled]);
      }
    });
  });

  describe("administrators and the service role", () => {
    test("an admin reads accounts for support, but never conversations, consents or usage; an admin session is not a write path", async () => {
      for (const t of ["clients", "students", "subscriptions", "profiles"]) assert.ok(rows(await get("admin", `/${t}?select=id`)).length > 0, t);
      for (const t of ["chat_sessions", "chat_messages", "chat_files", "consents", "usage_counters"]) assert.deepEqual(rows(await get("admin", `/${t}?select=*`)), [], t);
      assert.deepEqual(rows(await rest(s, as("admin"), "PATCH", `/students?id=eq.${me.alice.studentIds[0]}`, { body: { display_name: "x" } })), []);
      assert.deepEqual(rows(await rest(s, as("admin"), "PATCH", `/profiles?id=eq.${me.alice.id}`, { body: { display_name: "x" } })), []);
      refused(await rest(s, as("admin"), "POST", "/students", { body: { client_id: me.alice.clientId, display_name: "x" } }), RLS);
      refused(await rest(s, as("admin"), "PATCH", `/profiles?id=eq.${me.alice.id}`, { body: { role: "ADMIN" } }), PERMISSION);
    });

    test("the service role (either key format) bypasses RLS: it sees every family; the browser keys do not", async () => {
      const ours = (list: Array<Record<string, any>>) => ids(list).filter((id) => [me.alice, me.bob, me.carol, me.dora].some((f) => f.clientId === id));
      const expected = [me.alice, me.bob, me.carol, me.dora].map((f) => f.clientId!).sort();
      assert.deepEqual(ours(rows(await rest(s, null, "GET", "/clients?select=id", { key: s.secret }))), expected, "sb_secret_ as the apikey only");
      assert.deepEqual(ours(rows(await rest(s, null, "GET", "/clients?select=id", { key: s.serviceJwt }))), expected, "the legacy service_role JWT");
      refused(await rest(s, null, "GET", "/clients?select=id", { key: s.anonJwt }), PERMISSION, "the legacy anon JWT does not");
      refused(await rest(s, null, "GET", "/clients?select=id", { key: s.publishable }), PERMISSION, "the publishable key does not");
    });
  });

  // ---------------------------------------------------------------------------------------------------- what the API exposes

  describe("what the Data API exposes", () => {
    test("only the public schema is reachable: private tables and functions answer with a schema error, not data", async () => {
      const read = await rest(s, as("alice"), "GET", "/profiles?select=*", { headers: { "Accept-Profile": "private" } });
      assert.equal(read.status, 406, JSON.stringify(read.body));
      assert.equal(read.body.code, "PGRST106");
      const call = await rpc(s, as("alice"), "is_admin", {}, undefined, { "Content-Profile": "private" });
      assert.equal(call.status, 406);
      assert.equal(call.body.code, "PGRST106");
      for (const schema of ["auth", "storage", "extensions", "pg_catalog", "information_schema"]) {
        const r = await rest(s, as("alice"), "GET", "/users?select=*", { headers: { "Accept-Profile": schema } });
        assert.equal(r.status, 406, schema);
      }
      // The trigger function is not an API endpoint at all (a trigger function cannot be called, so PostgREST does not list it).
      const trigger = await rpc(s, as("alice"), "handle_new_user", {});
      assert.ok(trigger.status === 404 && trigger.body.code === "PGRST202", `handle_new_user answered ${trigger.status}`);
    });

    test("the schema description (OpenAPI) shows an anonymous caller only the published catalogue; the server key sees the whole schema", async () => {
      const anon = await rest(s, null, "GET", "/", { headers: { Accept: "application/openapi+json" } });
      assert.equal(anon.status, 200);
      assert.deepEqual(Object.keys(anon.body.paths).sort(), ["/", "/resources"]);
      const server = await rest(s, null, "GET", "/", { key: s.secret, headers: { Accept: "application/openapi+json" } });
      const names = Object.keys(server.body.paths);
      assert.ok(names.includes("/clients") && names.includes("/resources"));
      assert.ok(!names.some((p) => /private|auth\.|storage\./.test(p)), "no private schema object is described");
    });

    test("GraphQL is not served", async () => {
      const r = await fetch(`${s.api}/graphql/v1`, { method: "POST", headers: { apikey: s.publishable, "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }) });
      assert.notEqual(r.status, 200, `GraphQL answered ${r.status}`);
    });
  });
  // --------------------------------------------------------------------------------------------------------------- Storage

  describe("Storage: private buckets, only the server reads and writes, only a signed URL downloads", () => {
    const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const key = (k: string, token?: string | null) => ({ apikey: k, ...(token ? { Authorization: `Bearer ${token}` } : /^eyJ/.test(k) ? { Authorization: `Bearer ${k}` } : {}) });
    const call = async (method: string, path: string, init: { key?: string; token?: string | null; type?: string; body?: RequestInit["body"]; json?: unknown } = {}) => {
      const response = await fetch(`${s.api}/storage/v1${path}`, {
        method,
        headers: { ...key(init.key ?? s.publishable, init.token), ...(init.json !== undefined ? { "Content-Type": "application/json" } : init.type ? { "Content-Type": init.type } : {}) },
        body: init.json !== undefined ? JSON.stringify(init.json) : (init.body ?? undefined),
      });
      const text = await response.text();
      let body: any = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* binary or empty */
      }
      return { status: response.status, body, bytes: text.length };
    };
    const put = (bucket: string, name: string, bytes: Uint8Array, type: string, k = s.secret) => call("POST", `/object/${bucket}/${name}`, { key: k, type, body: bytes as unknown as NonNullable<RequestInit["body"]> });
    const sign = (bucket: string, name: string, expiresIn = 60, k = s.secret) => call("POST", `/object/sign/${bucket}/${name}`, { key: k, json: { expiresIn } });
    const folder = `rs-${runId}`;

    after(async () => {
      for (const [bucket, name] of [["library", "a.pdf"], ["library", "b.pdf"], ["chat-uploads", "a.png"]]) await call("DELETE", `/object/${bucket}/${folder}/${name}`, { key: s.secret });
    });

    test("both buckets exist, are private, carry their limits, and storage.objects has row level security with NO policy for anyone", async () => {
      const buckets = await own("select id, public, file_size_limit::int as lim, allowed_mime_types as mime from storage.buckets where id in ('library','chat-uploads') order by id");
      assert.deepEqual(buckets, [
        { id: "chat-uploads", public: false, lim: 15 * 1024 * 1024, mime: ["image/jpeg", "image/png", "application/pdf"] },
        { id: "library", public: false, lim: 25 * 1024 * 1024, mime: ["application/pdf"] },
      ]);
      assert.equal((await own("select relrowsecurity from pg_class where oid = 'storage.objects'::regclass"))[0]!.relrowsecurity, true);
      assert.deepEqual(await own("select policyname, roles::text from pg_policies where schemaname = 'storage'"), [], "no storage policy exists for any role: add one and this fails");
    });

    test("the server uploads with either key format; the bucket enforces its MIME types", async () => {
      assert.equal((await put("library", `${folder}/a.pdf`, PDF, "application/pdf", s.secret)).status, 200, "sb_secret_ as the apikey alone");
      assert.equal((await put("library", `${folder}/b.pdf`, PDF, "application/pdf", s.serviceJwt)).status, 200, "the legacy service_role JWT (apikey + bearer)");
      const text = await put("library", `${folder}/x.txt`, new TextEncoder().encode("hello"), "text/plain");
      assert.equal(text.body.statusCode, "415", "library is PDF only");
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      assert.equal((await put("chat-uploads", `${folder}/a.png`, png, "image/png")).status, 200);
      assert.equal((await put("chat-uploads", `${folder}/a.gif`, new Uint8Array([71, 73, 70, 56]), "image/gif")).body.statusCode, "415", "chat-uploads takes JPEG, PNG and PDF only");
    });

    test("the bucket enforces its size limit: just over 25 MB is refused for the library", async () => {
      const big = new Uint8Array(25 * 1024 * 1024 + 1024);
      big.set(PDF);
      const r = await put("library", `${folder}/big.pdf`, big, "application/pdf");
      assert.equal(r.body.statusCode, "413", JSON.stringify(r.body).slice(0, 160));
    });

    test("anonymous callers and signed-in people can neither list, read, write, delete, move nor sign: the bucket looks empty and closed", async () => {
      for (const [who, token] of [["anon", null], ["alice", as("alice")], ["admin", as("admin")]] as const) {
        for (const bucket of ["library", "chat-uploads"]) {
          const list = await call("POST", `/object/list/${bucket}`, { token, json: { prefix: folder, limit: 100 } });
          assert.ok(list.status === 200 && Array.isArray(list.body) && list.body.length === 0, `${who} listing ${bucket}: ${list.status} ${JSON.stringify(list.body).slice(0, 100)}`);
        }
        const read = await call("GET", `/object/library/${folder}/a.pdf`, { token });
        assert.ok(read.status >= 400, `${who} reading: ${read.status}`);
        const authed = await call("GET", `/object/authenticated/library/${folder}/a.pdf`, { token });
        assert.ok(authed.status >= 400, `${who} reading as authenticated: ${authed.status}`);
        const write = await call("POST", `/object/library/${folder}/evil.pdf`, { token, type: "application/pdf", body: PDF as unknown as NonNullable<RequestInit["body"]> });
        assert.equal(write.body.statusCode, "403", `${who} writing: ${JSON.stringify(write.body).slice(0, 120)}`);
        assert.match(String(write.body.message), /row-level security/i);
        const del = await call("DELETE", `/object/library/${folder}/a.pdf`, { token });
        assert.ok(del.status >= 400 || (Array.isArray(del.body) && del.body.length === 0), `${who} deleting: ${del.status}`);
        const signed = await call("POST", `/object/sign/library/${folder}/a.pdf`, { token, json: { expiresIn: 60 } });
        assert.ok(signed.status >= 400, `${who} signing: ${signed.status}`);
        const move = await call("POST", "/object/move", { token, json: { bucketId: "library", sourceKey: `${folder}/a.pdf`, destinationKey: `${folder}/stolen.pdf` } });
        assert.ok(move.status >= 400, `${who} moving: ${move.status}`);
      }
      assert.equal((await call("GET", `/object/public/library/${folder}/a.pdf`)).status, 400, "no public URL for a private bucket");
      assert.equal((await call("GET", `/object/public/chat-uploads/${folder}/a.png`)).status, 400);
      // The objects are all still there, untouched, for the server.
      const listed = await call("POST", "/object/list/library", { key: s.secret, json: { prefix: folder, limit: 100 } });
      assert.equal(listed.body.filter((o: any) => o.name?.endsWith(".pdf")).length, 2);
    });

    test("only the server's signed URL downloads: it works, a changed or missing token fails, an expired one fails, and the user's token cannot make one", async () => {
      const made = await sign("library", `${folder}/a.pdf`, 60);
      assert.equal(made.status, 200);
      const path: string = made.body.signedURL;
      assert.match(path, new RegExp(`^/object/sign/library/${folder}/a\\.pdf\\?token=`));
      const good = await fetch(`${s.api}/storage/v1${path}`);
      assert.equal(good.status, 200);
      assert.equal(new TextDecoder().decode(new Uint8Array(await good.arrayBuffer())).slice(0, 5), "%PDF-");
      assert.equal((await fetch(`${s.api}/storage/v1${path}x`)).status, 400, "a changed token");
      assert.equal((await fetch(`${s.api}/storage/v1${path.split("?")[0]}`)).status, 400, "no token");
      const other = await sign("library", `${folder}/b.pdf`, 60);
      const swapped = `${path.split("?")[0]}?${other.body.signedURL.split("?")[1]}`;
      assert.equal((await fetch(`${s.api}/storage/v1${swapped}`)).status, 400, "a token made for a different object");
      const short = await sign("library", `${folder}/a.pdf`, 1);
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal((await fetch(`${s.api}/storage/v1${short.body.signedURL}`)).status, 400, "an expired URL");
      for (const [who, token] of [["anon", null], ["alice", as("alice")]] as const) assert.ok((await call("POST", `/object/sign/library/${folder}/a.pdf`, { token, json: { expiresIn: 60 } })).status >= 400, `${who} cannot make a signed URL`);
    });

    test("a family sees its own file paths through its chats (RLS), but even with the exact path no object can be read with a user's token", async () => {
      const path = (await own("select storage_path from public.chat_files where session_id = $1", [seeded.A.session]))[0]!.storage_path as string;
      const asAlice = rows(await get("alice", `/chat_files?select=storage_path&session_id=eq.${seeded.A.session}`));
      assert.equal(asAlice[0]!.storage_path, path, "Alice may see her own file's path");
      assert.ok((await call("GET", `/object/chat-uploads/${path}`, { token: as("alice") })).status >= 400, "but cannot read the object with it");
      assert.deepEqual(rows(await get("bob", `/chat_files?select=storage_path&session_id=eq.${seeded.A.session}`)), [], "and Bob cannot even learn the path");
    });
  });
});
