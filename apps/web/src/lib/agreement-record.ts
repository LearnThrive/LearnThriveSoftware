import { createHash } from "node:crypto";
import {
  agreementCanonicalText,
  clauseIdsOf,
  type SafeguardingAgreement,
} from "@/lib/safeguarding-agreement";

/**
 * The evidence that goes into the emails when someone agrees to (or reconfirms) the safeguarding agreement:
 * which version, the name they typed, which parts and clauses they confirmed, whether the understanding
 * check was passed, when the server received it, and a SHA-256 hash of the exact agreement text, so there is
 * proof afterwards of what was shown. Server only (node:crypto). The person's address is never recorded.
 *
 * A typed name is a simple electronic confirmation; how strong it is as a record is a question for the
 * owners' advisers (docs/CAREERS_COMPLETION_REPORT.md, open items).
 */
export function agreementHash(agreement: SafeguardingAgreement): string {
  return createHash("sha256").update(agreementCanonicalText(agreement), "utf8").digest("hex");
}

export interface AgreementRecord {
  version: string;
  dateLabel: string;
  typedName: string;
  confirmedParts: string[];
  confirmedClauseIds: string[];
  /** `null` when the understanding check was not part of this submission. */
  understandingPassed: boolean | null;
  /** Server time, ISO 8601 UTC. */
  receivedAt: string;
  sha256: string;
}

export function buildAgreementRecord(
  agreement: SafeguardingAgreement,
  input: { typedName: string; confirmedParts: readonly string[]; understandingPassed: boolean | null; receivedAt: Date },
): AgreementRecord {
  const confirmedParts = agreement.parts.map((part) => part.id).filter((id) => input.confirmedParts.includes(id));
  return {
    version: agreement.version,
    dateLabel: agreement.dateLabel,
    typedName: input.typedName.replace(/\s+/g, " ").trim(),
    confirmedParts,
    confirmedClauseIds: clauseIdsOf(agreement, confirmedParts),
    understandingPassed: input.understandingPassed,
    receivedAt: input.receivedAt.toISOString(),
    sha256: agreementHash(agreement),
  };
}

/** The record as labelled lines, for the plain-text email and (escaped) the HTML one. */
export function agreementRecordLines(record: AgreementRecord): Array<[label: string, value: string]> {
  return [
    ["Agreement version", `${record.version} (dated ${record.dateLabel})`],
    ["Typed name", record.typedName],
    ["Parts confirmed", record.confirmedParts.join(", ")],
    ["Clauses confirmed", record.confirmedClauseIds.join(", ")],
    [
      "Understanding check",
      record.understandingPassed === null ? "Not part of this submission" : record.understandingPassed ? "Passed" : "Not passed",
    ],
    ["Received (server time, UTC)", record.receivedAt],
    ["Agreement text SHA-256", record.sha256],
  ];
}
