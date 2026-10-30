import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan19 phase C: the production gate (src/proxy.ts) as a table. decide() is the whole rule set; the
// proxy test at the end checks the wiring (responses, headers, matcher) with real Next request objects.

const { decide } = loadTsFrom(import.meta.url, "../src/lib/portal.ts");
const { libraryEnabled } = loadTsFrom(import.meta.url, "../src/lib/library-config.ts");

const PROD = "production";
const env = (nodeEnv, portal, library) => ({
  NODE_ENV: nodeEnv,
  ...(portal ? { NEXT_PUBLIC_APP_PORTAL_ENABLED: "true" } : {}),
  ...(library === undefined ? {} : { LIBRARY_ENABLED: library }),
});

// What the flag opens in production, and the public pages that are open regardless.
const LIBRARY_OPENED = [
  "/login", "/account", "/account/", "/account/plan", "/account/invoices/inv_1",
  "/library/browse", "/library/item/abc/download",
  "/api/account/session", "/api/account", "/api/library/items", "/api/billing/checkout", "/api/billing/portal",
  "/api/billing/webhook", "/api/assistant/chat",
];
const ALWAYS_PUBLIC = ["/library", "/library/", "/pricing"];
// Closed whatever LIBRARY_ENABLED says (portal closed): pages redirect, APIs are a 404.
const STILL_CLOSED_PAGES = ["/403", "/dashboard", "/dashboard/lessons", "/dashboard/admin/people/students", "/classroom", "/classroom/abc"];
const STILL_CLOSED_API = ["/api/auth/session", "/api/auth/login", "/api/auth/logout", "/api/lessons/x/ics"];
// Neighbours that merely share a prefix with an opened path must not open.
const LOOKALIKES = ["/accounts", "/account-settings", "/library-waitlist", "/libraryx", "/api/accounts", "/api/library-waitlist-x", "/api/billing-x", "/api/assistants", "/login/other", "/login-dev", "/logins"];
const DEV = ["/dev", "/dev/motion", "/dev/classroom", "/api/dev/reset", "/api/dev"];

const flagValues = [undefined, "", "false", "1", "TRUE", "yes", "true "];

test("LIBRARY_ENABLED is on only for exactly `true`", () => {
  assert.equal(libraryEnabled({ LIBRARY_ENABLED: "true" }), true);
  assert.equal(libraryEnabled({ LIBRARY_ENABLED: " true " }), true);
  for (const value of flagValues.filter((v) => v !== "true ")) assert.equal(libraryEnabled({ LIBRARY_ENABLED: value }), false, String(value));
});

test("outside production nothing is gated, whatever the flags say", () => {
  for (const nodeEnv of ["development", "test", undefined]) {
    for (const path of [...LIBRARY_OPENED, ...STILL_CLOSED_PAGES, ...STILL_CLOSED_API, ...DEV, ...LOOKALIKES]) {
      assert.deepEqual(decide(path, env(nodeEnv, false, undefined)), { action: "next" }, `${nodeEnv} ${path}`);
    }
  }
});

test("production, portal closed, LIBRARY_ENABLED not true: library and account paths behave like /login did", () => {
  for (const flag of flagValues.filter((v) => v !== "true ")) {
    for (const path of LIBRARY_OPENED) {
      const expected = path.startsWith("/api/") ? "notFound" : "redirect";
      assert.equal(decide(path, env(PROD, false, flag)).action, expected, `${String(flag)} ${path}`);
      assert.equal(decide(path, env(PROD, false, flag)).noindex, undefined);
    }
  }
});

test("production, portal closed, LIBRARY_ENABLED=true: exactly the listed routes open, with noindex", () => {
  for (const path of LIBRARY_OPENED) assert.deepEqual(decide(path, env(PROD, false, "true")), { action: "next", noindex: true }, path);
  assert.equal(decide("/login", env(PROD, false, " true ")).action, "next", "surrounding spaces are tolerated");
});

test("the public Library and pricing pages are open in every production configuration", () => {
  for (const flag of flagValues) for (const path of ALWAYS_PUBLIC) assert.equal(decide(path, env(PROD, false, flag)).action, "next", `${String(flag)} ${path}`);
});

test("with LIBRARY_ENABLED=true the dashboards, 403, classroom, legacy auth and lessons APIs stay closed", () => {
  for (const flag of ["true", undefined]) {
    for (const path of STILL_CLOSED_PAGES) assert.equal(decide(path, env(PROD, false, flag)).action, "redirect", `${flag} ${path}`);
    for (const path of STILL_CLOSED_API) assert.equal(decide(path, env(PROD, false, flag)).action, "notFound", `${flag} ${path}`);
  }
});

test("paths that only share a prefix with an opened route do not open", () => {
  for (const path of LOOKALIKES) {
    const expected = path.startsWith("/api/") ? "notFound" : "redirect";
    assert.equal(decide(path, env(PROD, false, "true")).action, expected, path);
  }
});

test("development surfaces are a 404 in production, with every flag combination", () => {
  for (const portal of [false, true]) for (const flag of ["true", undefined]) for (const path of DEV) {
    assert.equal(decide(path, env(PROD, portal, flag)).action, "notFound", `${portal} ${flag} ${path}`);
  }
});

test("portal open in production opens everything except the development surfaces", () => {
  for (const path of [...LIBRARY_OPENED, ...STILL_CLOSED_PAGES, ...STILL_CLOSED_API, ...LOOKALIKES]) {
    assert.deepEqual(decide(path, env(PROD, true, undefined)), { action: "next" }, path);
  }
});

