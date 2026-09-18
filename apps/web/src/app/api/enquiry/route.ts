import { Resend } from "resend";

const RECIPIENT = process.env.ENQUIRY_EMAIL ?? "info@learnthrivetuition.co.uk";

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

function buildEmailHtml(data: EnquiryBody): string {
  return `
    <h2>New Enquiry from LearnThrive Tuition Website</h2>
    <table style="border-collapse:collapse;width:100%;max-width:600px;">
      <tr><td style="padding:8px;font-weight:bold;">Parent/Guardian</td><td style="padding:8px;">${escapeHtml(data.parentName)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Email</td><td style="padding:8px;">${escapeHtml(data.email)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Phone</td><td style="padding:8px;">${escapeHtml(data.phone || "Not provided")}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Year Group</td><td style="padding:8px;">${escapeHtml(data.yearGroup)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Subject</td><td style="padding:8px;">${escapeHtml(data.subject)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;">Preferred Contact</td><td style="padding:8px;">${escapeHtml(data.contactMethod)}</td></tr>
      <tr><td style="padding:8px;font-weight:bold;vertical-align:top;">Support Required</td><td style="padding:8px;">${escapeHtml(data.support)}</td></tr>
    </table>
  `.trim();
}

export async function POST(request: Request) {
  try {
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

    const { error } = await resend.emails.send({
      from: `LearnThrive Tuition <${process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev"}>`,
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

    return Response.json({ success: true });
  } catch {
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
