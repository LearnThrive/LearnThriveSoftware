import type { AccountRuntime } from "@/lib/account/runtime";
import { paperMarkerEnabled, paperTutorEnabled } from "@/lib/assistant/config";
import type { AssistantRuntime } from "@/lib/assistant/runtime";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { paperJobs, viewOf, type JobDeps, type PaperJobs } from "./jobs";

/**
 * A tutor's review of a learner's marked paper, only where that tutor is authorised for that learner: signed in as a tutor, and the learner is on one of
 * their active tuition assignments. Anything else (another tutor's learner, a guardian's own paper that belongs to no learner, a job that does not exist)
 * is the same 404, so the route is no way to find out who has papers. The tutor sees the whole assessment (with the marks, whatever the learner is shown)
 * and may set the marks for a question; their decision replaces the AI's in the totals and the AI's assessment stays in the history.
 *
 *   GET  /api/tutor/papers/<id>             the marked paper as the tutor reviews it
 *   POST /api/tutor/papers/<id>/review      { questionId, marks: whole number or null, note }
 *
 * What the tutor is shown is the learner's marked work, not the learner's conversations: the chat stays the learner's.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const NOT_FOUND = () => jsonResponse(404, { error: "Not found." }, NO_STORE);

export interface TutorDeps {
  rt: AccountRuntime | null;
  assistant: AssistantRuntime | null;
  /** The signed-in tutor, or null for anyone else. */
  tutor: () => Promise<{ profileId: string } | null>;
  /** The learners this tutor teaches now (their active assignments). */
  studentsOf: (tutorProfileId: string) => Promise<string[]>;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  jobs?: PaperJobs;
}

async function authorised(request: Request, deps: TutorDeps, id: string, mutating: boolean) {
  const env = deps.env ?? process.env;
  if (mutating && !originAllowed(request, env)) return { ok: false as const, response: jsonResponse(403, { error: "Forbidden." }) };
  if (!UUID.test(id) || !deps.rt || !deps.assistant || !paperTutorEnabled(env) || !paperMarkerEnabled(env)) return { ok: false as const, response: NOT_FOUND() };
  const tutor = await deps.tutor();
  if (!tutor) return { ok: false as const, response: jsonResponse(401, { error: "Sign in as a tutor to review work." }, NO_STORE) };
  const job = await deps.rt.store.papers.getById(id);
  const students = job?.studentId ? await deps.studentsOf(tutor.profileId) : [];
  if (!job || job.kind !== "mark" || !job.studentId || !students.includes(job.studentId)) return { ok: false as const, response: NOT_FOUND() };
  const jobDeps: JobDeps = { store: deps.rt.store, uploads: deps.assistant.uploads, solve: { provider: deps.assistant.provider, queue: deps.assistant.queue, model: deps.assistant.config.model }, now: deps.now, marksReleased: true, log: (o, d) => logOutcome("paper-tutor-review", o, d) };
  return { ok: true as const, tutor, job, jobDeps, jobs: deps.jobs ?? paperJobs() };
}

export async function handleTutorPaper(request: Request, deps: TutorDeps, id: string): Promise<Response> {
  const a = await authorised(request, deps, id, false);
  if (!a.ok) return a.response;
  return jsonResponse(200, { job: viewOf(a.job, { marksReleased: true }) }, NO_STORE);
}

export async function handleTutorReview(request: Request, deps: TutorDeps, id: string): Promise<Response> {
  const a = await authorised(request, deps, id, true);
  if (!a.ok) return a.response;
  const body = await readBodyLimited(request, 4 * 1024);
  let raw: Record<string, unknown> | null = null;
  if (body.ok) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as unknown;
      raw = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      raw = null;
    }
  }
  const questionId = typeof raw?.questionId === "string" && /^q\d{1,4}$/.test(raw.questionId) ? raw.questionId : "";
  const marks = raw?.marks === null ? null : typeof raw?.marks === "number" && Number.isInteger(raw.marks) && raw.marks >= 0 && raw.marks <= 100 ? raw.marks : undefined;
  const note = typeof raw?.note === "string" ? raw.note.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) : "";
  if (!questionId || marks === undefined) return jsonResponse(400, { error: "Say which question, and the marks as a whole number (or leave them out)." }, NO_STORE);
  const result = await a.jobs.review(a.jobDeps, a.tutor.profileId, id, questionId, { marks, note });
  if (!result.ok) return result.code === "not_found" ? NOT_FOUND() : jsonResponse(409, { code: result.code, error: result.code === "not_done" ? "That paper has not finished being checked." : "That question changed at the same moment. Please reload and retry." }, NO_STORE);
  logOutcome("paper-tutor-review", "reviewed");
  return jsonResponse(200, { job: result.job }, NO_STORE);
}
