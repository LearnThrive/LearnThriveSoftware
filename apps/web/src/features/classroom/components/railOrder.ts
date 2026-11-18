import type { ReactElement } from 'react';

export interface RailEntry {
  key: string;
  /** Who sits where: students at the top, the tutor (or the host of a meeting) at the bottom. */
  role: 'tutor' | 'student' | null;
  tile: ReactElement;
}

/** Orders the cameras for the right-hand column: students first, the tutor last. Stable, so people keep their places within a group. */
export function orderRail<T extends { role: 'tutor' | 'student' | null }>(entries: readonly T[]): T[] {
  const rank = (entry: T) => (entry.role === 'tutor' ? 1 : 0);
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry);
}
