import { createMailer, destinationFor, readEmailConfig, sendEmail } from "@/lib/email";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { libraryConfig } from "@/lib/library-config";
import { buildWaitlistConfirmation, buildWaitlistEmail, parseWaitlist, validateWaitlist } from "@/lib/library-waitlist";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";

/**
 * A person joins the Library waitlist (POST /api/library-waitlist): an email address and a separate ticked
 * box. One email goes to the owners, who keep it in the mailbox (see lib/library-waitlist.ts); nothing is
 * stored and no cookie is set. Only after that email has gone, a short confirmation goes to the person.
 *
 * Same guards as the subject request: origin check, rate limit, the shared human check, a honeypot and a
 * minimum time. A script that trips the honeypot or the timing gets the same success answer a person does,
 * and nothing is sent. Logs hold counters only, never the address.
 */
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowLimiter(libraryConfig.waitlist.rateLimits.perClient, libraryConfig.waitlist.rateLimits.global);
const MAX_BODY_BYTES = 16 * 1024;
const FALLBACK = `Please email ${siteConfig.email} instead.`;

export async function POST(request: Request) {
  try {
    if (!originAllowed(request)) {
      logOutcome("library-waitlist", "forbidden_origin");
      return jsonResponse(403, { error: "Forbidden." });
    }
    if (!limiter.allow(clientAddress(request.headers))) {
      logOutcome("library-waitlist", "rate_limited");
      return jsonResponse(429, { error: "Too many requests from this connection. Please try again later." });
    }
    const mail = readEmailConfig();
    if (!mail.ok || !humanCheckAvailable()) {
      logOutcome("library-waitlist", "unavailable", { reason: mail.ok ? "no-human-check" : mail.reason });
      return jsonResponse(503, { code: "unavailable", error: `The waitlist is not taking sign-ups right now. ${FALLBACK}` });
    }

    const body = await readBodyLimited(request, MAX_BODY_BYTES);
    let raw: unknown = null;
    if (body.ok) {
      try {
        raw = JSON.parse(new TextDecoder().decode(body.bytes));
      } catch {
        raw = null;
      }
    }
    if (!body.ok || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      logOutcome("library-waitlist", "rejected", { reason: body.ok ? "not-json" : body.reason });
      return jsonResponse(body.ok ? 400 : 413, { error: "We could not read that. Please try again." });
    }
    const envelope = raw as Record<string, unknown>;

    const production = process.env.NODE_ENV === "production";
    const elapsed = envelope.elapsedMs;
    const tooFast = typeof elapsed === "number" ? production && elapsed < libraryConfig.waitlist.minFillMs : production;
    // The honeypot is empty for a person. Anything else in it, of any type, is a script filling every field.
    const trapped = typeof envelope.website === "string" ? envelope.website.trim() !== "" : envelope.website != null;
    if (trapped || tooFast) {
      logOutcome("library-waitlist", "dropped", { reason: trapped ? "honeypot" : "too-fast" });
      return jsonResponse(200, { success: true });
    }
    const human = verifyHumanCheck(envelope.humanCheck);
    if (!human.ok) {
      logOutcome("library-waitlist", "rejected", { reason: `human-${human.reason}` });
      return jsonResponse(400, { code: "human-check", error: "We could not confirm that you are a person. Please wait a moment for the check to finish, then send again." });
    }

    const fields = parseWaitlist(envelope);
    const errors = validateWaitlist(fields);
    if (Object.keys(errors).length > 0) {
      logOutcome("library-waitlist", "invalid", { fields: Object.keys(errors).length });
      return jsonResponse(422, { error: "Please check your answers and send again.", errors });
    }

    const mailer = createMailer(mail.config);
    const internal = buildWaitlistEmail(fields);
    const sent = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: destinationFor("library"),
      replyTo: fields.email,
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
    });
    if (!sent.ok) {
      logOutcome("library-waitlist", "send_failed", { reason: sent.reason });
      return jsonResponse(502, { error: `We could not add you to the waitlist just now. Please try again shortly. ${FALLBACK}` });
    }

    const note = buildWaitlistConfirmation();
    const result = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: fields.email,
      replyTo: destinationFor("library"),
      subject: note.subject,
      html: note.html,
      text: note.text,
    });
    logOutcome("library-waitlist", "sent", { confirmation: result.ok ? "sent" : "failed" });
    return jsonResponse(200, { success: true });
  } catch {
    logOutcome("library-waitlist", "error", { reason: "unhandled" });
    return jsonResponse(500, { error: `Something went wrong. Please try again. ${FALLBACK}` });
  }
}
