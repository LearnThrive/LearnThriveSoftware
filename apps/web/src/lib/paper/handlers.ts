import { jsonResponse, logOutcome, readBodyLimited } from "@/lib/request-guards";
import { renderPdfPages } from "@/lib/assistant/documents";
import { paperMarkerEnabled, paperMarksReleased, paperTutorEnabled } from "@/lib/assistant/config";
import { gate, refuse, type AssistantDeps } from "@/lib/assistant/handlers";
import type { OutputMode } from "./annotate";
import { paperJobs, type PaperJobs } from "./jobs";

/**
 * The Paper Tutor's routes. All of them sit behind the chat's gate (Origin, assistant open, signed-in adult, Library access), plus the
 * feature's own switch: PAPER_TUTOR_ENABLED (development: on unless "false"; production: on only if exactly "true", and only where
 * the assistant itself may run). A job and its files are only ever found by the family that owns them.
 *
 *   POST   /api/assistant/papers                { fileId, sessionId, kind?, schemeFileId?, blankFileId? }   start reading a paper  -> the job
 *                                               kind "mark" (a completed paper, opt-in: PAPER_MARKER_ENABLED) may name a mark scheme and a blank question paper uploaded to the same chat
 *   POST   /api/assistant/papers/<id>/correct   { questionId, answer?, working?, note? }  a person corrects how a question was read; it is assessed again
 *   GET    /api/assistant/papers/<id>/history?questionId=q1                          every version of one question's assessment (marking)
 *   GET    /api/assistant/papers/<id>                                                how it is going
 *   POST   /api/assistant/papers/<id>/solve     { mode, questionIds? }               solve (all, or the chosen questions)
 *   DELETE /api/assistant/papers/<id>                                                cancel
 *   GET    /api/assistant/papers/<id>/preview?page=N                                 a picture of one page of the result
 *   GET    /api/assistant/files/<id>[?download=1]                                    a file of the family's (the annotated PDF)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const MODES: OutputMode[] = ["hybrid", "filled", "worked"];

export interface PaperDeps extends AssistantDeps {
  jobs?: PaperJobs;
}

async function paperGate(request: Request, deps: PaperDeps, event: string, mutating: boolean) {
  const g = await gate(request, deps, event, { mutating });
  if (!g.ok) return g;
  if (!paperTutorEnabled(deps.env ?? process.env)) return { ok: false as const, response: jsonResponse(404, { error: "Not found." }, NO_STORE) };
  const jobDeps = {
    store: g.rt.store,
    uploads: g.assistant.uploads,
    solve: { provider: g.assistant.provider, queue: g.assistant.queue, model: g.assistant.config.model, visionModel: g.assistant.config.visionModel ?? g.assistant.config.model },
    now: deps.now,
    marksReleased: paperMarksReleased(deps.env ?? process.env),
    log: (outcome: string, details?: Record<string, string | number | boolean>) => logOutcome("paper-tutor", outcome, details),
  };
  const jobs = deps.jobs ?? paperJobs();
  // A job whose worker has gone (a restart, a crash) is taken over here, on the next request from anyone; cheap and throttled.
  void jobs.recover(jobDeps).catch(() => undefined);
  return { ok: true as const, g, jobs, jobDeps };
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await readBodyLimited(request, 8 * 1024);
  if (!body.ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const MESSAGES = {
  busy: "A paper is already being worked on. Please wait for it to finish, or cancel it.",
  limit: "You have used today's papers. Please try again tomorrow.",
  not_found: "We could not find that.",
  not_ready: "That paper is not ready to solve yet.",
} as const;

export async function handleStartPaper(request: Request, deps: PaperDeps): Promise<Response> {
  const p = await paperGate(request, deps, "paper-start", true);
  if (!p.ok) return p.response;
  const raw = await jsonBody(request);
  const fileId = typeof raw?.fileId === "string" ? raw.fileId : "";
  const sessionId = typeof raw?.sessionId === "string" ? raw.sessionId : "";
  if (!UUID.test(fileId) || !UUID.test(sessionId)) return refuse("bad_request");
  const kind = raw?.kind === "mark" ? "mark" : "solve";
  // Marking is a separate, opt-in feature: off, it does not exist.
  if (kind === "mark" && !paperMarkerEnabled(deps.env ?? process.env)) return refuse("not_found");
  const schemeFileId = typeof raw?.schemeFileId === "string" ? raw.schemeFileId : undefined;
  if (schemeFileId !== undefined && !UUID.test(schemeFileId)) return refuse("bad_request");
  const blankFileId = typeof raw?.blankFileId === "string" ? raw.blankFileId : undefined;
  if (blankFileId !== undefined && !UUID.test(blankFileId)) return refuse("bad_request");
  const started = await p.jobs.start(p.jobDeps, { owner: p.g.owner, sessionId, fileId, kind, schemeFileId, blankFileId });
  if (!started.ok) return jsonResponse(started.code === "not_found" ? 404 : started.code === "limit" ? 429 : 409, { code: started.code, error: MESSAGES[started.code] }, NO_STORE);
  logOutcome("paper-start", "started");
  return jsonResponse(202, { job: started.job }, NO_STORE);
}

export async function handlePaper(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const p = await paperGate(request, deps, "paper-job", request.method !== "GET");
  if (!p.ok) return p.response;
  if (!UUID.test(id)) return refuse("not_found");
  if (request.method === "DELETE") return (await p.jobs.cancel(p.jobDeps, p.g.owner, id)) ? jsonResponse(200, { success: true }, NO_STORE) : refuse("not_found");
  const job = await p.jobs.get(p.jobDeps, p.g.owner, id);
  return job ? jsonResponse(200, { job }, NO_STORE) : jsonResponse(404, { code: "not_found", error: "That paper is no longer here (jobs are kept for seven days). Please start again." }, NO_STORE);
}

export async function handleSolvePaper(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const p = await paperGate(request, deps, "paper-solve", true);
  if (!p.ok) return p.response;
  if (!UUID.test(id)) return refuse("not_found");
  const raw = await jsonBody(request);
  const mode = MODES.find((m) => m === raw?.mode) ?? "hybrid";
  const questionIds = Array.isArray(raw?.questionIds) ? raw.questionIds.filter((q): q is string => typeof q === "string" && /^q\d{1,3}$/.test(q)).slice(0, 30) : undefined;
  const result = await p.jobs.solve(p.jobDeps, p.g.owner, id, { mode, questionIds });
  if (!result.ok) return jsonResponse(result.code === "not_found" ? 404 : 409, { code: result.code, error: MESSAGES[result.code] }, NO_STORE);
  return jsonResponse(202, { job: result.job }, NO_STORE);
}

const CORRECTION_MESSAGES = {
  not_found: "We could not find that.",
  not_done: "That paper has not finished being checked yet.",
  limit: "You have used today's corrections. Please try again tomorrow.",
  unavailable: "That question was changed at the same moment. Please look at it again and retry.",
} as const;

/** A person corrects how one question was read. The marker is off unless marking is on; the body is small and every field is bounded. */
export async function handleCorrectPaper(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const p = await paperGate(request, deps, "paper-correct", true);
  if (!p.ok) return p.response;
  if (!UUID.test(id) || !paperMarkerEnabled(deps.env ?? process.env)) return refuse("not_found");
  const raw = await jsonBody(request);
  const questionId = typeof raw?.questionId === "string" && /^q\d{1,4}$/.test(raw.questionId) ? raw.questionId : "";
  if (!questionId) return refuse("bad_request");
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : undefined);
  const answer = text(raw?.answer, 300);
  const working = Array.isArray(raw?.working) ? raw.working.slice(0, 10).map((l) => text(l, 300) ?? "").filter((l) => l.trim() !== "") : undefined;
  if (answer === undefined && working === undefined) return refuse("bad_request");
  const result = await p.jobs.correct(p.jobDeps, p.g.owner, id, questionId, { answer, working, note: text(raw?.note, 500) });
  if (!result.ok) return jsonResponse(result.code === "not_found" ? 404 : result.code === "limit" ? 429 : 409, { code: result.code, error: CORRECTION_MESSAGES[result.code] }, NO_STORE);
  logOutcome("paper-correct", "corrected");
  return jsonResponse(200, { job: result.job }, NO_STORE);
}

