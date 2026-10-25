import { createHash, randomUUID } from "node:crypto";
import { renewSession, type CookieJar } from "@/lib/account/session";
import type { AccountRuntime } from "@/lib/account/runtime";
import type { Account, Actor, AssistantDenial, ChatOwner } from "@learnthrive/data/library";
import { resolveRequestActor } from "@/lib/learner/resolve";
import { jsonResponse, logOutcome, originAllowed, parseMultipart, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import { assistantAvailability, assistantConfig, paperMarkerEnabled, paperTutorEnabled } from "./config";
import { moderateInput } from "./moderation";
import { modelLabel } from "./models";
import { ADULT_ACKNOWLEDGEMENT, ADULT_ACK_VERSION } from "./prompt";
import type { AssistantRuntime } from "./runtime";
import { mayChooseModel, pickerChoices, pickerScope, resolveSelection } from "./selection";
import { sendMessage, type ChatEvent } from "./service";
import { UPLOAD_LIMITS, inspectChatUpload } from "./uploads";
import { voiceClosed, type VoiceRuntime } from "./voice";

/**
 * The Study Buddy routes' logic (plan19 phase F). Every one starts the same way: Origin check, the assistant open at all (the kill
 * switch, production approval, a provider), a signed-in ADULT account, and a family that holds Library access (enrolled, a
 * subscription or an administrator grant: not free-samples-only). A chat is only ever found by the family that owns it.
 *
 *   POST   /api/assistant/chat              a question; the answer streams back as newline-delimited JSON events
 *   POST   /api/assistant/files             one photo or PDF for the next question
 *   GET    /api/assistant/sessions          the family's chats
 *   GET    /api/assistant/sessions/<id>     one chat's messages
 *   PATCH  /api/assistant/sessions/<id>     rename it: { "title": "..." } (1 to 120 characters, no personal details)
 *   DELETE /api/assistant/sessions/<id>     hide it now; the retention job removes it and its files
 *   DELETE /api/assistant/sessions          the same for every chat
 *   GET    /api/assistant/export            everything held, as JSON
 *   GET    /api/assistant/status            whether it is open (and why not), for the page
 *
 * Until the safeguarding lead has approved the assistant for children (ASSISTANT_MINORS_APPROVED), a new chat needs the adult to
 * confirm they are 18 or over and are the one using it, and a chat cannot be tied to a student profile.
 */
export interface AssistantDeps {
  rt: AccountRuntime | null;
  jar: CookieJar;
  assistant: AssistantRuntime | null;
  /** Only the status route needs it, to say whether the microphone button should appear. */
  voice?: VoiceRuntime | null;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

export type Reason =
  | "learner_unavailable"
  | "consent_needed"
  | "unavailable"
  | "voice_unavailable"
  | "bad_audio"
  | "signed_out"
  | "adult_required"
  | "no_access"
  | "adult_confirmation"
  | "bad_request"
  | "too_large"
  | "not_found"
  | "too_many_files"
  | "rate_limited"
  | "model_not_allowed"
  | "bad_model"
  | "model_unavailable"
  | "uploads_not_sent";

const STATUS: Record<Reason, number> = {
  learner_unavailable: 403,
  consent_needed: 403,
  unavailable: 503,
  voice_unavailable: 503,
  bad_audio: 422,
  signed_out: 401,
  adult_required: 403,
  no_access: 403,
  adult_confirmation: 422,
  bad_request: 400,
  too_large: 413,
  not_found: 404,
  too_many_files: 422,
  rate_limited: 429,
  model_not_allowed: 403,
  bad_model: 400,
  model_unavailable: 503,
  uploads_not_sent: 422,
};

const MESSAGE: Record<Reason, string> = {
  learner_unavailable: "LearnThrive AI is not available for this learner right now. Please ask your parent or guardian.",
  consent_needed: "A parent or guardian needs to say that LearnThrive AI may be used before it can open. Please ask them.",
  unavailable: `LearnThrive AI is not available right now. Please email ${siteConfig.email} if you need help.`,
  voice_unavailable: "Voice is not available right now. You can still type your question.",
  bad_audio: "We could not use that recording. Please try again, or type your question.",
  signed_out: "Please sign in to use LearnThrive AI.",
  adult_required: "LearnThrive AI is for adult account holders.",
  no_access: "LearnThrive AI is included for enrolled students and Library subscribers.",
  adult_confirmation: "Please confirm that you are 18 or over and that you are the person using LearnThrive AI.",
  bad_request: "We could not read that request.",
  too_large: "That is too large.",
  not_found: "We could not find that.",
  too_many_files: `You can attach at most ${UPLOAD_LIMITS.filesPerMessage} files to a question.`,
  rate_limited: "Too many requests. Please wait a little.",
  model_not_allowed: "Choosing the AI model is not available for this account.",
  bad_model: "That AI model is not one that can be chosen here.",
  model_unavailable: "That AI model is not available right now. Choose another one.",
  uploads_not_sent: "Files are not sent to this trial model. Remove the file, or switch to the local model to use it.",
};

export const refuse = (reason: Reason, extra: Record<string, string> = {}) => jsonResponse(STATUS[reason], { code: reason, error: MESSAGE[reason] }, { "Cache-Control": "no-store", ...extra });

/**
 * What every route gets from the gate. `actor` is who is acting (a guardian, a learner, a guardian viewing as a learner, staff) and
 * `owner` is what every chat, file and paper is scoped by: the family AND the learner. Both are resolved on the server; a client id,
 * student id or role in a request body is never read.
 */
export type Gate = { ok: true; rt: AccountRuntime; assistant: AssistantRuntime; actor: Actor; owner: ChatOwner; account: Account; email: string } | { ok: false; response: Response };

/** Why the assistant is closed to this actor, as the reason the page and the API give. */
function reasonFor(denial: AssistantDenial | null): Reason {
  switch (denial) {
    case "adult_required": return "adult_required";
    case "consent_needed": return "consent_needed";
    case "learner_inactive":
    case "guardian_inactive":
    case "learner_not_enabled":
    case "minors_closed": return "learner_unavailable";
    default: return "no_access";
  }
}

export async function gate(request: Request, deps: AssistantDeps, event: string, { mutating = true }: { mutating?: boolean } = {}): Promise<Gate> {
  const env = deps.env ?? process.env;
  if (mutating && !originAllowed(request, env)) {
    logOutcome(event, "forbidden_origin");
    return { ok: false, response: jsonResponse(403, { error: "Forbidden." }) };
  }
  const open = assistantAvailability(assistantConfig(env), env, Boolean(deps.rt));
  if (!open.open || !deps.assistant || !deps.rt) {
    logOutcome(event, "closed", { reason: open.open ? "no-runtime" : open.reason });
    return { ok: false, response: refuse("unavailable") };
  }
  const session = await renewSession(deps.jar, deps.rt);
  if (session.status !== "ok") return { ok: false, response: refuse("signed_out") };
  const now = (deps.now ?? (() => new Date()))();
  const resolved = await resolveRequestActor(deps.rt, deps.jar, session.user.id, { minorsApproved: deps.assistant.config.minorsApproved, now });
  if (!resolved) return { ok: false, response: refuse("signed_out") };
  const { actor, account } = resolved;
  // The same rule as the sign-in routing and the navigation (platformAccess), now with the learner's own state: a suspended learner, a
  // revoked guardian link or a withdrawn consent is refused here on the next request, whatever the access token still says.
  if (!actor.assistant.allowed || !actor.owner) {
    logOutcome(event, actor.assistant.reason ?? "no_access", { mode: actor.mode });
    return { ok: false, response: refuse(reasonFor(actor.assistant.reason)) };
  }
  return { ok: true, rt: deps.rt, assistant: deps.assistant, actor, owner: actor.owner, account, email: session.user.email };
}

const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleChat(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-chat");
  if (!g.ok) return g.response;
  const body = await readBodyLimited(request, 32 * 1024);
  let raw: Record<string, unknown> | null = null;
  if (body.ok) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as unknown;
      raw = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      raw = null;
    }
  }
  if (!raw) return refuse(body.ok ? "bad_request" : "too_large");
  const text = typeof raw.text === "string" ? raw.text : "";
  const sessionId = typeof raw.sessionId === "string" && raw.sessionId ? raw.sessionId : null;
  if (sessionId && !UUID.test(sessionId)) return refuse("bad_request");
  const fileIds = Array.isArray(raw.fileIds) ? raw.fileIds.filter((id): id is string => typeof id === "string" && UUID.test(id)).slice(0, UPLOAD_LIMITS.filesPerMessage) : [];
  // A request that names a model is checked here, on the server, every time: who is asking, and whether it is a choice offered here. Refused
  // outright otherwise (never quietly answered by another model), before anything is recorded or sent.
  const selection = resolveSelection({ requested: raw.model, actor: g.actor, lab: g.assistant.lab ?? null, config: g.assistant.config, provider: g.assistant.provider, hosted: g.assistant.hosted });
  if (!selection.ok) {
    logOutcome("assistant-chat", selection.reason);
    return refuse(selection.reason);
  }
  if (fileIds.length && !selection.target.uploads) {
    logOutcome("assistant-chat", "uploads_not_sent");
    return refuse("uploads_not_sent");
  }
  const minors = g.assistant.config.minorsApproved;
  const adultAck = raw.adultAck === true;
  if (!sessionId && !minors) {
    if (!adultAck) return refuse("adult_confirmation");
    await g.rt.store.billing.recordConsent({ profileId: g.account.profileId, kind: "assistant_adult_use", version: ADULT_ACK_VERSION, textSha256: createHash("sha256").update(`${ADULT_ACK_VERSION}
${ADULT_ACKNOWLEDGEMENT}`).digest("hex"), at: (deps.now ?? (() => new Date()))() });
  }

  const events = sendMessage(
    {
      store: g.rt.store,
      provider: g.assistant.provider,
      queue: g.assistant.queue,
      uploads: g.assistant.uploads,
      config: g.assistant.config,
      embeddings: g.assistant.embeddings,
      decision: g.assistant.decision,
      research: g.assistant.research,
      flag: g.assistant.flag,
      hosted: g.assistant.hosted,
      target: selection.target,
      now: deps.now,
      log: (outcome, details) => logOutcome("assistant-chat", outcome, details),
    },
    { owner: g.owner, sessionId, text, fileIds, signal: request.signal, voice: raw.voice === true },
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) return controller.close();
        controller.enqueue(encoder.encode(`${JSON.stringify(next.value satisfies ChatEvent)}\n`));
      } catch {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: "unavailable" })}\n`));
        controller.close();
      }
    },
    cancel() {
      void events.return(undefined);
    },
  });
  return new Response(stream, { status: 200, headers: NDJSON });
}

const UPLOADS_PER_HOUR = 30;

export async function handleUpload(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-upload");
  if (!g.ok) return g.response;
  const now = (deps.now ?? (() => new Date()))();
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  if ((await g.rt.store.chat.usageCount(g.owner.clientId, "assistant_upload_hour", hour)) >= UPLOADS_PER_HOUR) return refuse("rate_limited", { "Retry-After": "600" });
  const body = await readBodyLimited(request, UPLOAD_LIMITS.pdfBytes + 64 * 1024);
  if (!body.ok) return refuse("too_large");
  const form = await parseMultipart(body.bytes, request.headers.get("content-type"));
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return refuse("bad_request");
  const asked = form.get("sessionId");
  let sessionId = typeof asked === "string" && asked ? asked : null;
  if (sessionId && !UUID.test(sessionId)) return refuse("bad_request");
  if (sessionId) {
    if (!(await g.rt.store.chat.getSession(g.owner, sessionId))) return refuse("not_found");
    if ((await g.rt.store.chat.listFiles(g.owner, sessionId)).filter((f) => f.messageId === null).length >= UPLOAD_LIMITS.filesPerMessage) return refuse("too_many_files");
  }

  const result = await inspectChatUpload(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) {
    logOutcome("assistant-upload", "refused", { code: result.problem.code });
    return jsonResponse(422, { code: "refused", error: result.problem.message }, { "Cache-Control": "no-store" });
  }
  if (!sessionId) sessionId = (await g.rt.store.chat.createSession(g.owner, { title: "New chat" }, now)).id;
  const path = `${sessionId}/${randomUUID()}.${result.contentType === "application/pdf" ? "pdf" : result.contentType === "image/png" ? "png" : "jpg"}`;
  await g.assistant.uploads.put(path, result.bytes, result.contentType);
  const record = await g.rt.store.chat.addFile(g.owner, sessionId, { storagePath: path, bytes: result.bytes.length, contentType: result.contentType }, now);
  await g.rt.store.chat.incrementUsage(g.owner.clientId, "assistant_upload_hour", hour, 1);
  logOutcome("assistant-upload", "stored", { kind: result.kind });
  return jsonResponse(200, { fileId: record.id, sessionId, name: result.name, kind: result.kind, contentType: result.contentType, pages: "pages" in result ? result.pages : null }, { "Cache-Control": "no-store" });
}

export async function handleSessions(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-sessions", { mutating: false });
  if (!g.ok) return g.response;
  const sessions = await g.rt.store.chat.listSessions(g.owner);
  return jsonResponse(200, { sessions: sessions.map((s) => ({ id: s.id, title: s.title, lastActivityAt: s.lastActivityAt.toISOString() })) }, { "Cache-Control": "no-store" });
}

export async function handleSession(request: Request, deps: AssistantDeps, sessionId: string): Promise<Response> {
  const method = request.method;
  const g = await gate(request, deps, "assistant-session", { mutating: method !== "GET" });
  if (!g.ok) return g.response;
  if (!UUID.test(sessionId)) return refuse("not_found");
  if (method === "PATCH") {
    const body = await readBodyLimited(request, 2048);
    let title = "";
    if (body.ok) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as { title?: unknown };
        title = typeof parsed.title === "string" ? parsed.title.replace(/\s+/g, " ").trim() : "";
      } catch {
        title = "";
      }
    }
    if (!title || title.length > 120) return refuse("bad_request");
    // A title is shown in the list and kept with the chat, so the same rules apply as to a message: no personal details.
    if (moderateInput(title).action !== "allow") return jsonResponse(422, { code: "title_refused", error: "Please choose a title without personal details." }, { "Cache-Control": "no-store" });
    const ok = await g.rt.store.chat.renameSession(g.owner, sessionId, title);
    logOutcome("assistant-session", ok ? "renamed" : "not_found");
    return ok ? jsonResponse(200, { success: true, title }, { "Cache-Control": "no-store" }) : refuse("not_found");
  }
  if (method === "DELETE") {
    const ok = await g.rt.store.chat.requestDeletion(g.owner, sessionId, (deps.now ?? (() => new Date()))());
    logOutcome("assistant-session", ok ? "deleted" : "not_found");
    return ok ? jsonResponse(200, { success: true }, { "Cache-Control": "no-store" }) : refuse("not_found");
  }
  const session = await g.rt.store.chat.getSession(g.owner, sessionId);
  if (!session) return refuse("not_found");
  const messages = await g.rt.store.chat.listMessages(g.owner, sessionId);
  const files = await g.rt.store.chat.listFiles(g.owner, sessionId);
  // What each message carried, so a reopened chat still shows the photos and documents (fetched from /api/assistant/files/:id).
  const carried = (messageId: string) => files.filter((f) => f.messageId === messageId).map((f) => ({ id: f.id, contentType: f.contentType, bytes: f.bytes }));
  // Which model wrote an answer is shown only to someone who may choose models (the developer evaluating them), never to a student.
  const labels = mayChooseModel(g.actor, g.assistant.lab ?? null);
  return jsonResponse(
    200,
    {
      id: session.id,
      title: session.title,
      messages: messages.map((m) => {
        const answeredBy = labels && m.role === "assistant" ? modelLabel(m.generatedBy) : null;
        return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(), ...(m.role === "user" && carried(m.id).length > 0 ? { files: carried(m.id) } : {}), ...(answeredBy ? { model: answeredBy } : {}) };
      }),
    },
    { "Cache-Control": "no-store" },
  );
}

export async function handleDeleteAll(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-delete-all");
  if (!g.ok) return g.response;
  const count = await g.rt.store.chat.requestDeletionAll(g.owner, (deps.now ?? (() => new Date()))());
  logOutcome("assistant-delete-all", "deleted", { chats: count });
  return jsonResponse(200, { success: true, deleted: count }, { "Cache-Control": "no-store" });
}

export async function handleExport(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-export", { mutating: false });
  if (!g.ok) return g.response;
  const data = await g.rt.store.chat.exportAll(g.owner, (deps.now ?? (() => new Date()))());
  logOutcome("assistant-export", "sent", { chats: data.sessions.length });
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="study-buddy-export.json"', "Cache-Control": "no-store" } });
}

/** A hosted model's readiness, re-asked at most once a minute: opening the page should not list NVIDIA's catalogue every time. */
const readiness = new Map<string, { at: number; ok: boolean; detail: string }>();
async function choiceHealth(choice: string, provider: { health(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> }): Promise<{ ok: boolean; detail: string }> {
  const known = readiness.get(choice);
  if (known && Date.now() - known.at < 60_000) return known;
  const h = await provider.health(AbortSignal.timeout(4000)).catch(() => ({ ok: false, detail: "unreachable" }));
  readiness.set(choice, { at: Date.now(), ...h });
  return h;
}

/** Whether Study Buddy is open for this visitor, so the page can say why not. Reveals nothing about who is asking. */
export async function handleStatus(request: Request, deps: AssistantDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const config = assistantConfig(env);
  const open = assistantAvailability(config, env, Boolean(deps.rt));
  if (!open.open) return jsonResponse(200, { open: false, reason: open.reason }, { "Cache-Control": "no-store" });
  const g = await gate(request, deps, "assistant-status", { mutating: false });
  if (!g.ok) return g.response;
  const health = await g.assistant.provider.health(AbortSignal.timeout(4000)).catch(() => ({ ok: false, detail: "unreachable" }));
  // The helper roles are probed, not inferred from configuration: a model listed by the server is not proof that its endpoint
  // answers (brief section 4). A helper that is down only turns that role off; the chat still works.
  const helper = async (h: { health(signal?: AbortSignal): Promise<{ ok: boolean }> } | null) =>
    h ? h.health(AbortSignal.timeout(1500)).then((r) => r.ok).catch(() => false) : false;
  const [retrievalReady, decisionReady] = await Promise.all([
    config.retrieval.enabled ? helper(g.assistant.embeddings) : false,
    config.decision.enabled ? helper(g.assistant.decision) : false,
  ]);
  const voice = deps.voice && !voiceClosed(env, true) ? await deps.voice.health().catch(() => false) : false;
  // The developer's model picker: the choices, whether each answers now (a model listing, no generation), and an opaque key for the
  // browser to keep this account's last choice under. Absent for everyone who may not choose.
  const lab = g.assistant.lab ?? null;
  const picker = mayChooseModel(g.actor, lab)
    ? await Promise.all(
        pickerChoices(lab, config).map(async (c) => {
          if (c.id === "local") return { ...c, ready: health.ok, detail: health.ok ? null : health.detail };
          const h = await choiceHealth(c.id, lab!.providers.get(c.id)!);
          return { ...c, ready: h.ok, detail: h.ok ? null : h.detail };
        }),
      )
    : null;
  // A developer whose local tutor is down can still use a hosted model, so the page opens when any choice answers.
  const usable = health.ok || Boolean(picker?.some((c) => c.ready));
  return jsonResponse(
    200,
    {
      open: usable,
      reason: usable ? null : health.detail,
      ...(picker ? { models: { choices: picker, default: picker.find((c) => c.ready && c.id !== "local")?.id ?? picker.find((c) => c.ready)?.id ?? picker[0]?.id ?? null, scope: pickerScope(g.actor.profileId), uploads: lab!.settings.uploads } } : {}),
      voice,
      paperTutor: paperTutorEnabled(env),
      paperMarker: paperMarkerEnabled(env),
      minorsApproved: config.minorsApproved,
      // The helper roles, as the page shows them: retrieval and routing are extra, and a missing helper does not close the chat.
      retrieval: retrievalReady,
      decision: decisionReady,
      limits: { dailyMessages: config.dailyMessages, perMinute: config.perMinute, maxInputChars: config.maxInputChars, files: UPLOAD_LIMITS.filesPerMessage },
    },
    { "Cache-Control": "no-store" },
  );
}
