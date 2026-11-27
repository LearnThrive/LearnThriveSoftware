import type { LessonChatService, MessageView, Refusal } from "@learnthrive/data/lessonChat";
import { SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, verifyServiceRequest } from "@learnthrive/shared/classroomToken";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { jsonResponse, originAllowed, parseMultipart, readBodyLimited } from "@/lib/request-guards";
import { chatActorFor, userForAccount, type ChatLeads } from "./actor";
import type { ChatClosed, ChatOpen } from "./runtime";

/**
 * The lesson chat over HTTP (docs/LESSON_CHAT.md). Each function answers one route and does three things, in this order: says no if the chat is
 * closed or nobody is signed in, builds the person's actor on the server, and hands the request to the ONE service that checks the rules. Nothing
 * about who may send, when, or which lesson is decided here or taken from the request body.
 */
export interface ChatHttpDeps {
  chat: ChatOpen | ChatClosed;
  leads: ChatLeads;
  /** Told after a message or a file is sent from a lesson page, to let the others know (lib/lessonChat/announce.ts). */
  sent?: (lessonId: string, message: MessageView) => Promise<void>;
}

const JSON_LIMIT = 16 * 1024;
const MULTIPART_OVERHEAD = 64 * 1024;

const refusal = (r: Refusal): Response => jsonResponse(r.status, { ok: false, code: r.code, error: r.message });
const closed = (deps: ChatHttpDeps): Response | null => (deps.chat.open ? null : jsonResponse(503, { ok: false, code: "CHAT_CLOSED", error: deps.chat.reason }));
const signedOut = () => jsonResponse(401, { ok: false, code: "SIGNED_OUT", error: "Sign in to use the lesson chat." });

export async function listMessages(user: AuthenticatedUser | null, lessonId: string, deps: ChatHttpDeps): Promise<Response> {
  if (!user) return signedOut();
  const off = closed(deps);
  if (off) return off;
  const { service } = deps.chat as ChatOpen;
  const result = await service.list(chatActorFor(user, deps.leads), lessonId);
  return result.ok ? jsonResponse(200, result) : refusal(result);
}

/** The answer to a send. The message is already saved, so a failed announcement is logged and does not turn the send into an error. */
async function delivered(result: { ok: true; message: MessageView } | Refusal, lessonId: string, deps: ChatHttpDeps): Promise<Response> {
  if (!result.ok) return refusal(result);
  await deps.sent?.(lessonId, result.message).catch((error: unknown) => console.error("Lesson chat announcement failed", error instanceof Error ? error.name : "unknown"));
  return jsonResponse(201, result);
}

/** A text message (JSON `{ text }`) or a file (multipart `file` and optional `caption`). */
export async function sendMessage(user: AuthenticatedUser | null, lessonId: string, request: Request, deps: ChatHttpDeps): Promise<Response> {
  if (!originAllowed(request)) return jsonResponse(403, { ok: false, code: "ORIGIN", error: "That request did not come from this site." });
  if (!user) return signedOut();
  const off = closed(deps);
  if (off) return off;
  const { service, config } = deps.chat as ChatOpen;
  const actor = chatActorFor(user, deps.leads);

  // The send rules first, so an upload from someone who may not send is never even read.
  const may = await service.mayUpload(actor, lessonId);
  if (!may.ok) return refusal(may);

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("application/json")) {
    const read = await readBodyLimited(request, JSON_LIMIT);
    if (!read.ok) return jsonResponse(read.reason === "too-large" ? 413 : 400, { ok: false, code: "BAD_REQUEST", error: "That message could not be read." });
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(read.bytes));
    } catch {
      return jsonResponse(400, { ok: false, code: "BAD_REQUEST", error: "That is not JSON." });
    }
    // Only `text` is read. Who sent it, which lesson and when are never taken from the body.
    const text = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).text : undefined;
    return delivered(await service.sendText(actor, lessonId, text), lessonId, deps);
  }

  if (type.startsWith("multipart/form-data")) {
    const read = await readBodyLimited(request, config.maxFileBytes + MULTIPART_OVERHEAD);
    if (!read.ok) return jsonResponse(read.reason === "too-large" ? 413 : 400, { ok: false, code: read.reason === "too-large" ? "FILE_TOO_LARGE" : "BAD_REQUEST", error: read.reason === "too-large" ? "That file is too large." : "That upload could not be read." });
    const form = await parseMultipart(read.bytes, request.headers.get("content-type"));
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return jsonResponse(400, { ok: false, code: "BAD_REQUEST", error: "Choose a file to share." });
    const result = await service.sendFile(actor, lessonId, {
      name: file.name,
      declaredType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      caption: form.get("caption") ?? undefined,
    });
    return delivered(result, lessonId, deps);
  }
  return jsonResponse(415, { ok: false, code: "BAD_REQUEST", error: "Send JSON for a message or a form for a file." });
}

