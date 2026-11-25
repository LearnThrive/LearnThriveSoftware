import type { ReactElement } from 'react';
import type { ParticipantRole } from '@learnthrive/shared/protocol';

export interface RailEntry {
  key: string;
  /** Who sits where: students at the top, the tutor (or the host of a meeting) below them, an administrator supervising at the very bottom. */
  role: ParticipantRole | null;
  tile: ReactElement;
}

/** Orders the cameras for the right-hand column: students first, the tutor last. Stable, so people keep their places within a group. */
export function orderRail<T extends { role: ParticipantRole | null }>(entries: readonly T[]): T[] {
  const rank = (entry: T) => (entry.role === 'supervisor' ? 2 : entry.role === 'tutor' ? 1 : 0);
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry);
}
