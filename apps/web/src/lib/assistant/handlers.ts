import { createHash, randomUUID } from "node:crypto";
import { renewSession, type CookieJar } from "@/lib/account/session";
import type { AccountRuntime } from "@/lib/account/runtime";
import type { Account } from "@learnthrive/data/library";
import { jsonResponse, logOutcome, originAllowed, parseMultipart, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import { assistantAvailability, assistantConfig } from "./config";
import { ADULT_ACKNOWLEDGEMENT, ADULT_ACK_VERSION } from "./prompt";
import type { AssistantRuntime } from "./runtime";
import { sendMessage, type ChatEvent } from "./service";
import { UPLOAD_LIMITS, inspectChatUpload } from "./uploads";

/**
 * The Study Buddy routes' logic (plan19 phase F). Every one starts the same way: Origin check, the assistant open at all (the kill
 * switch, production approval, a provider), a signed-in ADULT account, and a family that holds Library access (enrolled, a
 * subscription or an administrator grant: not free-samples-only). A chat is only ever found by the family that owns it.
 *
 *   POST   /api/assistant/chat              a question; the answer streams back as newline-delimited JSON events
 *   POST   /api/assistant/files             one photo or PDF for the next question
 *   GET    /api/assistant/sessions          the family's chats
 *   GET    /api/assistant/sessions/<id>     one chat's messages
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
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

type Reason = "unavailable" | "signed_out" | "adult_required" | "no_access" | "adult_confirmation" | "bad_request" | "too_large" | "not_found" | "too_many_files" | "rate_limited";

const STATUS: Record<Reason, number> = { unavailable: 503, signed_out: 401, adult_required: 403, no_access: 403, adult_confirmation: 422, bad_request: 400, too_large: 413, not_found: 404, too_many_files: 422, rate_limited: 429 };

const MESSAGE: Record<Reason, string> = {
  unavailable: `Study Buddy is not available right now. Please email ${siteConfig.email} if you need help.`,
  signed_out: "Please sign in to use Study Buddy.",
  adult_required: "Study Buddy is for adult account holders.",
  no_access: "Study Buddy is included for enrolled students and Library subscribers.",
  adult_confirmation: "Please confirm that you are 18 or over and that you are the person using Study Buddy.",
  bad_request: "We could not read that request.",
  too_large: "That is too large.",
  not_found: "We could not find that.",
  too_many_files: `You can attach at most ${UPLOAD_LIMITS.filesPerMessage} files to a question.`,
  rate_limited: "Too many uploads. Please wait a little.",
};

const refuse = (reason: Reason, extra: Record<string, string> = {}) => jsonResponse(STATUS[reason], { code: reason, error: MESSAGE[reason] }, { "Cache-Control": "no-store", ...extra });

type Gate = { ok: true; rt: AccountRuntime; assistant: AssistantRuntime; account: Account & { clientId: string }; email: string } | { ok: false; response: Response };

async function gate(request: Request, deps: AssistantDeps, event: string, { mutating = true }: { mutating?: boolean } = {}): Promise<Gate> {
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
  const account = await deps.rt.store.accounts.getAccount(session.user.id);
  if (!account) return { ok: false, response: refuse("signed_out") };
  if (!account.adultConfirmed) return { ok: false, response: refuse("adult_required") };
  const clientId = account.clientId ?? (await deps.rt.store.accounts.ensureClient(account.profileId));
  const facts = await deps.rt.store.access.facts(clientId, (deps.now ?? (() => new Date()))());
  if (account.role !== "ADMIN" && !facts.enrolled && !facts.subscription && !facts.adminGrant) {
    logOutcome(event, "no_access");
    return { ok: false, response: refuse("no_access") };
  }
  return { ok: true, rt: deps.rt, assistant: deps.assistant, account: { ...account, clientId }, email: session.user.email };
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
  const minors = g.assistant.config.minorsApproved;
  const adultAck = raw.adultAck === true;
  if (!sessionId && !minors) {
    if (!adultAck) return refuse("adult_confirmation");
    await g.rt.store.billing.recordConsent({ profileId: g.account.profileId, kind: "assistant_adult_use", version: ADULT_ACK_VERSION, textSha256: createHash("sha256").update(`${ADULT_ACK_VERSION}
${ADULT_ACKNOWLEDGEMENT}`).digest("hex"), at: (deps.now ?? (() => new Date()))() });
  }
  const studentId = minors && typeof raw.studentId === "string" && UUID.test(raw.studentId) ? raw.studentId : null;

  const events = sendMessage(
    { store: g.rt.store, provider: g.assistant.provider, queue: g.assistant.queue, uploads: g.assistant.uploads, config: g.assistant.config, flag: g.assistant.flag, hosted: g.assistant.hosted, now: deps.now, log: (outcome, details) => logOutcome("assistant-chat", outcome, details) },
    { clientId: g.account.clientId, sessionId, text, fileIds, signal: request.signal, studentId },
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
  if ((await g.rt.store.chat.usageCount(g.account.clientId, "assistant_upload_hour", hour)) >= UPLOADS_PER_HOUR) return refuse("rate_limited", { "Retry-After": "600" });
  const body = await readBodyLimited(request, UPLOAD_LIMITS.pdfBytes + 64 * 1024);
  if (!body.ok) return refuse("too_large");
  const form = await parseMultipart(body.bytes, request.headers.get("content-type"));
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return refuse("bad_request");
  const asked = form.get("sessionId");
  let sessionId = typeof asked === "string" && asked ? asked : null;
  if (sessionId && !UUID.test(sessionId)) return refuse("bad_request");
  if (sessionId) {
    if (!(await g.rt.store.chat.getSession(g.account.clientId, sessionId))) return refuse("not_found");
    if ((await g.rt.store.chat.listFiles(g.account.clientId, sessionId)).filter((f) => f.messageId === null).length >= UPLOAD_LIMITS.filesPerMessage) return refuse("too_many_files");
  }

  const result = await inspectChatUpload(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) {
    logOutcome("assistant-upload", "refused", { code: result.problem.code });
    return jsonResponse(422, { code: "refused", error: result.problem.message }, { "Cache-Control": "no-store" });
  }
  if (!sessionId) sessionId = (await g.rt.store.chat.createSession(g.account.clientId, { title: "New chat" }, now)).id;
  const path = `${sessionId}/${randomUUID()}.${result.contentType === "application/pdf" ? "pdf" : result.contentType === "image/png" ? "png" : "jpg"}`;
  await g.assistant.uploads.put(path, result.bytes, result.contentType);
  const record = await g.rt.store.chat.addFile(g.account.clientId, sessionId, { storagePath: path, bytes: result.bytes.length, contentType: result.contentType }, now);
  await g.rt.store.chat.incrementUsage(g.account.clientId, "assistant_upload_hour", hour, 1);
  logOutcome("assistant-upload", "stored", { kind: result.kind });
  return jsonResponse(200, { fileId: record.id, sessionId, name: result.name, kind: result.kind, contentType: result.contentType, pages: "pages" in result ? result.pages : null }, { "Cache-Control": "no-store" });
}

export async function handleSessions(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-sessions", { mutating: false });
  if (!g.ok) return g.response;
  const sessions = await g.rt.store.chat.listSessions(g.account.clientId);
  return jsonResponse(200, { sessions: sessions.map((s) => ({ id: s.id, title: s.title, lastActivityAt: s.lastActivityAt.toISOString() })) }, { "Cache-Control": "no-store" });
}

export async function handleSession(request: Request, deps: AssistantDeps, sessionId: string): Promise<Response> {
  const method = request.method;
  const g = await gate(request, deps, "assistant-session", { mutating: method !== "GET" });
  if (!g.ok) return g.response;
  if (!UUID.test(sessionId)) return refuse("not_found");
  if (method === "DELETE") {
    const ok = await g.rt.store.chat.requestDeletion(g.account.clientId, sessionId, (deps.now ?? (() => new Date()))());
    logOutcome("assistant-session", ok ? "deleted" : "not_found");
    return ok ? jsonResponse(200, { success: true }, { "Cache-Control": "no-store" }) : refuse("not_found");
  }
  const session = await g.rt.store.chat.getSession(g.account.clientId, sessionId);
  if (!session) return refuse("not_found");
  const messages = await g.rt.store.chat.listMessages(g.account.clientId, sessionId);
  return jsonResponse(200, { id: session.id, title: session.title, messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })) }, { "Cache-Control": "no-store" });
}

export async function handleDeleteAll(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-delete-all");
  if (!g.ok) return g.response;
  const count = await g.rt.store.chat.requestDeletionAll(g.account.clientId, (deps.now ?? (() => new Date()))());
  logOutcome("assistant-delete-all", "deleted", { chats: count });
  return jsonResponse(200, { success: true, deleted: count }, { "Cache-Control": "no-store" });
}

export async function handleExport(request: Request, deps: AssistantDeps): Promise<Response> {
  const g = await gate(request, deps, "assistant-export", { mutating: false });
  if (!g.ok) return g.response;
  const data = await g.rt.store.chat.exportAll(g.account.clientId, (deps.now ?? (() => new Date()))());
  logOutcome("assistant-export", "sent", { chats: data.sessions.length });
  return new Response(JSON.stringify(data, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="study-buddy-export.json"', "Cache-Control": "no-store" } });
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
  return jsonResponse(200, { open: health.ok, reason: health.ok ? null : health.detail, minorsApproved: config.minorsApproved, limits: { dailyMessages: config.dailyMessages, perMinute: config.perMinute, maxInputChars: config.maxInputChars, files: UPLOAD_LIMITS.filesPerMessage } }, { "Cache-Control": "no-store" });
}
