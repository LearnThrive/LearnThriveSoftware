import { agreementV1 } from "@/lib/safeguarding-agreement-v1";

/**
 * The safeguarding agreement: types, the version registry and the helpers every consumer shares.
 *
 * ONE SOURCE. The agreement's words live only in the versioned data files (safeguarding-agreement-v1.ts).
 * The public page, the application form, the reconfirmation form, the confirmation emails and the server
 * checks all read them through this module, so the text a person agrees to, the text the server holds
 * them to and the text hashed into the record cannot drift apart (tests/safeguardingAgreement.test.mjs
 * checks that no other file carries the wording).
 *
 * This module is pure and has no Node-only imports: the browser uses it too. The SHA-256 hash, which
 * needs node:crypto, is in agreement-record.ts (server only).
 */

export interface AgreementClause {
  id: string;
  text: string;
  /** Optional bullet points that belong to the clause. */
  items?: readonly string[];
  /**
   * True only where the clause restates, and goes no further than, a rule the owner has confirmed. Every
   * other clause is a proposal for the owner to approve or remove.
   */
  ownerApproved: boolean;
  /** For the owners and the reviewer: which confirmed decision an approved clause rests on. Not shown publicly. */
  confirmed?: string;
}

export interface AgreementPart {
  id: string;
  heading: string;
  clauses: readonly AgreementClause[];
}

export interface AgreementDefinition {
  term: string;
  meaning: string;
}

export interface UnderstandingQuestion {
  id: string;
  prompt: string;
  /** The clauses the question is taken from. */
  clauseIds: readonly string[];
  options: readonly { id: string; text: string }[];
  correctOptionId: string;
}

export interface SafeguardingAgreement {
  version: string;
  /** ISO date (YYYY-MM-DD) of this wording. */
  date: string;
  dateLabel: string;
  title: string;
  intro: readonly string[];
  definitions: readonly AgreementDefinition[];
  parts: readonly AgreementPart[];
  understanding: readonly UnderstandingQuestion[];
  /**
   * SHA-256 of the canonical text, recorded when the version is published so the tests can refuse any
   * later edit of it. `null` while the version is still a draft.
   */
  publishedHash: string | null;
}

/** Every version ever issued, kept for good: a record of what someone agreed to must stay readable. */
export const agreementVersions: Readonly<Record<string, SafeguardingAgreement>> = {
  [agreementV1.version]: agreementV1,
};

export const CURRENT_AGREEMENT_VERSION = agreementV1.version;
export const currentAgreement: SafeguardingAgreement = agreementVersions[CURRENT_AGREEMENT_VERSION];

export function partIds(agreement: SafeguardingAgreement): string[] {
  return agreement.parts.map((part) => part.id);
}

export function clauseIdsOf(agreement: SafeguardingAgreement, parts: readonly string[] = partIds(agreement)): string[] {
  return agreement.parts.filter((part) => parts.includes(part.id)).flatMap((part) => part.clauses.map((clause) => clause.id));
}

export function unapprovedClauseIds(agreement: SafeguardingAgreement): string[] {
  return agreement.parts.flatMap((part) => part.clauses.filter((clause) => !clause.ownerApproved).map((clause) => clause.id));
}

/**
 * The exact text of an agreement version as one string: what is hashed into the record. Deterministic, and
 * independent of the layout (the understanding questions are not part of the agreement text).
 */
export function agreementCanonicalText(agreement: SafeguardingAgreement): string {
  const lines: string[] = [agreement.title, `Version ${agreement.version}`, `Dated ${agreement.date}`, "", ...agreement.intro, "", "Definitions"];
  for (const definition of agreement.definitions) lines.push(`${definition.term}: ${definition.meaning}`);
  for (const part of agreement.parts) {
    lines.push("", `Part ${part.id}: ${part.heading}`);
    for (const clause of part.clauses) {
      lines.push(`${clause.id}. ${clause.text}`);
      for (const item of clause.items ?? []) lines.push(`- ${item}`);
    }
  }
  return lines.join("\n");
}

/**
 * A name as it is compared: Unicode-normalised, curly apostrophes and typographic hyphens made plain, runs
 * of whitespace collapsed, trimmed, lower-cased. Case and spacing never decide whether a typed name matches.
 */
export function normaliseName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-GB");
}

/** Whether the typed confirmation is the person's full name as they gave it (first name, then last name). */
export function typedNameMatches(typed: string, firstName: string, lastName: string): boolean {
  const expected = normaliseName(`${firstName} ${lastName}`);
  return expected.length > 0 && normaliseName(typed) === expected;
}

/** Whether a typed confirmation is the person's full name as they gave it in a single "full name" field. */
export function fullNameMatches(typed: string, fullName: string): boolean {
  const expected = normaliseName(fullName);
  return expected.length > 0 && normaliseName(typed) === expected;
}

export interface UnderstandingResult {
  ok: boolean;
  /** Ids of the questions that are unanswered or wrong. */
  needsAnotherLook: string[];
}

/** Checks a set of answers (question id -> option id). All must be right. Shared by the browser and the server. */
export function checkUnderstanding(agreement: SafeguardingAgreement, answers: Readonly<Record<string, unknown>> | null | undefined): UnderstandingResult {
  const needsAnotherLook = agreement.understanding
    .filter((question) => {
      const given = answers?.[question.id];
      return typeof given !== "string" || given !== question.correctOptionId || !question.options.some((option) => option.id === given);
    })
    .map((question) => question.id);
  return { ok: needsAnotherLook.length === 0, needsAnotherLook };
}
