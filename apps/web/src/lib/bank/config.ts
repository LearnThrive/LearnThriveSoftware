import { SITE_BANK_DETAILS } from "./siteBankDetails";

/**
 * The company's bank details, for parents who pay by bank transfer (docs/TUITION_BILLING.md, "Paying by bank transfer").
 *
 * The site carries them itself (lib/bank/siteBankDetails.ts). Four SERVER environment variables replace them when set: BANK_PAYEE_NAME,
 * BANK_ACCOUNT_NUMBER, BANK_SORT_CODE, BANK_NAME, all four together (an account change then needs no deploy). With none set the site's own are
 * used; with some set, or any malformed, the server REFUSES TO START: a typo must never quietly fall back to the old account or show a parent
 * a wrong number. This module is imported only by server code (the endpoint, the Fees page, instrumentation.ts) and `npm run check:bundle`
 * proves the values cannot reach a browser. Every message names a variable and what is wrong with it, and NEVER prints a value.
 *
 * The same rules apply to either source:
 *   - the account number is exactly 8 digits and the sort code exactly 6 (the page adds the dashes);
 *   - the payee name and the bank name are not empty.
 */
export const BANK_VARIABLES = ["BANK_PAYEE_NAME", "BANK_ACCOUNT_NUMBER", "BANK_SORT_CODE", "BANK_NAME"] as const;
export type BankVariable = (typeof BANK_VARIABLES)[number];

export interface BankDetails {
  payeeName: string;
  /** Exactly 8 digits. */
  accountNumber: string;
  /** Exactly 6 digits, no separators: show it with `formatSortCode`. */
  sortCode: string;
  bankName: string;
}

export type BankConfig =
  | { status: "ok"; details: BankDetails }
  /** None of the four is set, and no fallback was given. */
  | { status: "unset" }
  /** Something is missing or malformed: one problem per variable, each naming the variable and never its value. */
  | { status: "invalid"; problems: string[] };

type Env = Record<string, string | undefined>;

/** The four variables, each read by name (so the environment registry's scan sees them), trimmed. */
const valuesIn = (env: Env): Record<BankVariable, string> => ({
  BANK_PAYEE_NAME: (env.BANK_PAYEE_NAME ?? "").trim(),
  BANK_ACCOUNT_NUMBER: (env.BANK_ACCOUNT_NUMBER ?? "").trim(),
  BANK_SORT_CODE: (env.BANK_SORT_CODE ?? "").trim(),
  BANK_NAME: (env.BANK_NAME ?? "").trim(),
});

const MAX_NAME = 80;
// No control characters or line breaks: the value is shown on a page and copied into a banking app.
const PLAIN_TEXT = /^[^\u0000-\u001f\u007f]+$/;

function text(values: Record<BankVariable, string>, name: BankVariable, problems: string[]): string {
  const value = values[name];
  if (value === "") problems.push(`${name} is missing or empty.`);
  else if (value.length > MAX_NAME) problems.push(`${name} is too long (at most ${MAX_NAME} characters).`);
  else if (!PLAIN_TEXT.test(value)) problems.push(`${name} must be plain text on one line.`);
  return value;
}

function digits(values: Record<BankVariable, string>, name: BankVariable, length: number, problems: string[]): string {
  const value = values[name];
  if (value === "") problems.push(`${name} is missing or empty.`);
  else if (!new RegExp(`^\\d{${length}}$`).test(value)) problems.push(`${name} must be exactly ${length} digits, with no spaces or dashes.`);
  return value;
}

/**
 * Reads and checks the four variables. Pure: pass any environment. With none set, `fallback` (the site's own details by default; null for
 * none) is used, and checked by the same rules. With some set, or malformed, the answer is "invalid", never the fallback.
 */
export function readBankConfig(env: Env = process.env, fallback: BankDetails | null = SITE_BANK_DETAILS): BankConfig {
  let values = valuesIn(env);
  if (BANK_VARIABLES.every((name) => values[name] === "")) {
    if (fallback === null) return { status: "unset" };
    values = { BANK_PAYEE_NAME: fallback.payeeName, BANK_ACCOUNT_NUMBER: fallback.accountNumber, BANK_SORT_CODE: fallback.sortCode, BANK_NAME: fallback.bankName };
  }
  const problems: string[] = [];
  const payeeName = text(values, "BANK_PAYEE_NAME", problems);
  const accountNumber = digits(values, "BANK_ACCOUNT_NUMBER", 8, problems);
  const sortCode = digits(values, "BANK_SORT_CODE", 6, problems);
  const bankName = text(values, "BANK_NAME", problems);
  if (problems.length > 0) return { status: "invalid", problems };
  return { status: "ok", details: { payeeName, accountNumber, sortCode, bankName } };
}

/** 123456 -> 12-34-56 (how a sort code is written and how a banking app takes it). */
export function formatSortCode(sortCode: string): string {
  return sortCode.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3");
}

export class BankConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`The bank transfer details are not set up correctly. ${problems.join(" ")} Set all four of BANK_PAYEE_NAME, BANK_ACCOUNT_NUMBER, BANK_SORT_CODE and BANK_NAME correctly, or none of them to use the site's own details (docs/ENVIRONMENT.md), then restart.`);
    this.name = "BankConfigError";
  }
}

/**
 * The startup check. Throws a BankConfigError (naming each variable at fault, never a value) when the four are partly set or malformed, or
 * when the site's own details are (a mistake in code). Returns quietly otherwise.
 */
export function assertBankConfig(env: Env = process.env): void {
  const config = readBankConfig(env);
  if (config.status === "invalid") throw new BankConfigError(config.problems);
}
