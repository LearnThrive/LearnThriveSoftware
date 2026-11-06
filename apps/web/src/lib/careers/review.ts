import type { ApplicationStatus, CareersDeletionReason, DbsSeenHow } from "@learnthrive/data/careers";

/** Words the admin screens and the actions share (launch checklist 3.12.3). Nothing here is personal data. */

export const DELETE_APPLICATION_PHRASE = "DELETE APPLICATION";
export const DELETE_DOCUMENTS_PHRASE = "DELETE DOCUMENTS";

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  INTERVIEW: "Interview",
  ACCEPTED: "Accepted",
  REJECTED: "Unsuccessful",
  WITHDRAWN: "Withdrawn",
};

export const STATUS_TONES: Record<ApplicationStatus, "info" | "warning" | "positive" | "muted"> = {
  NEW: "info",
  REVIEWING: "warning",
  INTERVIEW: "warning",
  ACCEPTED: "positive",
  REJECTED: "muted",
  WITHDRAWN: "muted",
};

export const DELETION_REASONS: Array<{ value: CareersDeletionReason; label: string }> = [
  { value: "RETENTION", label: "Its retention period has ended" },
  { value: "REQUEST", label: "The applicant asked us to delete it" },
  { value: "WITHDRAWN", label: "The applicant withdrew" },
  { value: "OTHER", label: "Another reason" },
];

export const DBS_HOW_LABELS: Record<DbsSeenHow, string> = {
  CERTIFICATE: "Saw the original certificate",
  UPDATE_SERVICE: "Checked the DBS Update Service",
};
