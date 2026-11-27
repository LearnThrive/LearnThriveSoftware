/**
 * Lesson chat settings. Every number a policy could want to change is here, not in the checks (docs/LESSON_CHAT.md).
 *
 *   maxFileBytes                             the upload cap. LESSON_CHAT_MAX_FILE_MB, default 10.
 *   signedUrlSeconds                         how long a file link works. 60.
 */
export interface LessonChatConfig {
  maxTextLength: number;
  maxCaptionLength: number;
  maxFileBytes: number;
  signedUrlSeconds: number;
  /** Messages a person may send per minute (per lesson and sender). */
  messagesPerMinute: number;
}

export const DEFAULT_LESSON_CHAT_CONFIG: LessonChatConfig = {
  maxTextLength: 2000,
  maxCaptionLength: 500,
  maxFileBytes: 10 * 1024 * 1024,
  signedUrlSeconds: 60,
  messagesPerMinute: 20,
};

type Env = Record<string, string | undefined>;

function whole(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** The settings from the environment. A wrong value is an error (so a typo cannot quietly change a limit); unset is the default. */
export function readLessonChatConfig(env: Env = process.env): LessonChatConfig {
  return {
    ...DEFAULT_LESSON_CHAT_CONFIG,
    maxFileBytes: whole(env.LESSON_CHAT_MAX_FILE_MB, 10, 1, 25, "LESSON_CHAT_MAX_FILE_MB") * 1024 * 1024,
  };
}