/** An administrator removes a message: `{ reason }`. */
export async function removeMessage(user: AuthenticatedUser | null, lessonId: string, messageId: string, request: Request, deps: ChatHttpDeps): Promise<Response> {
  if (!originAllowed(request)) return jsonResponse(403, { ok: false, code: "ORIGIN", error: "That request did not come from this site." });
  if (!user) return signedOut();
  const off = closed(deps);
  if (off) return off;
  const read = await readBodyLimited(request, JSON_LIMIT);
  let reason: unknown;
  if (read.ok) {
    try {
      const body = JSON.parse(new TextDecoder().decode(read.bytes)) as Record<string, unknown>;
      reason = body?.reason;
    } catch {
      reason = undefined;
    }
  }
  const result = await (deps.chat as ChatOpen).service.remove(chatActorFor(user, deps.leads), lessonId, messageId, reason);
  return result.ok ? jsonResponse(200, { ok: true }) : refusal(result);
}

/** Only these are drawn in the browser itself; everything else (SVG, Office files, archives, media) is a download. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Serves a file from a signed link. The lesson in the address must be the file's own; the person must be the one the link was made for. */
export async function openFile(user: AuthenticatedUser | null, lessonId: string, fileId: string, url: URL, deps: ChatHttpDeps): Promise<Response> {
  if (!user) return signedOut();
  const off = closed(deps);
  if (off) return off;
  const result = await (deps.chat as ChatOpen).service.openFile(chatActorFor(user, deps.leads), lessonId, fileId, {
    u: url.searchParams.get("u") ?? "",
    exp: url.searchParams.get("exp") ?? "",
    sig: url.searchParams.get("sig") ?? "",
  });
  if (!result.ok) return refusal(result);
  const dot = result.displayName.lastIndexOf(".");
  const ext = dot > 0 ? result.displayName.slice(dot + 1).replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "bin" : "bin";
  const inline = INLINE_TYPES.has(result.contentType);
  return new Response(result.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": INLINE_TYPES.has(result.contentType) ? result.contentType : result.contentType === "application/pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Length": String(result.bytes.length),
      // A file name for the browser's download box: cleaned at upload, and encoded here. The stored name is never used to find the file.
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="lesson-file.${ext}"; filename*=UTF-8''${encodeURIComponent(result.displayName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * A message the classroom server relays (Socket.IO). Signed by the classroom server with the shared secret; the person is named only by account id
 * and looked up here, so their roles and records are as they are now. The same service and the same rules as the HTTP send: a Socket.IO message gets
 * no other way in.
 */
export async function relayedSend(
  request: Request,
  deps: ChatHttpDeps,
  resolveUser: (accountId: string) => Promise<AuthenticatedUser | null> = userForAccount,
  now: number = Date.now(),
): Promise<Response> {
  const off = closed(deps);
  if (off) return off;
  const read = await readBodyLimited(request, JSON_LIMIT);
  if (!read.ok) return jsonResponse(400, { ok: false, code: "BAD_REQUEST", error: "That request could not be read." });
  const raw = new TextDecoder().decode(read.bytes);
  if (!verifyServiceRequest(raw, request.headers.get(SERVICE_TIMESTAMP_HEADER), request.headers.get(SERVICE_SIGNATURE_HEADER), now)) {
    return jsonResponse(401, { ok: false, code: "BAD_SIGNATURE", error: "Not authorised." });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { ok: false, code: "BAD_REQUEST", error: "That is not JSON." });
  }
  if (typeof body?.lessonId !== "string" || typeof body.userId !== "string" || typeof body.text !== "string") {
    return jsonResponse(400, { ok: false, code: "BAD_REQUEST", error: "lessonId, userId and text are required." });
  }
  const user = await resolveUser(body.userId);
  if (!user) return jsonResponse(403, { ok: false, code: "NOT_PARTICIPANT", error: "You are not part of this lesson, so you cannot message in it." });
  const result = await (deps.chat as ChatOpen).service.sendText(chatActorFor(user, deps.leads), body.lessonId, body.text);
  if (!result.ok) return refusal(result);
  const { id, senderName, senderParty, text, createdAt } = result.message;
  // An administrator's message is labelled as one in the classroom too, so the tutor and the students always know who is speaking.
  return jsonResponse(200, { ok: true, message: { id, name: senderParty === "admin" ? `${senderName} (administrator)` : senderName, text, createdAt } });
}

export type { LessonChatService };