/** Every version of one question's assessment, for the family's own job: the AI's, each correction, each tutor review. */
export async function handlePaperHistory(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const p = await paperGate(request, deps, "paper-history", false);
  if (!p.ok) return p.response;
  const questionId = new URL(request.url).searchParams.get("questionId") ?? "";
  if (!UUID.test(id) || !/^q\d{1,4}$/.test(questionId)) return refuse("not_found");
  const versions = await p.g.rt.store.papers.versions({ kind: "owner", owner: p.g.owner }, id, questionId);
  if (versions.length === 0) return refuse("not_found");
  // What was decided, by whom and when. The whole assessed value is what the panel's own result already holds, so only the summary is sent.
  return jsonResponse(200, { versions: versions.map((v) => ({ version: v.version, kind: v.kind, by: v.actorKind, at: v.createdAt.toISOString(), note: v.note })) }, NO_STORE);
}

export async function handlePaperPreview(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const p = await paperGate(request, deps, "paper-preview", false);
  if (!p.ok) return p.response;
  const job = UUID.test(id) ? await p.jobs.get(p.jobDeps, p.g.owner, id) : null;
  if (!job?.resultFileId) return refuse("not_found");
  const file = await p.g.rt.store.chat.getFile(p.g.owner, job.resultFileId);
  const bytes = file ? await p.g.assistant.uploads.read(file.storagePath) : null;
  if (!bytes) return refuse("not_found");
  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > (job.pageCount ?? 1)) return refuse("not_found");
  const [render] = await renderPdfPages(bytes, { scale: 1.2, pages: [page] });
  if (!render) return refuse("not_found");
  const jpeg = render.jpeg();
  return new Response(jpeg as BodyInit, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length), ...NO_STORE, "X-Content-Type-Options": "nosniff" } });
}

export async function handleFile(request: Request, deps: PaperDeps, id: string): Promise<Response> {
  const g = await gate(request, deps, "assistant-file", { mutating: false });
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return refuse("not_found");
  const file = await g.rt.store.chat.getFile(g.owner, id);
  const bytes = file ? await g.assistant.uploads.read(file.storagePath) : null;
  if (!file || !bytes) return refuse("not_found");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = file.contentType === "application/pdf" ? "study-buddy-paper.pdf" : file.contentType === "image/png" ? "upload.png" : "upload.jpg";
  logOutcome("assistant-file", "sent");
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: { "Content-Type": file.contentType, "Content-Length": String(bytes.length), "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`, ...NO_STORE, "X-Content-Type-Options": "nosniff" },
  });
}
