import { randomUUID } from "node:crypto";
import type { LibraryStore } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import type { OutputMode } from "./annotate";
import { extractQuestions, photoToPdf, solutionsMarkdown, solvePaper, type PaperDocument, type Progress } from "./paper";
import type { SolveDeps } from "./solve";

/**
 * Paper Tutor jobs: a paper takes minutes, so it runs in the background while the student carries on, and the page asks how it is
 * going. Kept in this server's memory (the result is not: the annotated PDF is stored as a chat file, so the download survives a
 * restart; an unfinished job does not, and the page says so). One job at a time per family, a daily cap, cancellable, and every
 * model call goes through the same generation queue as the chat, so a paper never starves anyone's question.
 *
 *   extracting -> ready (the questions found, to choose from) -> solving -> done | failed | cancelled
 */
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

export interface PaperJobView {
  id: string;
  state: JobState;
  questions: JobQuestion[];
  progress: Progress[];
  mode: OutputMode | null;
  resultFileId: string | null;
  pageCount: number | null;
  workedPages: number[];
  message: string | null;
}

interface Job extends PaperJobView {
  clientId: string;
  sessionId: string;
  fileId: string;
  document: PaperDocument | null;
  controller: AbortController;
  touched: number;
}

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

const view = (job: Job): PaperJobView => ({ id: job.id, state: job.state, questions: job.questions, progress: job.progress, mode: job.mode, resultFileId: job.resultFileId, pageCount: job.pageCount, workedPages: job.workedPages, message: job.message });

export class PaperJobs {
  constructor(private readonly jobs = new Map<string, Job>()) {}

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) if (now - job.touched > TTL_MS && job.state !== "solving" && job.state !== "extracting") this.jobs.delete(id);
  }

  get(clientId: string, id: string): PaperJobView | null {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== clientId) return null;
    job.touched = Date.now();
    return view(job);
  }

  active(clientId: string): Job | null {
    return [...this.jobs.values()].find((j) => j.clientId === clientId && (j.state === "extracting" || j.state === "solving")) ?? null;
  }

  /** Starts reading a paper the family uploaded to this chat. */
  async start(deps: JobDeps, input: { clientId: string; sessionId: string; fileId: string }): Promise<{ ok: true; job: PaperJobView } | { ok: false; code: "busy" | "limit" | "not_found" }> {
    this.sweep();
    if (this.active(input.clientId)) return { ok: false, code: "busy" };
    const file = await deps.store.chat.getFile(input.clientId, input.fileId);
    if (!file || file.sessionId !== input.sessionId) return { ok: false, code: "not_found" };
    const now = (deps.now ?? (() => new Date()))();
    const day = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
    if ((await deps.store.chat.usageCount(input.clientId, USAGE_PAPER_DAY, day)) >= JOBS_PER_DAY) return { ok: false, code: "limit" };
    await deps.store.chat.incrementUsage(input.clientId, USAGE_PAPER_DAY, day, 1);
    const job: Job = { id: randomUUID(), clientId: input.clientId, sessionId: input.sessionId, fileId: input.fileId, state: "extracting", questions: [], progress: [], mode: null, resultFileId: null, pageCount: null, workedPages: [], message: null, document: null, controller: new AbortController(), touched: Date.now() };
    this.jobs.set(job.id, job);
    void (async () => {
      try {
        const stored = await deps.uploads.read(file.storagePath);
        if (!stored) throw Object.assign(new Error("gone"), { userMessage: "That file is no longer stored. Please upload it again." });
        const bytes = file.contentType === "application/pdf" ? stored : await photoToPdf(stored, file.contentType);
        const document = await extractQuestions({ ...deps.solve, signal: job.controller.signal }, bytes);
        if (job.state === "cancelled") return;
        if ("problem" in document) throw Object.assign(new Error("unreadable"), { userMessage: document.problem });
        job.document = document;
        job.questions = document.questions.map((q) => ({ id: q.id, number: q.number, page: q.page, text: q.text.slice(0, 400), marks: q.marks, fromText: q.fromText }));
        job.state = "ready";
        job.message = document.questions.length ? null : "I could not find any numbered questions in that document. You can still ask me about it in the chat.";
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

  /** Solves the chosen questions of a ready job, then stores the annotated PDF and posts a summary into the chat. */
  solve(deps: JobDeps, clientId: string, id: string, options: { mode: OutputMode; questionIds?: string[] }): { ok: true; job: PaperJobView } | { ok: false; code: "not_found" | "not_ready" | "busy" } {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== clientId) return { ok: false, code: "not_found" };
    if (job.state !== "ready" || !job.document || job.document.questions.length === 0) return { ok: false, code: "not_ready" };
    const others = this.active(clientId);
    if (others && others.id !== id) return { ok: false, code: "busy" };
    const ids = options.questionIds?.filter((q) => job.questions.some((x) => x.id === q));
    job.state = "solving";
    job.mode = options.mode;
    job.progress = (ids?.length ? ids : job.questions.map((q) => q.id)).map((questionId) => ({ questionId, state: "waiting" }));
    job.touched = Date.now();
    const document = job.document;
    void (async () => {
      try {
        const result = await solvePaper({ ...deps.solve, signal: job.controller.signal }, document, {
          mode: options.mode,
          questionIds: ids?.length ? ids : undefined,
          onProgress: (progress) => {
            job.progress = progress;
            job.touched = Date.now();
          },
        });
        if (job.state === "cancelled") return;
        const now = (deps.now ?? (() => new Date()))();
        const path = `${job.sessionId}/${randomUUID()}.pdf`;
        await deps.uploads.put(path, result.pdf, "application/pdf");
        const record = await deps.store.chat.addFile(clientId, job.sessionId, { storagePath: path, bytes: result.pdf.length, contentType: "application/pdf" }, now);
        // The summary goes into the chat as Study Buddy's message, with the paper and its annotated copy attached, so follow-up
        // questions ("explain question 3") have the solutions and the document without solving anything again.
        const message = await deps.store.chat.appendMessage(clientId, job.sessionId, "assistant", solutionsMarkdown(result.solved), now);
        const original = await deps.store.chat.getFile(clientId, job.fileId);
        await deps.store.chat.attachFiles(clientId, job.sessionId, [record.id, ...(original && original.messageId === null ? [original.id] : [])], message.id);
        job.resultFileId = record.id;
        job.pageCount = result.pageCount;
        job.workedPages = result.workedPages;
        job.state = "done";
        deps.log?.("paper_solved", { questions: result.solved.length, verified: result.solved.filter((q) => q.status === "verified").length, unsolved: result.solved.filter((q) => q.status === "unsolved" || q.status === "failed").length });
      } catch (error) {
        if (job.state === "cancelled") return;
        job.state = "failed";
        job.message = (error as { code?: string }).code === "aborted" ? "The paper was cancelled." : "Something went wrong solving that paper. Please try again.";
        deps.log?.("paper_failed", { stage: "solve" });
      }
    })();
    return { ok: true, job: view(job) };
  }

  cancel(clientId: string, id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== clientId) return false;
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
