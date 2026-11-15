import {
  allowAllScanner, createLessonChatService, InMemoryFileStore, InMemoryLessonChatRepository, readLessonChatConfig, type LessonChatConfig, type LessonChatService,
} from "@learnthrive/data/lessonChat";
import { getDataProvider } from "@/lib/data/provider";

/**
 * The lesson chat's one service for this server process (docs/LESSON_CHAT.md). The in-memory repository and file store come first: what is said is
 * lost when the server restarts. The Postgres tables and row-level security are written (supabase/migrations/0027_lesson_chat.sql) but not applied,
 * and the SQL repository and the private storage bucket are not built, so in production the chat stays CLOSED until the owner opens it with
 * LESSON_CHAT_ENABLED=true (a held switch, like the other launch switches). Development and tests are always open.
 *
 * File links are signed with LESSON_FILE_URL_SECRET. There is a development fallback so a local run works; in production a missing secret closes
 * the chat rather than signing with a key that is public in the source.
 */
type Env = Record<string, string | undefined>;

const DEV_SECRET = "learnthrive-dev-only-lesson-file-url-secret-not-for-production";

export type ChatClosed = { open: false; reason: string };
export type ChatOpen = { open: true; service: LessonChatService; config: LessonChatConfig };

/** Whether the chat is open here, and why not. Pure: pass any environment. */
export function chatAvailability(env: Env = process.env): { open: true } | ChatClosed {
  if (env.NODE_ENV !== "production") return { open: true };
  if (env.LESSON_CHAT_ENABLED !== "true") return { open: false, reason: "Lesson chat is not open yet." };
  if (!env.LESSON_FILE_URL_SECRET || env.LESSON_FILE_URL_SECRET.length < 32) return { open: false, reason: "Lesson chat is not set up on this server." };
  return { open: true };
}

const globalForChat = globalThis as unknown as { __learnthriveLessonChat?: { repo: InMemoryLessonChatRepository; files: InMemoryFileStore; service: LessonChatService; config: LessonChatConfig } };

/** The service, or why the chat is closed. A bad grace setting is an error, not a silent default. */
export function lessonChat(env: Env = process.env): ChatOpen | ChatClosed {
  const availability = chatAvailability(env);
  if (!availability.open) return availability;
  if (!globalForChat.__learnthriveLessonChat) {
    const config = readLessonChatConfig(env);
    const repo = new InMemoryLessonChatRepository();
    const files = new InMemoryFileStore();
    const data = getDataProvider();
    const service = createLessonChatService({
      lessons: { get: async (id) => (await data.lessons.get(id)) ?? null },
      repo,
      files,
      // TODO(malware-scan): the scanner hook. Replace `allowAllScanner` with a real scanner here (FileScanner in @learnthrive/data/lessonChat).
      scanner: allowAllScanner,
      config,
      urlSecret: env.LESSON_FILE_URL_SECRET || DEV_SECRET,
    });
    globalForChat.__learnthriveLessonChat = { repo, files, service, config };
  }
  const { service, config } = globalForChat.__learnthriveLessonChat;
  return { open: true, service, config };
}

/** Tests: forget the singleton (the data provider may have been reset). */
export function resetLessonChat(): void {
  delete globalForChat.__learnthriveLessonChat;
}
