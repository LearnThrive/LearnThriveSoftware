import { buildAgreementRecord } from "@/lib/agreement-record";
import { agreementOpen, careersConfig } from "@/lib/careers-config";
import { createMailer, destinationFor, readEmailConfig, sendEmail } from "@/lib/email";
import { asString } from "@/lib/forms-common";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { buildReconfirmConfirmation, buildReconfirmInternalEmail, changeDeclared, parseReconfirm, validateReconfirm } from "@/lib/reconfirm";
import { jsonResponse, logOutcome, newReference, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { currentAgreement } from "@/lib/safeguarding-agreement";
import { siteConfig } from "@/lib/site";

/**
 * A tutor reconfirms the safeguarding agreement (POST /api/safeguarding/reconfirm): every year, and whenever
 * a new version is issued. The same rules as an application: closed while the agreement is a draft, origin,
 * rate limit, the human check, honeypot and timing, then the agreement checked again from scratch (the
 * current version, every part, the typed name matching the name given). Emailed to the careers address with
 * a reference, the version, the name typed, the parts and clauses confirmed, the time and the SHA-256 of the
 * text shown; the tutor gets a short confirmation with the same record. The visitor's address is not recorded.
 *
 * There is no login, so this cannot know the person is a tutor. The owners match each submission against
 * their list (docs/AGREEMENT_RECONFIRMATION.md). A "something has changed" declaration is flagged in the
 * subject and in the body.
 */
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowLimiter(careersConfig.rateLimits.reconfirm.perClient, careersConfig.rateLimits.reconfirm.global);
const MAX_BODY_BYTES = 64 * 1024;
const CONTACT = `Please contact the safeguarding lead directly: ${siteConfig.email}.`;

export async function POST(request: Request) {
  try {
    if (!agreementOpen()) {
      logOutcome("reconfirm", "closed");
      return jsonResponse(503, { code: "closed", error: `Online reconfirmation is not open yet. ${CONTACT}` });
    }
    if (!originAllowed(request)) {
      logOutcome("reconfirm", "forbidden_origin");
      return jsonResponse(403, { error: "Forbidden." });
    }
    if (!limiter.allow(clientAddress(request.headers))) {
      logOutcome("reconfirm", "rate_limited");
      return jsonResponse(429, { error: `Too many attempts from this connection. Please try again later. ${CONTACT}` });
    }
    const mail = readEmailConfig();
    if (!mail.ok || !humanCheckAvailable()) {
      logOutcome("reconfirm", "unavailable", { reason: mail.ok ? "no-human-check" : mail.reason });
      return jsonResponse(503, { code: "unavailable", error: `Reconfirmation is not being accepted right now. ${CONTACT}` });
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
      logOutcome("reconfirm", "rejected", { reason: body.ok ? "not-json" : body.reason });
      return jsonResponse(body.ok ? 400 : 413, { error: "We could not read that. Please try again." });
    }
    const envelope = raw as Record<string, unknown>;

    // A person never sees the honeypot and cannot read seven parts and answer in seconds. Honest errors:
    // a safeguarding record must never be silently dropped.
    const production = process.env.NODE_ENV === "production";
    const elapsed = envelope.elapsedMs;
    const tooFast = typeof elapsed === "number" ? production && elapsed < careersConfig.minFillMs.reconfirm : production;
    if (asString(envelope.website).trim() !== "" || tooFast) {
      logOutcome("reconfirm", "rejected", { reason: asString(envelope.website).trim() !== "" ? "honeypot" : "too-fast" });
      return jsonResponse(400, { error: `We could not accept this submission. ${CONTACT}` });
    }
    const human = verifyHumanCheck(envelope.humanCheck);
    if (!human.ok) {
      logOutcome("reconfirm", "rejected", { reason: `human-${human.reason}` });
      return jsonResponse(400, { code: "human-check", error: "We could not confirm that you are a person. Please wait a moment for the check to finish, then send again." });
    }

    const fields = parseReconfirm(envelope);
    const errors = validateReconfirm(fields, { agreement: currentAgreement, understandingRequired: careersConfig.understandingCheck.reconfirmation });
    if (Object.keys(errors).length > 0) {
      logOutcome("reconfirm", "invalid", { fields: Object.keys(errors).length });
      return jsonResponse(422, { error: "Please check your answers and send again.", errors });
    }

    const now = new Date();
    const reference = newReference("LT-RECONF", now);
    const record = buildAgreementRecord(currentAgreement, {
      typedName: fields.typedName,
      confirmedParts: fields.agreedParts,
      understandingPassed: careersConfig.understandingCheck.reconfirmation ? true : null,
      receivedAt: now,
    });

    const mailer = createMailer(mail.config);
    const internal = buildReconfirmInternalEmail(fields, record, reference);
    const sent = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: destinationFor("careers"),
      replyTo: fields.email,
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
    });
    if (!sent.ok) {
      logOutcome("reconfirm", "send_failed", { reference, reason: sent.reason });
      return jsonResponse(502, { error: `We could not record your reconfirmation just now. Nothing has been sent. Please try again shortly. ${CONTACT}` });
    }

    const confirmation = buildReconfirmConfirmation(fields, record, reference);
    const confirmed = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: fields.email,
      replyTo: destinationFor("careers"),
      subject: confirmation.subject,
      html: confirmation.html,
      text: confirmation.text,
    });
    const declared = changeDeclared(fields);
    logOutcome("reconfirm", "sent", { reference, changeDeclared: declared, confirmation: confirmed.ok ? "sent" : "failed" });
    return jsonResponse(200, { success: true, reference, changeDeclared: declared });
  } catch {
    logOutcome("reconfirm", "error", { reason: "unhandled" });
    return jsonResponse(500, { error: `Something went wrong. Please try again. ${CONTACT}` });
  }
}
