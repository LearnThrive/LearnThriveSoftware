import type { ApplicationErrors, ApplicationFields } from "@/lib/careers-validation";

/** What every section of the application receives: the answers, a setter, and the errors to show. */
export interface SectionProps {
  values: ApplicationFields;
  set: <K extends keyof ApplicationFields>(key: K, value: ApplicationFields[K]) => void;
  errors: ApplicationErrors;
}

/** Which fields belong to which numbered section, for the section list and the error summary. */
export const SECTION_TITLES = [
  "About you",
  "The role",
  "Experience and results",
  "Availability and set-up",
  "Your application",
  "Supporting documents",
  "Safeguarding agreement",
  "Check and send",
] as const;

export const SECTION_FIELDS: Record<number, ReadonlyArray<keyof ApplicationFields | "results">> = {
  1: ["firstName", "lastName", "email", "phone", "town", "over18"],
  2: ["role", "subjects", "yearGroups", "examBoards", "otherSubjects"],
  3: ["highestQualification", "qualificationSubject", "results", "gcse", "aLevel", "undergraduate", "postgraduate", "resultsNote", "yearsTutoring", "additionalNeeds", "onlineExperience", "otherRelevant"],
  4: ["times", "hoursPerWeek", "startDate", "privateSpace", "rightToWork", "dbsCertificate", "dbsUpdateService"],
  5: ["coverLetterText", "whyTutor", "stuckLearner"],
  6: [],
  7: ["agreementVersion", "agreedParts", "understanding", "typedName"],
  8: ["declAccurate", "declDbs", "declSelfEmployed", "declPrivacy"],
};

/** The id of the control an error should send the visitor to. */
export function errorTarget(key: string): string {
  if (key === "results") return "field-gcse";
  return `field-${key}`;
}
