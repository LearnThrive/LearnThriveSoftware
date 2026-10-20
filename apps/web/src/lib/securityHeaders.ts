/**
 * The response headers every route is served with (plan15 Wave 12 section 16.2). Pure and framework-free
 * so next.config.ts can import it and tests/securityHeaders.test.mjs can load it.
 *
 * CONTENT-SECURITY-POLICY, and why it is not nonce-based. A nonce has to be fresh per request, which
 * forces every page to render per request (installed Next docs, "Content Security Policy"): the public
 * site is static and CDN-cached, and that is worth more here than the extra strictness. So `script-src`
 * allows 'unsafe-inline' (Next's own bootstrap and the pre-paint theme script are inline) and the policy
 * earns its keep elsewhere: nothing may load from any other origin, no `eval`, no plugins, no <base>
 * tag, forms post only to this site, and nothing may frame the site. There are no third-party
 * requests on the public pages (docs/DEPLOYMENT_READINESS.md), so `'self'` is the whole allow-list.
 * Moving to hashes later (the experimental `sri` option) is the route to dropping 'unsafe-inline'.
 *
 * It is sent in PRODUCTION builds only: `next dev` needs eval and its own websocket, and the dev server
 * is not the thing being protected. `CSP_REPORT_ONLY=1` at build downgrades it to report-only for a
 * staging soak before enforcing.
 *
 * The signed-in app and the classroom are dormant in production (lib/portal.ts). Turning them on needs
 * this policy reviewed first: the classroom's own server (NEXT_PUBLIC_CLASSROOM_URL) is allowed below
 * when set, but Excalidraw's remote font and asset loading is not.
 */

export type SecurityHeaderOptions = {
  /** NODE_ENV === "production". */
  production: boolean;
  /** NEXT_PUBLIC_CLASSROOM_URL, if the classroom runs elsewhere. */
  classroomUrl?: string;
  /** CSP_REPORT_ONLY === "1". */
  cspReportOnly?: boolean;
  /** LIBRARY_PHASE === "live": subscriptions are on, so forms may target Stripe's hosted pages (STRIPE_FORM_TARGETS). */
  billing?: boolean;
};

export type HeaderEntry = { key: string; value: string };

/** An absolute http(s) URL's origin, or undefined for anything else (relative, empty, malformed). */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where a form may send a customer (plan19 phase E). Hosted Stripe Checkout and the Customer Portal are reached by a plain
 * form POST to this site that answers with a redirect, and Chromium enforces `form-action` on that redirect (measured: with
 * `form-action 'self'` the browser stays on the page). So, ONLY when subscriptions are on, these two Stripe hosts are
 * allowed as form targets. Nothing else changes: no script, frame, connection or image source is added, and Stripe.js is not used.
 */
export const STRIPE_FORM_TARGETS = ["https://checkout.stripe.com", "https://billing.stripe.com"] as const;

export function buildContentSecurityPolicy({ classroomUrl, billing }: Pick<SecurityHeaderOptions, "classroomUrl" | "billing">): string {
  const classroom = originOf(classroomUrl);
  const classroomSockets = classroom ? [classroom, classroom.replace(/^http/, "ws")] : [];
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...classroomSockets],
    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'self'", ...(classroom ? [classroom] : [])],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...(billing ? STRIPE_FORM_TARGETS : [])],
    "frame-ancestors": ["'self'"],
  };
  return [...Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`), "upgrade-insecure-requests"].join("; ");
}

export function buildSecurityHeaders({ production, classroomUrl, cspReportOnly, billing }: SecurityHeaderOptions): HeaderEntry[] {
  const headers: HeaderEntry[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      // plan13.md task 11.7: camera=()/microphone=() (empty allowlist) denies the feature to
      // every context, including this site's own top-level pages — not just third-party
      // embeds. That would break the in-app classroom fallback
      // ((classroom)/dashboard/lessons/[id]/classroom, rendered whenever
      // NEXT_PUBLIC_CLASSROOM_URL isn't set to a real external deployment), which calls
      // getUserMedia directly (features/classroom/media.ts). (self) keeps the actual
      // protection — no other origin, and no iframe without an explicit allow attribute,
      // gets camera/mic — while letting this site's own pages that need it keep working.
      // geolocation is never used anywhere in this app, so it stays fully denied.
      key: "Permissions-Policy",
      value: "camera=(self), geolocation=(), microphone=(self)",
    },
    // Keeps another site's window from holding a reference to ours (and the other way round).
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];

  if (production) {
    headers.push({
      key: cspReportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: buildContentSecurityPolicy({ classroomUrl, billing }),
    });
    // One year, subdomains included. NOT `preload`: that is a one-way door (the domain is baked into
    // browsers' lists) and waits for the owner's confirmation that it is permanently HTTPS.
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }

  return headers;
}
