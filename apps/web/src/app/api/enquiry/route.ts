import { Resend } from "resend";

// No import from "@/lib/site" here (deliberately, not an oversight): tests/enquiry.test.mjs loads
// this one file directly with a plain CommonJS require() via ts.transpileModule, which has no
// tsconfig path-alias resolution and can't load a second .ts file either. The constants below
// duplicate site.ts's values for that reason — the same reason the pre-existing RECIPIENT default
// was already a literal rather than an import.
const SITE_URL = "https://www.learnthrivetuition.co.uk";
const RECIPIENT = process.env.ENQUIRY_EMAIL ?? "info@learnthrivetuition.co.uk";

// Ported from the standalone predecessor project (D:\LearnThrive) — that site's enquiry route
// had an origin check, rate limiting, a branded HTML email, and an auto-reply to the parent that
// never made it into this monorepo's copy, which only ever notified the admin. See below for
// where each behaviour was deliberately adapted rather than copied verbatim.
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? `${SITE_URL},https://learnthrivetuition.co.uk`)
    .split(",")
    .map((o) => o.trim()),
);

// ── In-memory sliding-window rate limiter ────────────────────────
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX = 5; // max submissions per window per IP

const hits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = hits.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return true;
  }

  recent.push(now);
  hits.set(ip, recent);
  return false;
}

// Prune stale entries every 10 minutes to avoid unbounded growth.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, timestamps] of hits) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) hits.delete(ip);
    else hits.set(ip, fresh);
  }
}, 10 * 60 * 1000).unref?.();

type EnquiryBody = {
  parentName: string;
  email: string;
  phone: string;
  yearGroup: string;
  subject: string;
  support: string;
  contactMethod: string;
};

const fieldLimits: Record<keyof EnquiryBody, number> = {
  parentName: 100,
  email: 160,
  phone: 25,
  yearGroup: 50,
  subject: 50,
  support: 1000,
  contactMethod: 10,
};

function validateBody(body: unknown): body is EnquiryBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  const required: (keyof EnquiryBody)[] = [
    "parentName",
    "email",
    "yearGroup",
    "subject",
    "support",
    "contactMethod",
  ];
  for (const key of required) {
    if (typeof b[key] !== "string" || !(b[key] as string).trim()) return false;
    if ((b[key] as string).length > fieldLimits[key]) return false;
  }
  if (typeof b.phone !== "string") return false;
  if (b.phone.length > fieldLimits.phone) return false;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email as string)) return false;
  if ((b.support as string).trim().length < 20) return false;
  return true;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Colours below are hardcoded hex, not this app's CSS custom properties — email clients don't
// reliably support CSS variables, so the branded wrapper inlines the same values the tokens
// resolve to instead of referencing them.
function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(9,29,49,0.08);">
        <tr><td style="background:#ffffff;padding:28px 32px;text-align:center;border-bottom:1px solid #d8e0df;">
          <span style="font-size:18px;font-weight:800;color:#0e2a47;letter-spacing:-0.02em;">Learn<span style="color:#075f52;">Thrive</span> Tuition</span>
        </td></tr>
        <tr><td style="background:#ffffff;padding:36px 32px;">
          ${content}
        </td></tr>
        <tr><td style="background:#091d31;padding:24px 32px;text-align:center;">
          <p style="margin:0;color:#b9cbd5;font-size:13px;line-height:1.5;">
            LearnThrive Tuition &middot; Personalised tutoring that makes a difference
          </p>
          <p style="margin:8px 0 0;color:#7a8f9c;font-size:12px;">
            <a href="${SITE_URL}" style="color:#8ed2ad;text-decoration:none;">learnthrivetuition.co.uk</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

