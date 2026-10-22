import { randomUUID } from "node:crypto";
import type { ChatOwner, LibraryStore } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import type { OutputMode } from "./annotate";
import { markingMarkdown, type MarkedQuestion } from "./mark";
import { extractQuestions, markCompleted, photoToPdf, readMarkScheme, solutionsMarkdown, solvePaper, type PaperDocument, type Progress } from "./paper";
import type { SolveDeps } from "./solve";

/**
 * Paper Tutor jobs: a paper takes minutes, so it runs in the background while the student carries on, and the page asks how it is
 * going. Kept in this server's memory (the result is not: the annotated PDF is stored as a chat file, so the download survives a
 * restart; an unfinished job does not, and the page says so). One job at a time per family, a daily cap, cancellable, and every
 * model call goes through the same generation queue as the chat, so a paper never starves anyone's question.
 *
 *   extracting -> ready (the questions found, to choose from) -> solving -> done | failed | cancelled
 *
 * A job is one of two kinds. "solve" writes worked solutions onto a paper. "mark" checks a student's own completed paper (opt-in:
 * PAPER_MARKER_ENABLED), optionally with a mark scheme uploaded to the same chat; its steps are the same, "solving" meaning marking.
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

interface Job extends PaperJobView {
  /** The family AND the learner this job belongs to: another learner in the same family never finds it. */
  owner: ChatOwner;
  sessionId: string;
  fileId: string;
  schemeFileId: string | null;
  scheme: Map<string, string> | null;
  document: PaperDocument | null;
  controller: AbortController;
  touched: number;
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

const sameOwner = (a: ChatOwner, b: ChatOwner) => a.clientId === b.clientId && a.studentId === b.studentId;

const TTL_MS = 2 * 60 * 60 * 1000;
export const JOBS_PER_DAY = 10;
export const USAGE_PAPER_DAY = "paper_job_day";

export interface JobDeps {
  store: LibraryStore;
  uploads: LibraryStorage;
  solve: Omit<SolveDeps, "signal">;
  now?: () => Date;
  log?: (outcome: string, details?: Record<string, string | number | boolean>) => void;
}

const view = (job: Job): PaperJobView => ({ id: job.id, kind: job.kind, state: job.state, results: job.results, questions: job.questions, progress: job.progress, mode: job.mode, resultFileId: job.resultFileId, pageCount: job.pageCount, workedPages: job.workedPages, message: job.message });

