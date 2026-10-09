import { buildAgreementRecord } from "@/lib/agreement-record";
import { buildConfirmationEmail, buildInternalEmail, type DocumentSummary } from "@/lib/careers-apply-email";
import { applicationsOpen, careersConfig, maxApplicationRequestBytes } from "@/lib/careers-config";
import {
  checkFileBasics,
  extensionOf,
  isSensitiveDocumentType,
  isSupportingDocumentType,
  sanitiseFileName,
  SUPPORTING_DOCUMENT_TYPES,
  totalProblem,
  type FileSlot,
  type SupportingDocumentType,
} from "@/lib/careers-files";
import { inspectFile } from "@/lib/careers-files-server";
import { parseApplication, validateApplication } from "@/lib/careers-validation";
import { openRoles } from "@/lib/careers";
import { createMailer, destinationFor, readEmailConfig, sendEmail, type EmailAttachment } from "@/lib/email";
import { asString } from "@/lib/forms-common";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, newReference, originAllowed, parseMultipart, readBodyLimited } from "@/lib/request-guards";
import { currentAgreement } from "@/lib/safeguarding-agreement";
import { siteConfig } from "@/lib/site";

/**
 * Receives a tutor application: fields and files in one multipart post (POST /api/careers/apply), emails
 * them to the hiring team with the files attached, and confirms to the applicant. There is no database and
 * nothing is written to disk: the files live in memory for the length of the request.
 *
 * Order matters. Cheap refusals come first (is it open, is the origin right, is the visitor within their
 * rate limit, is email configured at all), so nothing is read for a request that cannot succeed. Then the
 * body is read with a hard size limit, then the checks that screen out scripts (the honeypot, the time taken,
 * the human check), then the answers and files are validated again from scratch, because everything the
 * browser checked can be bypassed. Only then is anything sent.
 *
 * The internal email goes first. If it fails the visitor is told, and no confirmation is sent, so nobody
 * is told their application arrived when it did not. If the confirmation then fails, the application still
 * counts as received. Logs carry the reference, the outcome and sizes only: never a name, an address, an
 * answer or file content.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limiter = new SlidingWindowLimiter(careersConfig.rateLimits.apply.perClient, careersConfig.rateLimits.apply.global);

const EMAIL_FALLBACK = `Please email ${siteConfig.email} and we will send you the safeguarding agreement to read and confirm first.`;
const UNREADABLE = "We could not read your application. Please try again.";

interface Envelope {
  fields: unknown;
  honeypot: string;
  elapsedMs: unknown;
  humanCheck: unknown;
  documentTypes: string[];
}

function readEnvelope(raw: unknown): Envelope | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return {
    fields: raw,
    honeypot: asString(r.website),
    elapsedMs: r.elapsedMs,
    humanCheck: r.humanCheck,
    documentTypes: Array.isArray(r.documentTypes) ? r.documentTypes.map((entry) => asString(entry)) : [],
  };
}

/** The least time a person plausibly needs for this long form. Production only, so a developer may be quick. */
function looksAutomated(envelope: Envelope): string | null {
  if (envelope.honeypot.trim() !== "") return "honeypot";
  const elapsed = envelope.elapsedMs;
  const production = process.env.NODE_ENV === "production";
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed)) return production ? "no-timing" : null;
  if (production && elapsed < careersConfig.minFillMs.apply) return "too-fast";
  if (elapsed > 24 * 60 * 60 * 1000) return "bad-timing";
  return null;
}

