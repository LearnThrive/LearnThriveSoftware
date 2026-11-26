import { isInlineImage } from '@learnthrive/shared/chatFiles';
import type { DisplayChatMessage } from './meeting';

/** A saved lesson chat message as the website lists it (GET /api/lessons/<id>/messages). */
export interface SavedLessonMessage {
  id: string;
  senderParty: string;
  senderName: string;
  /** Whether the person asking wrote it, decided by the website from their account. */
  own: boolean;
  text: string;
  createdAt: string;
  removed: unknown;
  file: { displayName: string; size: number; contentType: string; url: string } | null;
}

/**
 * The saved chat as the classroom shows it. A saved message has no live connection id, but the chat panel puts consecutive messages with the same
 * sender under one name, so each person needs their own: without one, everyone's messages read as the first writer's.
 */
export function savedChatMessages(saved: readonly SavedLessonMessage[]): DisplayChatMessage[] {
  return saved.filter((m) => !m.removed).map((m) => ({
    id: m.id,
    senderId: m.own ? 'saved:you' : `saved:${m.senderParty}:${m.senderName}`,
    // An administrator's message says it is one, as it does when it arrives live.
    name: m.senderParty === 'admin' ? `${m.senderName} (administrator)` : m.senderName,
    text: m.text,
    timestamp: Date.parse(m.createdAt) || Date.now(),
    own: m.own,
    ...(m.file ? { attachment: { name: m.file.displayName, size: m.file.size, image: isInlineImage(m.file.displayName), url: m.file.url } } : {}),
  }));
}
