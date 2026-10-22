import { randomUUID } from "node:crypto";
import type { ChatOwner, LibraryStore, PaperJobRecord, PaperWorker } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import type { OutputMode, SolvedQuestion } from "./annotate";
import { markingMarkdown, type MarkedQuestion } from "./mark";
import { extractQuestions, markCompleted, photoToPdf, readMarkScheme, solutionsMarkdown, solvePaper, type PaperDocument, type Progress } from "./paper";
import type { SolveDeps } from "./solve";

/**
 * Paper Tutor jobs: a paper takes minutes, so it runs in the background while the student carries on, and the page asks how it is
 * going. The job lives in the database (store.papers, migration 0012), not in this process: its state, the questions found and ONE
 * CHECKPOINT PER FINISHED QUESTION are saved as they happen, so a restart loses nothing. This process works a job under a LEASE that a
 * heartbeat renews; if the process dies the lease runs out, the next process to ask for jobs (`recover`) takes the job over, re-reads the
 * paper from the stored upload and carries on with the questions that have no checkpoint. Every write is fenced by the lease, so a
 * process that has lost it (taken over, or the student cancelled) stops writing and stops working. One active job per family (a
 * database index), a daily cap, cancellable, and every model call goes through the same generation queue as the chat.
 *
 *   extracting -> ready (the questions found, to choose from) -> solving -> done | failed | cancelled
 *
 * A job is one of two kinds. "solve" writes worked solutions onto a paper. "mark" checks a student's own completed paper (opt-in:
 * PAPER_MARKER_ENABLED), optionally with a mark scheme uploaded to the same chat; its steps are the same, "solving" meaning marking.
 *
 * Limits of this design, said plainly: a question that was being solved when the process died is solved again from the start (only
 * finished questions are kept); the paper is re-read on recovery, and a scan's question list comes from the vision model again; the
 * summary message is posted after the PDF is stored, so a crash between the two can post it twice.
 */
export type JobKind = "solve" | "mark";
export type JobState = "extracting" | "ready" | "solving" | "done" | "failed" | "cancelled";

export interface JobQuestion {
  id: string;
  number: string;
  page: number;
  text: string;
  marks: number | null;
  /** Read from the page's text, or from a picture of it by the AI (the student can tell which to double-check). */
  fromText: boolean;
}

/** What the panel shows for one finished question: the solution, or the marking of the student's answer. */
export interface QuestionResult {
  id: string;
  number: string;
  /** How far the answer is checked (solved), and for marking the verdict. */
  status: string;
  outcome?: string;
  answer: string;
  steps: { say?: string; math?: string }[];
  note: string;
  studentAnswer?: string;
  feedback?: string;
  estimate?: number | null;
  outOf?: number | null;
}

export interface PaperJobView {
  id: string;
  kind: JobKind;
  state: JobState;
  results: QuestionResult[];
  questions: JobQuestion[];
  progress: Progress[];
  mode: OutputMode | null;
  resultFileId: string | null;
  pageCount: number | null;
  workedPages: number[];
  message: string | null;
}

const markedResult = (q: MarkedQuestion): QuestionResult => ({
  id: q.id,
  number: q.number,
  status: q.reference.status,
  outcome: q.outcome,
  answer: q.reference.finalAnswer,
  steps: q.reference.steps,
  note: q.reason,
  studentAnswer: q.student.answer,
  feedback: q.feedback,
  estimate: q.estimate,
  outOf: q.outOf,
});

const solvedResult = (q: SolvedQuestion): QuestionResult => ({ id: q.id, number: q.number, status: q.status, answer: q.finalAnswer, steps: q.steps, note: q.statusNote || q.explanation });

export const JOBS_PER_DAY = 10;
export const USAGE_PAPER_DAY = "paper_job_day";
/** A lease lasts this long without renewal; the heartbeat renews it three times as often. */
export const LEASE_MS = 90_000;

export interface JobDeps {
  store: LibraryStore;
  uploads: LibraryStorage;
  solve: Omit<SolveDeps, "signal">;
  now?: () => Date;
  log?: (outcome: string, details?: Record<string, string | number | boolean>) => void;
}

/** What the page sees of a job: results appear once it is done (the panel shows them together with the PDF). */
export function viewOf(job: PaperJobRecord): PaperJobView {
  const questions = job.questions as JobQuestion[];
  const results: QuestionResult[] = [];
  if (job.state === "done") {
    for (const q of questions) {
      const saved = job.checkpoints[q.id];
      if (saved) results.push(job.kind === "mark" ? markedResult(saved as MarkedQuestion) : solvedResult(saved as SolvedQuestion));
    }
  }
  return { id: job.id, kind: job.kind, state: job.state, results, questions, progress: job.progress as Progress[], mode: job.mode as OutputMode | null, resultFileId: job.resultFileId, pageCount: job.pageCount, workedPages: job.workedPages, message: job.message };
}