test("trailing slashes decide like the path without one", () => {
  assert.equal(decide("/dashboard/", env(PROD, false, "true")).action, "redirect");
  assert.equal(decide("/api/auth/session/", env(PROD, false, "true")).action, "notFound");
  assert.equal(decide("/dev/", env(PROD, true, "true")).action, "notFound");
});

test("a dot-segment path cannot reach a closed route through an open prefix", () => {
  // The proxy sees the URL after WHATWG normalisation, which resolves dot segments (encoded or not).
  for (const raw of ["/account/../dashboard", "/account/%2e%2e/dashboard", "/library/%2E%2E/dashboard"]) {
    const { pathname } = new URL(raw, "https://example.test");
    assert.equal(pathname, "/dashboard", raw);
    assert.equal(decide(pathname, env(PROD, false, "true")).action, "redirect", raw);
  }
});

// ---- the proxy itself, with real Next request objects -----------------------------------------------------

const { NextRequest } = createRequire(import.meta.url)("next/server");
const proxyModule = loadTsFrom(import.meta.url, "../src/proxy.ts");

/** Next's matcher syntax for the shapes proxy.ts uses: a literal, or `/x/:path*` (zero or more) or `/x/:path+` (one or more). */
function matches(pattern, pathname) {
  const regex = pattern.replace(/\/:path\*$/, "(?:/.*)?").replace(/\/:path\+$/, "/.+");
  return new RegExp(`^${regex}$`).test(pathname);
}
const matched = (pathname) => proxyModule.config.matcher.some((pattern) => matches(pattern, pathname));

function run(pathname, vars) {
  const saved = { ...process.env };
  try {
    for (const key of ["NEXT_PUBLIC_APP_PORTAL_ENABLED", "LIBRARY_ENABLED"]) delete process.env[key];
    Object.assign(process.env, vars);
    return proxyModule.proxy(new NextRequest(`https://www.learnthrivetuition.co.uk${pathname}`));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test("the matcher sends every gated path to the proxy, and never the public /library or /pricing pages", () => {
  for (const path of [...LIBRARY_OPENED.filter((p) => p !== "/account/"), ...STILL_CLOSED_PAGES.filter((p) => !p.startsWith("/classroom")), ...STILL_CLOSED_API, ...DEV]) {
    assert.ok(matched(path), `${path} must reach the proxy`);
  }
  for (const path of ["/", "/library", "/pricing", "/library-waitlist", "/api/library-waitlist", "/api/enquiry", "/api/health", "/privacy", "/portal-opening-soon"]) {
    assert.ok(!matched(path), `${path} must not reach the proxy`);
  }
});

// NODE_ENV is inlined by the production build; here it is read from the process, so run the wiring checks as production.
const production = { NODE_ENV: "production" };

test("proxy: closed pages redirect to the notice (noindex), closed APIs are a JSON 404", () => {
  const page = run("/dashboard/lessons", production);
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location")).pathname, "/portal-opening-soon");
  assert.equal(page.headers.get("x-robots-tag"), "noindex");
  const api = run("/api/auth/session", { ...production, LIBRARY_ENABLED: "true" });
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type"), /application\/json/);
});

test("proxy: with the flag the account sign-in and the Stripe webhook pass through, the webhook needing no cookie", () => {
  for (const path of ["/login", "/account", "/api/account/session", "/api/billing/webhook"]) {
    const response = run(path, { ...production, LIBRARY_ENABLED: "true" });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow", path);
    assert.equal(response.headers.get("location"), null, path);
  }
});

test("proxy: without the flag the same paths are closed", () => {
  assert.equal(run("/login", production).status, 307);
  assert.equal(run("/account", production).status, 307);
  for (const path of ["/api/account/session", "/api/billing/webhook", "/api/assistant/chat"]) assert.equal(run(path, production).status, 404, path);
});

test("proxy: /dev stays a 404 with the flag", () => {
  assert.equal(run("/dev/motion", { ...production, LIBRARY_ENABLED: "true" }).status, 404);
  assert.equal(run("/api/dev/reset", { ...production, LIBRARY_ENABLED: "true" }).status, 404);
});

test("proxy: every request it lets through is stamped with the path and query asked for, overwriting anything the client sent", () => {
  // A Server Component cannot read its own URL; the sign-in redirect and the token renewal use this to come back to the page.
  const stamp = (pathname, vars, headers) => {
    const saved = { ...process.env };
    try {
      for (const key of ["NEXT_PUBLIC_APP_PORTAL_ENABLED", "LIBRARY_ENABLED"]) delete process.env[key];
      Object.assign(process.env, vars);
      const response = proxyModule.proxy(new NextRequest(`https://www.learnthrivetuition.co.uk${pathname}`, { headers }));
      return response.headers.get("x-middleware-request-x-learnthrive-path");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  };
  assert.equal(stamp("/dashboard/lessons?week=3", { NODE_ENV: "development" }), "/dashboard/lessons?week=3");
  assert.equal(stamp("/library/ai", { ...production, LIBRARY_ENABLED: "true" }), "/library/ai");
  assert.equal(stamp("/dashboard", { NODE_ENV: "development" }, { "x-learnthrive-path": "//evil.example/x" }), "/dashboard", "a client-supplied copy never survives");
  assert.equal(stamp("/dashboard", production), null, "a gated path that redirects carries nothing");
});
