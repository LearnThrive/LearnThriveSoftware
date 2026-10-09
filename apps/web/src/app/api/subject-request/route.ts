import { careersConfig } from "@/lib/careers-config";
import { createMailer, destinationFor, readEmailConfig, sendEmail } from "@/lib/email";
import { asString } from "@/lib/forms-common";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { buildSubjectRequestConfirmation, buildSubjectRequestEmail, parseSubjectRequest, validateSubjectRequest } from "@/lib/subject-request";
import { siteConfig } from "@/lib/site";

/**
 * A family asks for a subject LearnThrive does not yet offer (POST /api/subject-request). Emailed to the
 * owners, who count the requests by hand (docs/SUBJECT_REQUESTS.md); nothing is stored. Anonymous requests are
 * fine. A confirmation goes out only when the person gave an address AND ticked the separate box.
 *
 * Origin check, rate limit, the shared human check, a honeypot and a short minimum time. A script that trips
 * the honeypot or the timing gets the same success answer a person does, and nothing is sent, so it learns
 * nothing from probing: a lost subject request costs nothing, unlike a lost application.
 */
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowLimiter(careersConfig.rateLimits.subjectRequest.perClient, careersConfig.rateLimits.subjectRequest.global);
const MAX_BODY_BYTES = 16 * 1024;
const FALLBACK = `Please email ${siteConfig.email} instead.`;

export async function POST(request: Request) {
  try {
    if (!originAllowed(request)) {
      logOutcome("subject-request", "forbidden_origin");
      return jsonResponse(403, { error: "Forbidden." });
    }
    if (!limiter.allow(clientAddress(request.headers))) {
      logOutcome("subject-request", "rate_limited");
      return jsonResponse(429, { error: "Too many requests from this connection. Please try again later." });
    }
    const mail = readEmailConfig();
    if (!mail.ok || !humanCheckAvailable()) {
      logOutcome("subject-request", "unavailable", { reason: mail.ok ? "no-human-check" : mail.reason });
      return jsonResponse(503, { code: "unavailable", error: `Subject requests are not being accepted right now. ${FALLBACK}` });
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
    if (!body.ok || typeof raw !== "object" || raw === null) {
      logOutcome("subject-request", "rejected", { reason: body.ok ? "not-json" : body.reason });
      return jsonResponse(body.ok ? 400 : 413, { error: "We could not read that. Please try again." });
    }
    const envelope = raw as Record<string, unknown>;

    const production = process.env.NODE_ENV === "production";
    const elapsed = envelope.elapsedMs;
    const tooFast = typeof elapsed === "number" ? production && elapsed < careersConfig.minFillMs.subjectRequest : production;
    if (asString(envelope.website).trim() !== "" || tooFast) {
      logOutcome("subject-request", "dropped", { reason: asString(envelope.website).trim() !== "" ? "honeypot" : "too-fast" });
      return jsonResponse(200, { success: true });
    }
    const human = verifyHumanCheck(envelope.humanCheck);
    if (!human.ok) {
      logOutcome("subject-request", "rejected", { reason: `human-${human.reason}` });
      return jsonResponse(400, { code: "human-check", error: "We could not confirm that you are a person. Please wait a moment for the check to finish, then send again." });
    }

    const fields = parseSubjectRequest(envelope);
    const errors = validateSubjectRequest(fields);
    if (Object.keys(errors).length > 0) {
      logOutcome("subject-request", "invalid", { fields: Object.keys(errors).length });
      return jsonResponse(422, { error: "Please check your answers and send again.", errors });
    }

    const mailer = createMailer(mail.config);
    const internal = buildSubjectRequestEmail(fields);
    const sent = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: destinationFor("subject"),
      ...(fields.notify ? { replyTo: fields.email } : {}),
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
    });
    if (!sent.ok) {
      logOutcome("subject-request", "send_failed", { reason: sent.reason });
      return jsonResponse(502, { error: `We could not send your request just now. Please try again shortly. ${FALLBACK}` });
    }

    let confirmation = "none";
    if (fields.notify) {
      const note = buildSubjectRequestConfirmation(fields);
      const result = await sendEmail(mailer, {
        from: mail.config.fromAddress,
        to: fields.email,
        replyTo: destinationFor("subject"),
        subject: note.subject,
        html: note.html,
        text: note.text,
      });
      confirmation = result.ok ? "sent" : "failed";
    }
    logOutcome("subject-request", "sent", { kind: fields.subject === "Other" ? "other" : "listed", confirmation });
    return jsonResponse(200, { success: true });
  } catch {
    logOutcome("subject-request", "error", { reason: "unhandled" });
    return jsonResponse(500, { error: `Something went wrong. Please try again. ${FALLBACK}` });
  }
}
