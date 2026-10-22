import type { ChatOwner } from "./chat";

/**
 * Paper Tutor jobs, kept in the database (migration 0012) so a restart loses nothing: the job's state, the questions found, one checkpoint per
 * finished question, and who is working on it. A worker holds a LEASE on an active job and renews it with every checkpoint; a job whose lease has
 * run out is picked up by `claimStale` and resumed from its checkpoints. Every write by a worker names its worker id and is refused once the lease
 * is gone (a fenced write), so two processes can never both finish one job. Server only; every owner-facing call names the ChatOwner (family and
 * learner), so another family, a sibling and the guardian never find a learner's paper. The paper itself is a chat file: nothing here holds it.
 *
 *   extracting -> ready -> solving -> done | failed | cancelled        (ready waits for the student to choose; it holds no lease)
 */
export type PaperJobKind = "solve" | "mark";
export type PaperJobState = "extracting" | "ready" | "solving" | "done" | "failed" | "cancelled";

export const PAPER_JOB_DAYS = 7;
export const PAPER_JOB_MAX_ATTEMPTS = 3;

export interface PaperJobRecord {
  id: string;
  clientId: string;
  studentId: string | null;
  sessionId: string;
  fileId: string;
  schemeFileId: string | null;
  kind: PaperJobKind;
  state: PaperJobState;
  /** The output mode chosen for a solve job (opaque here). */
  mode: string | null;
  /** The questions the student chose; null means all of them. */
  selectedIds: string[] | null;
  /** The questions found (opaque JSON to the store). */
  questions: unknown[];
  /** One finished question each, keyed by question id (opaque JSON): what a resumed job does not redo. */
  checkpoints: Record<string, unknown>;
  progress: unknown[];
  resultFileId: string | null;
  pageCount: number | null;
  workedPages: number[];
  message: string | null;
  /** How many times a worker has started (or restarted) this job. */
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface PaperWorker {
  id: string;
  /** How long a lease lasts without renewal. */
  leaseMs: number;
}

export interface PaperJobInput {
  sessionId: string;
  fileId: string;
  schemeFileId: string | null;
  kind: PaperJobKind;
}

/** What a worker may change on a job it holds. */
export interface PaperJobPatch {
  questions?: unknown[];
  progress?: unknown[];
  message?: string | null;
  /** Records one finished question. */
  checkpoint?: { questionId: string; value: unknown };
}

export interface PaperJobFinish {
  state: "ready" | "done" | "failed";
  message?: string | null;
  resultFileId?: string | null;
  pageCount?: number | null;
  workedPages?: number[];
}

export interface PaperJobRepository {
  /** Starts a job in `extracting`, holding the lease. `busy` while the family has another extracting or solving job; `not_found` if the chat is not this owner's. */
  create(owner: ChatOwner, input: PaperJobInput, worker: PaperWorker, now: Date): Promise<{ ok: true; job: PaperJobRecord } | { ok: false; code: "busy" | "not_found" }>;
  /** The owner's own job, or null for anyone else's. */
  get(owner: ChatOwner, id: string): Promise<PaperJobRecord | null>;
  /** The family's extracting or solving job, whichever learner started it (one local model, one job at a time). */
  activeForFamily(clientId: string): Promise<PaperJobRecord | null>;
  /** ready -> solving with the lease. */
  begin(owner: ChatOwner, id: string, input: { mode: string | null; selectedIds: string[] | null }, worker: PaperWorker, now: Date): Promise<{ ok: true; job: PaperJobRecord } | { ok: false; code: "not_found" | "not_ready" | "busy" }>;
  /** A worker's progress. Renews the lease. null when the lease is no longer the worker's, or the job is not active (cancelled meanwhile). */
  save(id: string, workerId: string, patch: PaperJobPatch, worker: PaperWorker, now: Date): Promise<PaperJobRecord | null>;
  /** Ends the worker's run: ready (extraction done, waits for a choice), done or failed. Clears the lease. False if the lease was lost. */
  finish(id: string, workerId: string, outcome: PaperJobFinish, now: Date): Promise<boolean>;
  /** The owner cancels a job that has not finished. False if it is not theirs. */
  cancel(owner: ChatOwner, id: string, now: Date): Promise<boolean>;
  /**
   * Recovery: active jobs whose lease has run out are handed to this worker (attempts + 1) to resume from their checkpoints. A job that has
   * already had `maxAttempts` runs is failed instead, so a paper that crashes the worker is not retried for ever.
   */
  claimStale(worker: PaperWorker, now: Date, maxAttempts?: number): Promise<{ claimed: PaperJobRecord[]; failed: number }>;
  /** Removes jobs past their date that are not active. Returns how many. */
  purgeDue(now: Date): Promise<number>;
}
