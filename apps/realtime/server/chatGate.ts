import { SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, signServiceRequest } from '@learnthrive/shared/classroomToken';

/**
 * The lesson chat's gate (docs/LESSON_CHAT.md). This server has no database and no idea who a person is, which lesson is on, or what the time
 * window is. So every chat message goes to apps/web, which decides everything, stores the message and answers. Nothing is relayed to the room until
 * apps/web has said yes.
 *
 * The request is signed with the secret the two apps share (CLASSROOM_JOIN_SECRET), over the exact body and a timestamp. It carries the lesson and
 * the account id that the verified join token named, plus the text: never a role, a time or a name from the browser.
 */
export interface ChatGateRequest {
  lessonId: string;
  userId: string;
  text: string;
}

export type ChatGateResult =
  | { ok: true; message: { id: string; name: string; text: string; createdAt: string } }
  | { ok: false; message: string };

export interface ChatGate {
  send(request: ChatGateRequest): Promise<ChatGateResult>;
}

const TIMEOUT_MS = 5000;
const UNAVAILABLE = 'The lesson chat is not available right now. Please try again.';

/** The gate from the environment: CLASSROOM_WEB_URL (the web app's address). null when it is not set. */
export function chatGateFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): ChatGate | null {
  const base = env.CLASSROOM_WEB_URL?.trim();
  if (!base) return null;
  let url: URL;
  try {
    url = new URL('/api/internal/lesson-chat', base);
  } catch {
    throw new Error('CLASSROOM_WEB_URL must be the web app\'s address, like https://www.example.com');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('CLASSROOM_WEB_URL must be https (http is allowed only for localhost).');
  }
  return {
    async send(request) {
      try {
        const body = JSON.stringify({ lessonId: request.lessonId, userId: request.userId, text: request.text });
        const timestamp = Date.now();
        const response = await fetchImpl(url.toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json', [SERVICE_TIMESTAMP_HEADER]: String(timestamp), [SERVICE_SIGNATURE_HEADER]: signServiceRequest(body, timestamp) },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const json = (await response.json().catch(() => null)) as { ok?: boolean; message?: { id?: unknown; name?: unknown; text?: unknown; createdAt?: unknown }; error?: unknown } | null;
        const m = json?.message;
        if (response.ok && json?.ok === true && m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.text === 'string' && typeof m.createdAt === 'string') {
          return { ok: true, message: { id: m.id, name: m.name, text: m.text, createdAt: m.createdAt } };
        }
        // The web app's own words for a refusal (too early, not in this lesson, ...). A server failure says nothing of the sort.
        return { ok: false, message: response.status < 500 && typeof json?.error === 'string' ? json.error : UNAVAILABLE };
      } catch {
        return { ok: false, message: UNAVAILABLE };
      }
    },
  };
}