export async function POST(request: Request) {
  try {
    if (!applicationsOpen()) {
      logOutcome("careers", "closed");
      return jsonResponse(503, { code: "closed", error: `Online applications are not open yet. ${EMAIL_FALLBACK}` });
    }
    if (!originAllowed(request)) {
      logOutcome("careers", "forbidden_origin");
      return jsonResponse(403, { error: "Forbidden." });
    }
    if (!limiter.allow(clientAddress(request.headers))) {
      logOutcome("careers", "rate_limited");
      return jsonResponse(429, { error: `Too many applications from this connection. Please try again later, or email ${siteConfig.email}.` });
    }

    // In production this fails closed: no key or no verified sender is a friendly "email us", never a send
    // from a shared address. Checked before the body is read so a large upload is never accepted for nothing.
    const mail = readEmailConfig();
    if (!mail.ok || !humanCheckAvailable()) {
      logOutcome("careers", "unavailable", { reason: mail.ok ? "no-human-check" : mail.reason });
      return jsonResponse(503, { code: "unavailable", error: `Applications are not being accepted right now. ${EMAIL_FALLBACK}` });
    }

    const body = await readBodyLimited(request, maxApplicationRequestBytes());
    if (!body.ok) {
      logOutcome("careers", "rejected", { reason: body.reason });
      return body.reason === "too-large"
        ? jsonResponse(413, { error: "Your application is too large. Please remove a file or choose smaller ones." })
        : jsonResponse(400, { error: UNREADABLE });
    }
    const form = await parseMultipart(body.bytes, request.headers.get("content-type"));
    if (!form) {
      logOutcome("careers", "rejected", { reason: "not-multipart" });
      return jsonResponse(400, { error: UNREADABLE });
    }

    let envelope: Envelope | null = null;
    try {
      envelope = readEnvelope(JSON.parse(asString(form.get("payload"))));
    } catch {
      envelope = null;
    }
    if (!envelope) {
      logOutcome("careers", "rejected", { reason: "no-payload" });
      return jsonResponse(400, { error: UNREADABLE });
    }

    // Screening. A person never sees the honeypot and cannot fill this form in seconds. These get an honest
    // error rather than a pretend success, because silently dropping a real application would be worse.
    const automated = looksAutomated(envelope);
    if (automated) {
      logOutcome("careers", "rejected", { reason: automated });
      return jsonResponse(400, { error: `We could not accept this submission. ${EMAIL_FALLBACK}` });
    }
    const human = verifyHumanCheck(envelope.humanCheck);
    if (!human.ok) {
      logOutcome("careers", "rejected", { reason: `human-${human.reason}` });
      return jsonResponse(400, {
        code: "human-check",
        error: "We could not confirm that you are a person. Please wait a moment for the check to finish, then send again.",
      });
    }

    // Answers.
    const fields = parseApplication(envelope.fields);
    const errors = validateApplication(fields, {
      agreement: currentAgreement,
      today: new Date().toISOString().slice(0, 10),
      understandingRequired: careersConfig.understandingCheck.applications,
    });
    if (Object.keys(errors).length > 0) {
      logOutcome("careers", "invalid", { fields: Object.keys(errors).length });
      return jsonResponse(422, { error: "Please check your answers and send again.", errors });
    }
    const role = openRoles().find((entry) => entry.slug === fields.role);
    if (!role) return jsonResponse(422, { error: "That role is not open.", errors: { role: "That role is not open. Please choose another." } });

    // Files.
    const upload = await readUploads(form, envelope.documentTypes);
    if (!upload.ok) {
      logOutcome("careers", "invalid", { reason: "files" });
      return jsonResponse(422, { error: upload.message, fileErrors: upload.fileErrors });
    }

    // Send.
    const now = new Date();
    const reference = newReference("LT-APP", now);
    const record = buildAgreementRecord(currentAgreement, {
      typedName: fields.typedName,
      confirmedParts: fields.agreedParts,
      understandingPassed: careersConfig.understandingCheck.applications ? true : null,
      receivedAt: now,
    });
    const documents: DocumentSummary[] = upload.items.map((item) => ({ label: item.label, filename: item.filename, size: item.content.length, sensitive: item.sensitive }));
    const attachments: EmailAttachment[] = upload.items.map((item) => ({ filename: item.filename, content: item.content }));

    const mailer = createMailer(mail.config);
    const internal = buildInternalEmail({ reference, fields, documents, record });
    const sent = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: destinationFor("careers"),
      replyTo: fields.email,
      subject: internal.subject,
      html: internal.html,
      text: internal.text,
      attachments,
    });
    if (!sent.ok) {
      logOutcome("careers", "send_failed", { reference, reason: sent.reason, files: attachments.length });
      return jsonResponse(502, { error: `We could not send your application just now. Nothing has been sent. Please try again shortly, or email ${siteConfig.email}.` });
    }

    const confirmation = buildConfirmationEmail({ reference, firstName: fields.firstName, roleSlug: role.slug, record });
    const confirmed = await sendEmail(mailer, {
      from: mail.config.fromAddress,
      to: fields.email,
      replyTo: destinationFor("careers"),
      subject: confirmation.subject,
      html: confirmation.html,
      text: confirmation.text,
    });
    logOutcome("careers", "sent", {
      reference,
      files: attachments.length,
      bytes: attachments.reduce((sum, item) => sum + item.content.length, 0),
      confirmation: confirmed.ok ? "sent" : "failed",
    });

    return jsonResponse(200, { success: true, reference, role: role.title });
  } catch {
    logOutcome("careers", "error", { reason: "unhandled" });
    return jsonResponse(500, { error: `Something went wrong. Please try again, or email ${siteConfig.email}.` });
  }
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────

