import {
  createSqlSafeguarding, developmentSafeguarding, parseLeads, type ConcernReceipt, type SafeguardingLeads, type SafeguardingRepository,
} from "@learnthrive/data/safeguarding";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";
import { createMailer, emailWrapper, htmlHeading, htmlParagraph, readEmailConfig, sendEmail, SITE_URL } from "@/lib/email";

type Env = Record<string, string | undefined>;

/**
 * The safeguarding records (docs/SAFEGUARDING_RECORDS.md): the tutor vetting register and the concern log. The same backend choice as the
 * rest of the tuition data: Postgres with the database, memory in development and tests, and a THROW in production without the database.
 */
const g = globalThis as unknown as { __learnthriveSafeguardingSql?: SafeguardingRepository };

export function getSafeguarding(env: Env = process.env): SafeguardingRepository {
  const backend = accountBackend(env);
  if (backend === "off") throw new Error("The safeguarding records are not available: production needs SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL.");
  if (backend === "memory") return developmentSafeguarding();
  return (g.__learnthriveSafeguardingSql ??= createSqlSafeguarding({
    query: async <T,>(text: string, params?: unknown[]) => {
      const rt = await accountRuntime(env);
      if (!rt?.db) throw new Error("The database connection is not available.");
      return rt.db.query<T>(text, params);
    },
  }));
}

/** Who may read concerns: the linked emails in SAFEGUARDING_LEAD_EMAILS. Set by the owners in the environment, never through the app. */
export function safeguardingLeads(env: Env = process.env): SafeguardingLeads {
  return parseLeads(env.SAFEGUARDING_LEAD_EMAILS);
}

/**
 * A concern is only accepted when at least one lead is named. With nobody to read it, the form is replaced by the published contact
 * route: a concern must never be stored where no one will see it.
 */
export function concernsOpen(env: Env = process.env): boolean {
  return safeguardingLeads(env).emails.length > 0;
}

const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
/** Today's date in London, yyyy-mm-dd: what "expired" and "not in the future" are measured against. */
export const todayInLondon = (now: Date = new Date()): string => londonDate.format(now);

/**
 * Tells each lead that a concern is waiting. The email says ONLY that, with the reference and whether immediate danger was ticked: no
 * name, no detail. The concern is already stored when this runs, so a failed email loses nothing; the result says whether any was sent.
 */
export async function notifyLeads(receipt: ConcernReceipt, immediateDanger: boolean, env: Env = process.env): Promise<{ sent: number; of: number }> {
  const leads = safeguardingLeads(env).emails;
  const config = readEmailConfig(env);
  if (!config.ok || leads.length === 0) return { sent: 0, of: leads.length };
  const mailer = createMailer(config.config);
  const link = `${SITE_URL}/dashboard/admin/concerns/${receipt.id}`;
  const urgent = immediateDanger ? "The person who raised it ticked that someone may be in immediate danger." : "";
  const subject = `${immediateDanger ? "URGENT: " : ""}A safeguarding concern is waiting (${receipt.reference})`;
  const text = [`A safeguarding concern has been raised on LearnThrive. Reference ${receipt.reference}.`, urgent, `Sign in to read it: ${link}`, "This email carries no details on purpose."]
    .filter(Boolean).join("\n\n");
  const html = emailWrapper(
    htmlHeading("A safeguarding concern is waiting") + htmlParagraph(`Reference ${receipt.reference}.`) + (urgent ? htmlParagraph(urgent) : "") +
      htmlParagraph(`Sign in to read it: ${link}`) + htmlParagraph("This email carries no details on purpose."),
    "A safeguarding concern is waiting",
  );
  let sent = 0;
  for (const to of leads) if ((await sendEmail(mailer, { from: config.config.fromAddress, to, subject, html, text })).ok) sent += 1;
  return { sent, of: leads.length };
}
