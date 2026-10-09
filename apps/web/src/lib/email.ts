import { Resend } from "resend";
import { siteConfig } from "@/lib/site";

/**
 * The shared email helper for the careers application, the safeguarding reconfirmation and the subject
 * request. Server only.
 *
 * THE CLIENT IS CREATED AT REQUEST TIME, never when the file loads: the key is read inside the handler, so
 * a missing key can never break the build or crash the module (the failure the standalone site's enquiry
 * route had), and a route can answer "not accepting submissions" without constructing anything. In
 * production it FAILS CLOSED: no API key, or no verified sender, is a friendly "email us" message, never a
 * send from the shared onboarding@resend.dev address. (The enquiry route keeps its own copy of this logic
 * on purpose: its tests load that one file on its own, with no imports.)
 *
 * The branded wrapper is light-only with every surface carrying its own background, plain-text alternatives
 * are always sent, and nothing in a message is image-only. All free text must go through escapeHtml.
 */
export const SITE_URL = siteConfig.url;

type Env = Record<string, string | undefined>;

export interface EmailConfig {
  apiKey: string;
  /** The bare sender address, from RESEND_FROM_EMAIL. */
  fromAddress: string;
}

export type EmailConfigResult = { ok: true; config: EmailConfig } | { ok: false; reason: "no-api-key" | "incomplete-production-config" };

export function readEmailConfig(env: Env = process.env): EmailConfigResult {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "no-api-key" };
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (env.NODE_ENV === "production" && !from) return { ok: false, reason: "incomplete-production-config" };
  return { ok: true, config: { apiKey, fromAddress: from || "onboarding@resend.dev" } };
}

export function createMailer(config: EmailConfig): Resend {
  return new Resend(config.apiKey);
}

/**
 * Where a kind of message goes. Careers applications and reconfirmations: CAREERS_EMAIL, then ENQUIRY_EMAIL,
 * then the site's own address. Subject requests: SUBJECT_REQUEST_EMAIL, then ENQUIRY_EMAIL, then the site's.
 */
export function destinationFor(kind: "careers" | "subject", env: Env = process.env): string {
  const pick = (value: string | undefined) => value?.trim() || undefined;
  const specific = kind === "careers" ? pick(env.CAREERS_EMAIL) : pick(env.SUBJECT_REQUEST_EMAIL);
  return specific ?? pick(env.ENQUIRY_EMAIL) ?? siteConfig.email;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A value that is safe in a subject line: no line breaks or control characters, collapsed spaces, capped. */
export function subjectSafe(text: string, max = 160): string {
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Colours are hard-coded hex: email clients do not reliably support CSS variables. */
const INK = "#0e2a47";
const BODY = "#435466";
const LINE = "#d8e0df";
const TINT = "#e9f5ef";

export function emailWrapper(content: string, preheader = ""): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/><title>LearnThrive Tuition</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ec;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f1ec" style="background:#f4f1ec;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(9,29,49,0.08);">
        <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:28px 32px;text-align:center;border-bottom:1px solid ${LINE};">
          <span style="font-size:18px;font-weight:800;color:${INK};letter-spacing:-0.02em;">Learn<span style="color:#075f52;">Thrive</span> Tuition</span>
        </td></tr>
        <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:36px 32px;">
          ${content}
        </td></tr>
        <tr><td bgcolor="#091d31" style="background:#091d31;padding:24px 32px;text-align:center;">
          <p style="margin:0;color:#b9cbd5;font-size:13px;line-height:1.5;">LearnThrive Tuition &middot; Personalised tutoring that makes a difference</p>
          <p style="margin:8px 0 0;color:#7a8f9c;font-size:12px;"><a href="${SITE_URL}" style="color:#8ed2ad;text-decoration:none;">learnthrivetuition.co.uk</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

export function htmlHeading(text: string): string {
  return `<h2 style="margin:0 0 20px;color:${INK};font-size:22px;font-weight:800;">${escapeHtml(text)}</h2>`;
}

export function htmlSubheading(text: string): string {
  return `<h3 style="margin:28px 0 10px;color:${INK};font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(text)}</h3>`;
}

export function htmlParagraph(text: string): string {
  return `<p style="margin:0 0 14px;color:${BODY};font-size:15px;line-height:1.65;">${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;
}

/** A banner that must not be missed (the untrusted-attachments warning, a declared change). */
export function htmlBanner(text: string, tone: "warning" | "critical" = "warning"): string {
  const [bg, border, fg] = tone === "critical" ? ["#fdecec", "#e7c4c7", "#8a1c1c"] : ["#fdf7ea", "#f0dcb4", "#7a5a1d"];
  return `<div style="margin:0 0 20px;padding:14px 16px;background:${bg};border:1px solid ${border};border-radius:8px;color:${fg};font-size:14px;line-height:1.55;">${escapeHtml(text)}</div>`;
}

/** Label / value rows. Every value is escaped; blank values show a dash so a row never disappears. */
export function htmlTable(rows: ReadonlyArray<readonly [label: string, value: string]>): string {
  const cells = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 14px;font-weight:700;color:${INK};background:${TINT};border-bottom:1px solid ${LINE};width:36%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 14px;color:${BODY};background:#ffffff;border-bottom:1px solid ${LINE};vertical-align:top;">${escapeHtml(value.trim() === "" ? "—" : value).replace(/\n/g, "<br/>")}</td>
      </tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;width:100%;">${cells}</table>`;
}

export function textTable(rows: ReadonlyArray<readonly [label: string, value: string]>): string {
  return rows.map(([label, value]) => `${label}: ${value.trim() === "" ? "-" : value}`).join("\n");
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/**
 * Sends one message through Resend. Never throws: a failed or crashed send is `{ ok: false }` with a short
 * reason that carries no personal data. Single sends only: Resend's batch endpoint takes no attachments.
 */
export async function sendEmail(mailer: Resend, message: OutgoingEmail): Promise<SendResult> {
  try {
    const { error } = await mailer.emails.send({
      from: `LearnThrive Tuition <${message.from}>`,
      to: [message.to],
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    });
    if (error) return { ok: false, reason: error.name || "provider-error" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "send-threw" };
  }
}
