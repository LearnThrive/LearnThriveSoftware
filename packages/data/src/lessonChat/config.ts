/**
 * Lesson chat settings. Every number a policy could want to change is here, not in the checks (docs/LESSON_CHAT.md).
 *
 *   graceBeforeMinutes / graceAfterMinutes   how long before the scheduled start and after the scheduled end messages are still accepted.
 *                                            Default 0 and 0: exactly the scheduled time, in Europe/London (the schedule is stored as an instant,
 *                                            so daylight saving cannot move it). LESSON_CHAT_GRACE_BEFORE_MINUTES / LESSON_CHAT_GRACE_AFTER_MINUTES.
 *   maxFileBytes                             the upload cap. LESSON_CHAT_MAX_FILE_MB, default 10.
 *   signedUrlSeconds                         how long a file link works. 60.
 */
export interface LessonChatConfig {
  graceBeforeMinutes: number;
  graceAfterMinutes: number;
  maxTextLength: number;
  maxCaptionLength: number;
  maxFileBytes: number;
  signedUrlSeconds: number;
  /** Messages a person may send per minute (per lesson and sender). */
  messagesPerMinute: number;
}

export const DEFAULT_LESSON_CHAT_CONFIG: LessonChatConfig = {
  graceBeforeMinutes: 0,
  graceAfterMinutes: 0,
  maxTextLength: 2000,
  maxCaptionLength: 500,
  maxFileBytes: 10 * 1024 * 1024,
  signedUrlSeconds: 60,
  messagesPerMinute: 20,
};

type Env = Record<string, string | undefined>;

const MAX_GRACE_MINUTES = 60;

function whole(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** The settings from the environment. A wrong value is an error (so a typo cannot quietly widen the window); unset is the default. */
export function readLessonChatConfig(env: Env = process.env): LessonChatConfig {
  return {
    ...DEFAULT_LESSON_CHAT_CONFIG,
    graceBeforeMinutes: whole(env.LESSON_CHAT_GRACE_BEFORE_MINUTES, 0, 0, MAX_GRACE_MINUTES, "LESSON_CHAT_GRACE_BEFORE_MINUTES"),
    graceAfterMinutes: whole(env.LESSON_CHAT_GRACE_AFTER_MINUTES, 0, 0, MAX_GRACE_MINUTES, "LESSON_CHAT_GRACE_AFTER_MINUTES"),
    maxFileBytes: whole(env.LESSON_CHAT_MAX_FILE_MB, 10, 1, 25, "LESSON_CHAT_MAX_FILE_MB") * 1024 * 1024,
  };
}
