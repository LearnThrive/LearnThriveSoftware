import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { SlidingWindowLimiter, clientAddress } = loadTsFrom(import.meta.url, "../src/lib/rate-limit.ts");

const MINUTE = 60_000;

test("a visitor is limited within the window and let back in after it", () => {
  const limiter = new SlidingWindowLimiter({ max: 3, windowMs: 10 * MINUTE }, { max: 100, windowMs: 60 * MINUTE });
  const t0 = 1_000_000;
  assert.equal(limiter.allow("a", t0), true);
  assert.equal(limiter.allow("a", t0 + 1000), true);
  assert.equal(limiter.allow("a", t0 + 2000), true);
  assert.equal(limiter.allow("a", t0 + 3000), false);
  assert.equal(limiter.allow("b", t0 + 3000), true, "another visitor is unaffected");
  assert.equal(limiter.allow("a", t0 + 10 * MINUTE + 1), true, "the window has slid past the first requests");
});

test("a refused request is not counted against the visitor", () => {
  const limiter = new SlidingWindowLimiter({ max: 1, windowMs: 10 * MINUTE }, { max: 100, windowMs: 60 * MINUTE });
  assert.equal(limiter.allow("a", 0), true);
  for (let i = 1; i < 50; i += 1) assert.equal(limiter.allow("a", i), false);
  assert.equal(limiter.allow("a", 10 * MINUTE + 1), true);
});

test("the route-wide limit holds even when every request claims a different address", () => {
  const limiter = new SlidingWindowLimiter({ max: 5, windowMs: 10 * MINUTE }, { max: 10, windowMs: 60 * MINUTE });
  let allowed = 0;
  for (let i = 0; i < 50; i += 1) if (limiter.allow(`forged-${i}`, i)) allowed += 1;
  assert.equal(allowed, 10);
  limiter.reset();
  assert.equal(limiter.allow("x", 0), true);
});

const headers = (entries) => new Headers(entries);

test("the address comes from the entry counted from the right, not the left (the left is the visitor's own claim)", () => {
  // One proxy of ours (default): the last entry is the address that proxy saw connecting.
  assert.equal(clientAddress(headers({ "x-forwarded-for": "203.0.113.7" }), {}), "203.0.113.7");
  // A visitor forging the front of the list changes nothing: the second-from-last is taken.
  assert.equal(clientAddress(headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.9, 10.0.0.1" }), {}), "198.51.100.9");
  assert.equal(clientAddress(headers({ "x-forwarded-for": "9.9.9.9, 198.51.100.9, 10.0.0.1" }), {}), "198.51.100.9");
});

test("TRUSTED_PROXY_HOPS moves the pick; zero takes the last entry", () => {
  const h = headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4" });
  assert.equal(clientAddress(h, { TRUSTED_PROXY_HOPS: "0" }), "4.4.4.4");
  assert.equal(clientAddress(h, { TRUSTED_PROXY_HOPS: "1" }), "3.3.3.3");
  assert.equal(clientAddress(h, { TRUSTED_PROXY_HOPS: "2" }), "2.2.2.2");
  assert.equal(clientAddress(h, { TRUSTED_PROXY_HOPS: "9" }), "1.1.1.1");
  assert.equal(clientAddress(h, { TRUSTED_PROXY_HOPS: "nonsense" }), "3.3.3.3", "a bad setting falls back to the default");
});

test("CLIENT_IP_HEADER names a header that is trusted when it holds a real address", () => {
  const h = headers({ "true-client-ip": "198.51.100.77", "x-forwarded-for": "1.1.1.1, 2.2.2.2" });
  assert.equal(clientAddress(h, { CLIENT_IP_HEADER: "True-Client-IP" }), "198.51.100.77");
  assert.equal(clientAddress(headers({ "true-client-ip": "not an ip" , "x-forwarded-for": "1.1.1.1, 2.2.2.2" }), { CLIENT_IP_HEADER: "true-client-ip" }), "1.1.1.1");
  assert.equal(clientAddress(h, {}), "1.1.1.1", "unset: the X-Forwarded-For rule applies");
});

test("IPv6 addresses are accepted; junk and missing headers become one shared 'unknown' bucket", () => {
  assert.equal(clientAddress(headers({ "x-forwarded-for": "2001:db8::1" }), {}), "2001:db8::1");
  assert.equal(clientAddress(headers({ "x-forwarded-for": "<script>, evil" }), {}), "unknown");
  assert.equal(clientAddress(headers({}), {}), "unknown");
  assert.equal(clientAddress(headers({ "x-forwarded-for": "" }), {}), "unknown");
});
