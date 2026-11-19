import { randomBytes } from "node:crypto";
import {
  allowAllScanner, createLessonChatService, createSqlFileStore, createSqlLessonChatRepository, InMemoryFileStore, InMemoryLessonChatRepository, readLessonChatConfig,
  type LessonChatConfig, type LessonChatService,
} from "@learnthrive/data/lessonChat";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";
import { getDataProvider } from "@/lib/data/provider";

/**
 * The lesson chat's one service for this server process (docs/LESSON_CHAT.md).
 *
 *   supabase  messages and files kept in Postgres (migrations 0027 and 0029), on the accounts' connection: they survive a restart, and a lesson's
 *             chat carries over to every later lesson of the same assignment. Open by default; LESSON_CHAT_ENABLED=false closes it.
 *   memory    development and tests: in memory, lost on restart. Always open.
 *   off       production without the database: closed.
 *
 * File links are signed with LESSON_FILE_URL_SECRET (32+ characters). In development there is a fallback so a local run works. In production without
 * the secret, text chat still opens but every upload is refused: nothing is ever signed with a key that is public in the source.
 */
type Env = Record<string, string | undefined>;

const DEV_SECRET = "learnthrive-dev-only-lesson-file-url-secret-not-for-production";

export type ChatClosed = { open: false; reason: string };
export type ChatOpen = { open: true; service: LessonChatService; config: LessonChatConfig };

/** Whether the chat is open here, and why not. Pure: pass any environment. */
export function chatAvailability(env: Env = process.env): { open: true } | ChatClosed {
  if (env.NODE_ENV !== "production") return { open: true };
  if (env.LESSON_CHAT_ENABLED === "false") return { open: false, reason: "Lesson chat is switched off." };
  if (accountBackend(env) !== "supabase") return { open: false, reason: "Lesson chat is not set up on this server." };
  return { open: true };
}

/** The signing key for file links: the configured secret, or in development the fallback. In production without a real secret there is no key (null). */
function urlSecretFor(env: Env): string | null {
  const configured = env.LESSON_FILE_URL_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  return env.NODE_ENV === "production" ? null : DEV_SECRET;
}

type ChatState = { service: LessonChatService; config: LessonChatConfig };
const globalForChat = globalThis as unknown as { __learnthriveLessonChat?: ChatState };

/** The service, or why the chat is closed. A bad grace setting is an error, not a silent default. */
export function lessonChat(env: Env = process.env): ChatOpen | ChatClosed {
  const availability = chatAvailability(env);
  if (!availability.open) return availability;
  if (!globalForChat.__learnthriveLessonChat) {
    const config = readLessonChatConfig(env);
    const data = getDataProvider();
    const sql = accountBackend(env) === "supabase";
    const db = {
      query: async <T,>(text: string, params?: unknown[]) => {
        const rt = await accountRuntime(env);
        if (!rt?.db) throw new Error("The database connection is not available.");
        return rt.db.query<T>(text, params);
      },
    };
    // Without a signing key (production, no secret) every upload is refused, but messages work: the service is given an unusable key and the
    // file store refuses to be written to.
    const secret = urlSecretFor(env);
    const service = createLessonChatService({
      lessons: {
        get: async (id) => {
          const lesson = await data.lessons.get(id);
          // The conversation is the assignment: every occurrence of a weekly lesson shares one chat and its files.
          return lesson ? { ...lesson, threadId: lesson.assignmentId } : null;
        },
      },
      repo: sql ? createSqlLessonChatRepository(db) : new InMemoryLessonChatRepository(),
      files: secret ? (sql ? createSqlFileStore(db) : new InMemoryFileStore()) : new InMemoryFileStore(),
      // TODO(malware-scan): the scanner hook. Replace `allowAllScanner` with a real scanner here (FileScanner in @learnthrive/data/lessonChat).
      scanner: secret ? allowAllScanner : { scan: async () => ({ status: "error", detail: "no signing key" }) },
      config,
      urlSecret: secret ?? randomBytes(32).toString("hex"),
    });
    globalForChat.__learnthriveLessonChat = { service, config };
  }
  const { service, config } = globalForChat.__learnthriveLessonChat;
  return { open: true, service, config };
}

/** Tests: forget the singleton (the data provider may have been reset). */
export function resetLessonChat(): void {
  delete globalForChat.__learnthriveLessonChat;
}