export class PaperJobs {
  constructor(private readonly jobs = new Map<string, Job>()) {}

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) if (now - job.touched > TTL_MS && job.state !== "solving" && job.state !== "extracting") this.jobs.delete(id);
  }

  get(owner: ChatOwner, id: string): PaperJobView | null {
    const job = this.jobs.get(id);
    if (!job || !sameOwner(job.owner, owner)) return null;
    job.touched = Date.now();
    return view(job);
  }

  /** One unfinished job at a time per household (one local model), whichever learner started it. */
  active(clientId: string): Job | null {
    return [...this.jobs.values()].find((j) => j.owner.clientId === clientId && (j.state === "extracting" || j.state === "solving")) ?? null;
  }

  /** Starts reading a paper the family uploaded to this chat. */
  async start(deps: JobDeps, input: { owner: ChatOwner; sessionId: string; fileId: string; kind?: JobKind; schemeFileId?: string }): Promise<{ ok: true; job: PaperJobView } | { ok: false; code: "busy" | "limit" | "not_found" }> {
    this.sweep();
    if (this.active(input.owner.clientId)) return { ok: false, code: "busy" };
    const file = await deps.store.chat.getFile(input.owner, input.fileId);
    if (!file || file.sessionId !== input.sessionId) return { ok: false, code: "not_found" };
    const scheme = input.schemeFileId && input.kind === "mark" ? await deps.store.chat.getFile(input.owner, input.schemeFileId) : null;
    if (input.schemeFileId && (!scheme || scheme.sessionId !== input.sessionId)) return { ok: false, code: "not_found" };
    const now = (deps.now ?? (() => new Date()))();
    const day = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
    if ((await deps.store.chat.usageCount(input.owner.clientId, USAGE_PAPER_DAY, day)) >= JOBS_PER_DAY) return { ok: false, code: "limit" };
    await deps.store.chat.incrementUsage(input.owner.clientId, USAGE_PAPER_DAY, day, 1);
    const job: Job = { id: randomUUID(), kind: input.kind ?? "solve", results: [], owner: input.owner, sessionId: input.sessionId, fileId: input.fileId, schemeFileId: scheme?.id ?? null, scheme: null, state: "extracting", questions: [], progress: [], mode: null, resultFileId: null, pageCount: null, workedPages: [], message: null, document: null, controller: new AbortController(), touched: Date.now() };
    this.jobs.set(job.id, job);
    void (async () => {
      try {
        const stored = await deps.uploads.read(file.storagePath);
        if (!stored) throw Object.assign(new Error("gone"), { userMessage: "That file is no longer stored. Please upload it again." });
        const bytes = file.contentType === "application/pdf" ? stored : await photoToPdf(stored, file.contentType);
        const document = await extractQuestions({ ...deps.solve, signal: job.controller.signal }, bytes);
        if (job.state === "cancelled") return;
        if ("problem" in document) throw Object.assign(new Error("unreadable"), { userMessage: document.problem });
        if (scheme) {
          const schemeBytes = scheme.contentType === "application/pdf" ? await deps.uploads.read(scheme.storagePath) : null;
          job.scheme = schemeBytes ? await readMarkScheme(schemeBytes) : null;
        }
        job.document = document;
        job.questions = document.questions.map((q) => ({ id: q.id, number: q.number, page: q.page, text: q.text.slice(0, 400), marks: q.marks, fromText: q.fromText }));
        job.state = "ready";
        const notices = [
          document.omitted ? `This paper has ${document.questions.length + document.omitted.questions} questions. Only the first ${document.omitted.limit} are listed (the limit is set by PAPER_MAX_PAGES / PAPER_MAX_QUESTIONS); question ${document.omitted.firstOmitted} onwards are NOT included, so this will not be a complete paper. Send the rest as a second document to cover them.` : null,
          scheme && !job.scheme ? "I could not read that mark scheme (it needs to be a PDF with its text in it), so I will mark without it." : null,
        ].filter(Boolean);
        job.message = document.questions.length ? (notices.length ? notices.join(" ") : null) : "I could not find any numbered questions in that document. You can still ask me about it in the chat.";
        deps.log?.("paper_extracted", { questions: document.questions.length });
      } catch (error) {
        if (job.state === "cancelled") return;
        job.state = "failed";
        job.message = (error as { userMessage?: string }).userMessage ?? "Something went wrong reading that paper. Please try again.";
        deps.log?.("paper_failed", { stage: "extract" });
      }
    })();
    return { ok: true, job: view(job) };
  }

  /** Solves (or, for a "mark" job, marks) the chosen questions of a ready job, then stores the PDF and posts a summary into the chat. */
  solve(deps: JobDeps, owner: ChatOwner, id: string, options: { mode: OutputMode; questionIds?: string[] }): { ok: true; job: PaperJobView } | { ok: false; code: "not_found" | "not_ready" | "busy" } {
    const job = this.jobs.get(id);
    if (!job || !sameOwner(job.owner, owner)) return { ok: false, code: "not_found" };
    if (job.state !== "ready" || !job.document || job.document.questions.length === 0) return { ok: false, code: "not_ready" };
    const others = this.active(owner.clientId);
    if (others && others.id !== id) return { ok: false, code: "busy" };
    const ids = options.questionIds?.filter((q) => job.questions.some((x) => x.id === q));
    job.state = "solving";
    job.mode = job.kind === "solve" ? options.mode : null;
    job.progress = (ids?.length ? ids : job.questions.map((q) => q.id)).map((questionId) => ({ questionId, state: "waiting" }));
    job.touched = Date.now();
    const document = job.document;
    const onProgress = (progress: Progress[]) => {
      job.progress = progress;
      job.touched = Date.now();
    };
    void (async () => {
      try {
        const solveDeps = { ...deps.solve, signal: job.controller.signal };
        let pdf: Uint8Array;
        let markdown: string;
        if (job.kind === "mark") {
          const result = await markCompleted(solveDeps, document, { questionIds: ids?.length ? ids : undefined, scheme: job.scheme, onProgress });
          if (job.state === "cancelled") return;
          ({ pdf } = result);
          markdown = markingMarkdown(result.marked, Boolean(job.scheme));
          job.results = result.marked.map(markedResult);
          job.pageCount = result.pageCount;
          job.workedPages = result.feedbackPages;
          deps.log?.("paper_marked", { questions: result.marked.length, correct: result.marked.filter((q) => q.outcome === "correct").length, needsChecking: result.marked.filter((q) => q.outcome === "needs_checking").length, scheme: Boolean(job.scheme) });
        } else {
          const result = await solvePaper(solveDeps, document, { mode: options.mode, questionIds: ids?.length ? ids : undefined, onProgress });
          if (job.state === "cancelled") return;
          ({ pdf } = result);
          markdown = solutionsMarkdown(result.solved);
          job.results = result.solved.map((q) => ({ id: q.id, number: q.number, status: q.status, answer: q.finalAnswer, steps: q.steps, note: q.statusNote || q.explanation }));
          job.pageCount = result.pageCount;
          job.workedPages = result.workedPages;
          deps.log?.("paper_solved", { questions: result.solved.length, verified: result.solved.filter((q) => q.status === "verified").length, unsolved: result.solved.filter((q) => q.status === "unsolved" || q.status === "failed").length });
        }
        const now = (deps.now ?? (() => new Date()))();
        const path = `${job.sessionId}/${randomUUID()}.pdf`;
        await deps.uploads.put(path, pdf, "application/pdf");
        const record = await deps.store.chat.addFile(owner, job.sessionId, { storagePath: path, bytes: pdf.length, contentType: "application/pdf" }, now);
        // The summary goes into the chat as Study Buddy's message, with the paper and its result attached, so follow-up questions
        // ("explain question 3", "where did I lose marks?") have the answers and the document without any of it being redone.
        const message = await deps.store.chat.appendMessage(owner, job.sessionId, "assistant", markdown, now);
        const attach = [record.id];
        for (const fileId of [job.fileId, job.schemeFileId]) {
          const file = fileId ? await deps.store.chat.getFile(owner, fileId) : null;
          if (file && file.messageId === null) attach.push(file.id);
        }
        await deps.store.chat.attachFiles(owner, job.sessionId, attach, message.id);
        job.resultFileId = record.id;
        job.state = "done";
      } catch (error) {
        if (job.state === "cancelled") return;
        job.state = "failed";
        job.message = (error as { code?: string }).code === "aborted" ? "The paper was cancelled." : job.kind === "mark" ? "Something went wrong checking that paper. Please try again." : "Something went wrong solving that paper. Please try again.";
        deps.log?.("paper_failed", { stage: job.kind === "mark" ? "mark" : "solve" });
      }
    })();
    return { ok: true, job: view(job) };
  }

  cancel(owner: ChatOwner, id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || !sameOwner(job.owner, owner)) return false;
    if (job.state === "extracting" || job.state === "solving" || job.state === "ready") {
      job.state = "cancelled";
      job.message = "Cancelled.";
      job.controller.abort();
    }
    return true;
  }
}

// Only the jobs themselves are kept across module reloads, so a reloaded server runs the current code on them.
const g = globalThis as unknown as { __learnthrivePaperJobMap?: Map<string, Job> };
export function paperJobs(): PaperJobs {
  return new PaperJobs((g.__learnthrivePaperJobMap ??= new Map()));
}
