import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 12: the response headers, as built, in development and in production.

const { buildContentSecurityPolicy, buildSecurityHeaders } = loadTsFrom(import.meta.url, "../src/lib/securityHeaders.ts");

const get = (headers, key) => headers.find((h) => h.key === key)?.value;

test("production adds CSP and HSTS on top of the baseline; development adds neither", () => {
  const dev = buildSecurityHeaders({ production: false });
  const prod = buildSecurityHeaders({ production: true });
  for (const headers of [dev, prod]) {
    assert.equal(get(headers, "X-Content-Type-Options"), "nosniff");
    assert.equal(get(headers, "X-Frame-Options"), "SAMEORIGIN");
    assert.equal(get(headers, "Cross-Origin-Opener-Policy"), "same-origin");
    assert.match(get(headers, "Permissions-Policy"), /camera=\(self\).*microphone=\(self\)/);
  }
  assert.equal(get(dev, "Content-Security-Policy"), undefined);
  assert.equal(get(dev, "Strict-Transport-Security"), undefined);
  assert.ok(get(prod, "Content-Security-Policy"));
  assert.match(get(prod, "Strict-Transport-Security"), /^max-age=31536000; includeSubDomains$/);
});

test("HSTS never carries preload until the owner has confirmed the domain", () => {
  assert.doesNotMatch(get(buildSecurityHeaders({ production: true }), "Strict-Transport-Security") ?? "", /preload/);
});

test("the policy allows nothing from another origin, no eval, no plugins, no base tag", () => {
  const csp = buildContentSecurityPolicy({});
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.doesNotMatch(csp, /https?:\/\//, "no external origin appears when none is configured");
  for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "upgrade-insecure-requests"]) {
    assert.ok(csp.includes(directive), directive);
  }
});

test("form-action allows Stripe's two hosted pages only while subscriptions are on, and nothing else changes", () => {
  const off = buildContentSecurityPolicy({});
  const on = buildContentSecurityPolicy({ billing: true });
  assert.match(on, /form-action 'self' https:\/\/checkout\.stripe\.com https:\/\/billing\.stripe\.com;/);
  assert.doesNotMatch(off, /stripe/);
  // Everything but the form-action directive is identical: no script, frame, connection or image source is added.
  const without = (csp) => csp.split("; ").filter((d) => !d.startsWith("form-action")).join("; ");
  assert.equal(without(on), without(off));
  assert.doesNotMatch(on, /js\.stripe\.com|script-src[^;]*stripe|connect-src[^;]*stripe|frame-src[^;]*stripe/);
  assert.ok(buildSecurityHeaders({ production: true, billing: true }).some((h) => h.key === "Content-Security-Policy" && h.value.includes("checkout.stripe.com")));
  assert.ok(!buildSecurityHeaders({ production: true }).some((h) => h.value.includes("stripe")));
});

test("the classroom origin is allowed for connections and frames only when it is a real http(s) URL", () => {
  const csp = buildContentSecurityPolicy({ classroomUrl: "https://classroom.example.test/some/path" });
  assert.match(csp, /connect-src 'self' https:\/\/classroom\.example\.test wss:\/\/classroom\.example\.test/);
  assert.match(csp, /frame-src 'self' https:\/\/classroom\.example\.test/);
  for (const bad of ["", "/relative", "javascript:alert(1)", "not a url"]) {
    assert.doesNotMatch(buildContentSecurityPolicy({ classroomUrl: bad }), /javascript|relative|not a url/, bad);
  }
});

test("report-only mode swaps the header name and nothing else", () => {
  const enforced = buildSecurityHeaders({ production: true });
  const reportOnly = buildSecurityHeaders({ production: true, cspReportOnly: true });
  assert.equal(get(reportOnly, "Content-Security-Policy"), undefined);
  assert.equal(get(reportOnly, "Content-Security-Policy-Report-Only"), get(enforced, "Content-Security-Policy"));
});
