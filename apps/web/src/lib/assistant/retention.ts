import type { LibraryStore, PurgeResult } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";

/**
 * The retention job (plan19 section 5.3): chat text goes 30 days after its last message, uploads after 7 days or when the chat is
 * deleted, and a chat a family deleted is hidden at once and removed here. Run it daily (scripts/assistant-retention.mjs, a
 * cron on Render; docs/ASSISTANT.md). Order matters: the files in storage are deleted FIRST, and the database rows only if every
 * file went. If storage fails, nothing is purged and the next run tries again, so a row is never forgotten while its file lingers.
 */
export interface RetentionReport {
  objectsRemoved: number;
  failed: number;
  purged: PurgeResult | null;
  /** Finished paper jobs removed once past their seven days (a job also goes with its chat). */
  paperJobs?: number;
}

export async function runRetention(deps: { store: LibraryStore; storage: LibraryStorage; now?: () => Date }): Promise<RetentionReport> {
  const now = (deps.now ?? (() => new Date()))();
  const paths = await deps.store.chat.dueStoragePaths(now);
  let removed = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      await deps.storage.remove(path);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  if (failed > 0) return { objectsRemoved: removed, failed, purged: null };
  const purged = await deps.store.chat.purgeDue(now);
  return { objectsRemoved: removed, failed: 0, purged, paperJobs: await deps.store.papers.purgeDue(now) };
}