const asChecked = <T extends { id: string }>(checkpoints: Record<string, unknown>): Map<string, T> => {
  const out = new Map<string, T>();
  for (const [id, value] of Object.entries(checkpoints)) if (value && typeof value === "object" && (value as { id?: unknown }).id === id) out.set(id, value as T);
  return out;
};

const owner = (job: PaperJobRecord): ChatOwner => ({ clientId: job.clientId, studentId: job.studentId });

export class PaperJobs {
  readonly workerId = `w-${randomUUID().slice(0, 12)}`;
  /** Jobs this process is working on, so it can stop them and does not take them over from itself. */
  private readonly running = new Map<string, AbortController>();
  /** The paper as read, while this process has it (the bytes and the questions found). Rebuilt from the upload when another process takes over. */
  private readonly documents = new Map<string, PaperDocument>();
  private readonly schemes = new Map<string, Map<string, string> | null>();
  private lastRecovery = 0;

  constructor(private readonly leaseMs = LEASE_MS) {}

  private get worker(): PaperWorker {
    return { id: this.workerId, leaseMs: this.leaseMs };
  }

  async get(deps: Pick<JobDeps, "store">, who: ChatOwner, id: string): Promise<PaperJobView | null> {
    const job = await deps.store.papers.get(who, id);
    return job ? viewOf(job) : null;
  }

  /** Starts reading a paper the family uploaded to this chat. */
  async start(deps: JobDeps, input: { owner: ChatOwner; sessionId: string; fileId: string; kind?: JobKind; schemeFileId?: string }): Promise<{ ok: true; job: PaperJobView } | { ok: false; code: "busy" | "limit" | "not_found" }> {
    const file = await deps.store.chat.getFile(input.owner, input.fileId);
    if (!file || file.sessionId !== input.sessionId) return { ok: false, code: "not_found" };
    const scheme = input.schemeFileId && input.kind === "mark" ? await deps.store.chat.getFile(input.owner, input.schemeFileId) : null;
    if (input.schemeFileId && (!scheme || scheme.sessionId !== input.sessionId)) return { ok: false, code: "not_found" };
    const now = (deps.now ?? (() => new Date()))();
    const day = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
    if ((await deps.store.chat.usageCount(input.owner.clientId, USAGE_PAPER_DAY, day)) >= JOBS_PER_DAY) return { ok: false, code: "limit" };
    // The database decides "one at a time": the insert is refused while the family has another extracting or solving job.
    const created = await deps.store.papers.create(input.owner, { sessionId: input.sessionId, fileId: file.id, schemeFileId: scheme?.id ?? null, kind: input.kind ?? "solve" }, this.worker, now);
    if (!created.ok) return created;
    await deps.store.chat.incrementUsage(input.owner.clientId, USAGE_PAPER_DAY, day, 1);
    void this.extract(deps, created.job);
    return { ok: true, job: viewOf(created.job) };
  }