function buildEmailHtml(data: EnquiryBody): string {
  return emailWrapper(`
    <h2 style="margin:0 0 24px;color:#0e2a47;font-size:22px;font-weight:800;">New Enquiry Received</h2>
    <table style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;width:40%;">Parent/Guardian</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.parentName)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;">Email</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.email)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;">Phone</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.phone || "Not provided")}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;">Year Group</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.yearGroup)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;">Subject</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.subject)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;border-bottom:1px solid #d8e0df;">Preferred Contact</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;border-bottom:1px solid #d8e0df;">${escapeHtml(data.contactMethod)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-weight:700;color:#0e2a47;background:#e9f5ef;vertical-align:top;">Support Required</td>
        <td style="padding:12px 16px;color:#435466;background:#ffffff;">${escapeHtml(data.support)}</td>
      </tr>
    </table>
  `);
}

function buildAutoReplyHtml(name: string): string {
  return emailWrapper(`
    <h2 style="margin:0 0 8px;color:#0e2a47;font-size:22px;font-weight:800;">Thank you for your enquiry, ${escapeHtml(name)}!</h2>
    <div style="width:48px;height:4px;background:#075f52;border-radius:2px;margin-bottom:24px;"></div>
    <p style="margin:0 0 16px;color:#435466;font-size:15px;line-height:1.65;">We have received your enquiry and a member of the LearnThrive Tuition team will be in touch shortly.</p>
    <p style="margin:0 0 16px;color:#435466;font-size:15px;line-height:1.65;">We aim to respond to all enquiries within <strong style="color:#0e2a47;">24 hours</strong>.</p>
    <p style="margin:0 0 24px;color:#435466;font-size:15px;line-height:1.65;">In the meantime, if you have any urgent questions, feel free to reply to this email.</p>
    <p style="margin:0;color:#435466;font-size:15px;line-height:1.65;">Kind regards,<br/><strong style="color:#0e2a47;">The LearnThrive Tuition Team</strong></p>
  `);
}

export async function POST(request: Request) {
  try {
    // Reject only when an Origin header is present and doesn't match — some legitimate request
    // paths (direct server-to-server calls, this route's own test suite) never send one at all,
    // and treating an absent header as failure would reject those alongside the real threat this
    // guards against: a hostile page's browser making a cross-origin POST here, which always does
    // send Origin.
    const origin = request.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
    if (isRateLimited(ip)) {
      return Response.json(
        { error: "Too many enquiries. Please try again later." },
        { status: 429 },
      );
    }

    const body: unknown = await request.json();

    if (!validateBody(body)) {
      return Response.json(
        { error: "Invalid form data. Please check your answers and try again." },
        { status: 400 },
      );
    }

    // Read at request time (not module load) so a missing/blank key never crashes the module
    // and the 503 below is reachable without ever constructing a Resend client or calling out.
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      return Response.json(
        { error: `Enquiries are not accepting submissions right now. Please email ${RECIPIENT} directly.` },
        { status: 503 },
      );
    }
    const resend = new Resend(apiKey);
    const fromAddress = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

    const { error } = await resend.emails.send({
      from: `LearnThrive Tuition <${fromAddress}>`,
      to: [RECIPIENT],
      replyTo: body.email,
      subject: `Free consultation enquiry — ${body.subject}`,
      html: buildEmailHtml(body),
    });

    if (error) {
      console.error("Resend error:", error);
      return Response.json(
        { error: "We could not send your enquiry right now. Please try again shortly." },
        { status: 500 },
      );
    }

    // Awaited (unlike the predecessor project's fire-and-forget version) so a serverless/edge
    // runtime can't tear the function down before this send completes, and so a failure here is
    // actually observable — but isolated in its own try/catch so a confirmation-email hiccup
    // never turns an enquiry LearnThrive DID receive into a failure response for the parent.
    try {
      await resend.emails.send({
        from: `LearnThrive Tuition <${fromAddress}>`,
        to: [body.email],
        replyTo: RECIPIENT,
        subject: "We've received your enquiry — LearnThrive Tuition",
        html: buildAutoReplyHtml(body.parentName),
      });
    } catch (err) {
      console.error("Auto-reply failed:", err);
    }

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