interface FileErrors {
  cv?: string;
  coverLetterFile?: string;
  /** One entry per supporting file, in order; null where that file is fine. */
  supporting?: Array<string | null>;
  total?: string;
}

interface Upload {
  label: string;
  filename: string;
  content: Buffer;
  sensitive: boolean;
}

type UploadResult = { ok: true; items: Upload[] } | { ok: false; message: string; fileErrors: FileErrors };

const FILE_PARTS = /^(?:cv|coverLetterFile|support-[0-4])$/;

/** Gathers the files from the form, checks each one by name and size, then by content, and names them safely. */
async function readUploads(form: FormData, documentTypes: string[]): Promise<UploadResult> {
  let cv: File | null = null;
  let coverLetter: File | null = null;
  const supporting: File[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") continue;
    if (!FILE_PARTS.test(name)) return { ok: false, message: "An unexpected file was included.", fileErrors: {} };
    if (name === "cv") cv = value;
    else if (name === "coverLetterFile") coverLetter = value.size > 0 ? value : null;
    else supporting.push(value);
  }
  if (!cv || cv.size === 0) return { ok: false, message: "Please attach your CV.", fileErrors: { cv: "Please attach your CV." } };
  if (documentTypes.length !== supporting.length || !documentTypes.every(isSupportingDocumentType)) {
    return { ok: false, message: "Choose a type for each supporting document.", fileErrors: { supporting: supporting.map(() => "Choose a type for this document.") } };
  }

  const types = documentTypes as SupportingDocumentType[];
  const typeLabel = (type: SupportingDocumentType) => SUPPORTING_DOCUMENT_TYPES.find((entry) => entry.value === type)?.label ?? "Document";
  const slots: Array<{ slot: FileSlot; file: File; label: string; sensitive: boolean; position: number }> = [
    { slot: "cv", file: cv, label: "CV", sensitive: false, position: -1 },
    ...(coverLetter ? [{ slot: "coverLetterFile" as const, file: coverLetter, label: "Cover letter", sensitive: false, position: -1 }] : []),
    ...supporting.map((file, position) => ({ slot: "supporting" as const, file, label: typeLabel(types[position]), sensitive: isSensitiveDocumentType(types[position]), position })),
  ];

  const fileErrors: FileErrors = {};
  const note = (entry: (typeof slots)[number], message: string) => {
    if (entry.slot === "cv") fileErrors.cv = message;
    else if (entry.slot === "coverLetterFile") fileErrors.coverLetterFile = message;
    else {
      fileErrors.supporting ??= supporting.map(() => null);
      fileErrors.supporting[entry.position] = message;
    }
  };

  // By name and size first: no bytes are read for a file that is already refused.
  for (const entry of slots) {
    const problem = checkFileBasics(entry.slot, entry.file.name, entry.file.size);
    if (problem) note(entry, problem.message);
  }
  const total = totalProblem(slots.map((entry) => entry.file.size));
  if (total) fileErrors.total = total.message;
  if (Object.keys(fileErrors).length > 0) return { ok: false, message: total?.message ?? "One of your files could not be accepted.", fileErrors };

  // Then by what each file actually is.
  const items: Upload[] = [];
  const taken = new Set<string>();
  for (const entry of slots) {
    const content = Buffer.from(await entry.file.arrayBuffer());
    const verdict = inspectFile(entry.slot, entry.file.name, content);
    if (!verdict.ok) {
      note(entry, verdict.problem.message);
      continue;
    }
    const clean = sanitiseFileName(entry.file.name);
    let filename = `${entry.label} - ${clean.base}.${extensionOf(entry.file.name)}`;
    for (let n = 2; taken.has(filename.toLowerCase()); n += 1) filename = `${entry.label} - ${clean.base} (${n}).${extensionOf(entry.file.name)}`;
    taken.add(filename.toLowerCase());
    items.push({ label: entry.label, filename, content, sensitive: entry.sensitive });
  }
  if (Object.keys(fileErrors).length > 0) return { ok: false, message: "One of your files could not be accepted.", fileErrors };
  return { ok: true, items };
}