  /** Runs `work` for a job this process holds, renewing the lease while it runs and aborting it if the lease is lost or the job cancelled. */
  private async hold(deps: JobDeps, job: PaperJobRecord, work: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const heartbeat = setInterval(() => {
      void deps.store.papers.save(job.id, this.workerId, {}, this.worker, (deps.now ?? (() => new Date()))()).then(
        (saved) => saved || controller.abort(),
        () => undefined,
      );
    }, Math.max(1000, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    try {
      await work(controller.signal);
    } finally {
      clearInterval(heartbeat);
      this.running.delete(job.id);
    }
  }

  private now(deps: JobDeps): Date {
    return (deps.now ?? (() => new Date()))();
  }

  private async fail(deps: JobDeps, job: PaperJobRecord, message: string, stage: string): Promise<void> {
    await deps.store.papers.finish(job.id, this.workerId, { state: "failed", message }, this.now(deps)).catch(() => false);
    deps.log?.("paper_failed", { stage });
  }

  private async paperBytes(deps: JobDeps, job: PaperJobRecord): Promise<Uint8Array> {
    const file = await deps.store.chat.getFile(owner(job), job.fileId);
    const stored = file ? await deps.uploads.read(file.storagePath) : null;
    if (!file || !stored) throw Object.assign(new Error("gone"), { userMessage: "That file is no longer stored. Please upload it again." });
    return file.contentType === "application/pdf" ? stored : photoToPdf(stored, file.contentType);
  }

  private async markScheme(deps: JobDeps, job: PaperJobRecord): Promise<Map<string, string> | null> {
    if (!job.schemeFileId) return null;
    if (this.schemes.has(job.id)) return this.schemes.get(job.id) ?? null;
    const file = await deps.store.chat.getFile(owner(job), job.schemeFileId);
    const bytes = file && file.contentType === "application/pdf" ? await deps.uploads.read(file.storagePath) : null;
    const scheme = bytes ? await readMarkScheme(bytes) : null;
    this.schemes.set(job.id, scheme);
    return scheme;
  }

  /** The paper for a job: as this process already has it, or read again from the stored upload. */
  private async document(deps: JobDeps, job: PaperJobRecord, signal: AbortSignal): Promise<PaperDocument | { problem: string }> {
    const cached = this.documents.get(job.id);
    if (cached) return cached;
    const document = await extractQuestions({ ...deps.solve, signal }, await this.paperBytes(deps, job));
    if (!("problem" in document)) this.documents.set(job.id, document);
    return document;
  }

  /** extracting -> ready. Also how a job interrupted while extracting is resumed. */
  private async extract(deps: JobDeps, job: PaperJobRecord): Promise<void> {
    await this.hold(deps, job, async (signal) => {
      try {
        const document = await this.document(deps, job, signal);
        if (signal.aborted) return;
        if ("problem" in document) throw Object.assign(new Error("unreadable"), { userMessage: document.problem });
        const scheme = job.kind === "mark" ? await this.markScheme(deps, job) : null;
        const questions: JobQuestion[] = document.questions.map((q) => ({ id: q.id, number: q.number, page: q.page, text: q.text.slice(0, 400), marks: q.marks, fromText: q.fromText }));
        const notices = [
          document.omitted ? `This paper has ${document.questions.length + document.omitted.questions} questions. Only the first ${document.omitted.limit} are listed (the limit is set by PAPER_MAX_PAGES / PAPER_MAX_QUESTIONS); question ${document.omitted.firstOmitted} onwards are NOT included, so this will not be a complete paper. Send the rest as a second document to cover them.` : null,
          job.schemeFileId && !scheme ? "I could not read that mark scheme (it needs to be a PDF with its text in it), so I will mark without it." : null,
        ].filter(Boolean);
        const message = questions.length ? (notices.length ? notices.join(" ") : null) : "I could not find any numbered questions in that document. You can still ask me about it in the chat.";
        const now = this.now(deps);
        if (!(await deps.store.papers.save(job.id, this.workerId, { questions, message }, this.worker, now))) return;
        if (await deps.store.papers.finish(job.id, this.workerId, { state: "ready" }, now)) deps.log?.("paper_extracted", { questions: questions.length });
      } catch (error) {
        if (signal.aborted) return;
        await this.fail(deps, job, (error as { userMessage?: string }).userMessage ?? "Something went wrong reading that paper. Please try again.", "extract");
      }
    });
  }

  /** Solves (or, for a "mark" job, marks) the chosen questions of a ready job, then stores the PDF and posts a summary into the chat. */
  async solve(deps: JobDeps, who: ChatOwner, id: string, options: { mode: OutputMode; questionIds?: string[] }): Promise<{ ok: true; job: PaperJobView } | { ok: false; code: "not_found" | "not_ready" | "busy" }> {
    const current = await deps.store.papers.get(who, id);
    if (!current) return { ok: false, code: "not_found" };
    const known = new Set((current.questions as JobQuestion[]).map((q) => q.id));
    if (current.state !== "ready" || known.size === 0) return { ok: false, code: "not_ready" };
    const ids = options.questionIds?.filter((q) => known.has(q));
    const begun = await deps.store.papers.begin(who, id, { mode: current.kind === "solve" ? options.mode : null, selectedIds: ids?.length ? ids : null }, this.worker, this.now(deps));
    if (!begun.ok) return begun;
    void this.work(deps, begun.job);
    return { ok: true, job: viewOf(begun.job) };
  }

  /** The solving (or marking) run of a job this process holds: starts fresh or resumes from the checkpoints. */
  private async work(deps: JobDeps, job: PaperJobRecord): Promise<void> {
    await this.hold(deps, job, async (signal) => {
      const kind = job.kind;
      try {
        const document = await this.document(deps, job, signal);
        if (signal.aborted) return;
        if ("problem" in document) throw Object.assign(new Error("unreadable"), { userMessage: document.problem });
        const solveDeps = { ...deps.solve, signal };
        const ids = job.selectedIds ?? undefined;
        // Progress is written in order, one at a time, so an older report never overwrites a newer one.
        let writes: Promise<unknown> = Promise.resolve();
        const onProgress = (progress: Progress[]) => {
          writes = writes.then(() => deps.store.papers.save(job.id, this.workerId, { progress }, this.worker, this.now(deps))).catch(() => undefined);
        };
        const checkpoint = async (result: SolvedQuestion | MarkedQuestion) => {
          // A refused checkpoint means the lease is gone (taken over, or cancelled): stop working.
          const saved = await deps.store.papers.save(job.id, this.workerId, { checkpoint: { questionId: result.id, value: result } }, this.worker, this.now(deps));
          if (!saved) throw Object.assign(new Error("lease lost"), { code: "aborted" });
        };
        let pdf: Uint8Array;
        let markdown: string;
        let pageCount: number;
        let workedPages: number[];
        if (kind === "mark") {
          const scheme = await this.markScheme(deps, job);
          const result = await markCompleted(solveDeps, document, { questionIds: ids, scheme, onProgress, prior: asChecked<MarkedQuestion>(job.checkpoints), onResult: checkpoint });
          if (signal.aborted) return;
          pdf = result.pdf;
          markdown = markingMarkdown(result.marked, Boolean(scheme));
          pageCount = result.pageCount;
          workedPages = result.feedbackPages;
          deps.log?.("paper_marked", { questions: result.marked.length, correct: result.marked.filter((q) => q.outcome === "correct").length, needsChecking: result.marked.filter((q) => q.outcome === "needs_checking").length, scheme: Boolean(scheme) });
        } else {
          const result = await solvePaper(solveDeps, document, { mode: (job.mode as OutputMode | null) ?? "hybrid", questionIds: ids, onProgress, prior: asChecked<SolvedQuestion>(job.checkpoints), onResult: checkpoint });
          if (signal.aborted) return;
          pdf = result.pdf;
          markdown = solutionsMarkdown(result.solved);
          pageCount = result.pageCount;
          workedPages = result.workedPages;
          deps.log?.("paper_solved", { questions: result.solved.length, verified: result.solved.filter((q) => q.status === "verified").length, unsolved: result.solved.filter((q) => q.status === "unsolved" || q.status === "failed").length });
        }
        const now = this.now(deps);
        const who = owner(job);
        const path = `${job.sessionId}/${randomUUID()}.pdf`;
        await deps.uploads.put(path, pdf, "application/pdf");
        const record = await deps.store.chat.addFile(who, job.sessionId, { storagePath: path, bytes: pdf.length, contentType: "application/pdf" }, now);
        // The summary goes into the chat as Study Buddy's message, with the paper and its result attached, so follow-up questions
        // ("explain question 3", "where did I lose marks?") have the answers and the document without any of it being redone.
        const message = await deps.store.chat.appendMessage(who, job.sessionId, "assistant", markdown, now);
        const attach = [record.id];
        for (const fileId of [job.fileId, job.schemeFileId]) {
          const file = fileId ? await deps.store.chat.getFile(who, fileId) : null;
          if (file && file.messageId === null) attach.push(file.id);
        }
        await deps.store.chat.attachFiles(who, job.sessionId, attach, message.id);
        await deps.store.papers.finish(job.id, this.workerId, { state: "done", resultFileId: record.id, pageCount, workedPages }, now);
        this.documents.delete(job.id);
        this.schemes.delete(job.id);
      } catch (error) {
        if (signal.aborted || (error as { code?: string }).code === "aborted") return;
        await this.fail(deps, job, (error as { userMessage?: string }).userMessage ?? (kind === "mark" ? "Something went wrong checking that paper. Please try again." : "Something went wrong solving that paper. Please try again."), kind === "mark" ? "mark" : "solve");
      }
    });
  }

  async cancel(deps: JobDeps, who: ChatOwner, id: string): Promise<boolean> {
    const found = await deps.store.papers.cancel(who, id, this.now(deps));
    if (found) this.running.get(id)?.abort();
    return found;
  }

  /**
   * Takes over active jobs whose worker has gone (its lease ran out) and carries them on. Cheap, and throttled so polling pages can call it:
   * at most once per third of a lease. A job this process is already working on is never taken from itself.
   */
  async recover(deps: JobDeps): Promise<number> {
    const now = this.now(deps);
    if (Date.now() - this.lastRecovery < this.leaseMs / 3) return 0;
    this.lastRecovery = Date.now();
    const { claimed, failed } = await deps.store.papers.claimStale(this.worker, now);
    if (failed) deps.log?.("paper_failed", { stage: "recovery", jobs: failed });
    for (const job of claimed) {
      if (this.running.has(job.id)) continue;
      deps.log?.("paper_recovered", { state: job.state, attempts: job.attempts, checkpoints: Object.keys(job.checkpoints).length });
      void (job.state === "extracting" ? this.extract(deps, job) : this.work(deps, job));
    }
    return claimed.length;
  }
}

// One worker per process, kept across module reloads so a reloaded server keeps its running jobs and its worker id.
const g = globalThis as unknown as { __learnthrivePaperJobs?: PaperJobs };
export function paperJobs(): PaperJobs {
  return (g.__learnthrivePaperJobs ??= new PaperJobs());
}
