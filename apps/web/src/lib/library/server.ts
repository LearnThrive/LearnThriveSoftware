import type { LibraryStore } from "@learnthrive/data/library";
import { accountRuntime } from "@/lib/account/runtime";
import { libraryShows } from "@/lib/library-config";

/**
 * The catalogue's store for a page, or null when the catalogue is not open: the phase is `info`, or no backend is
 * configured (production without the Supabase settings). A page that gets null shows the coming-soon content or a 404.
 */
export async function catalogueStore(): Promise<LibraryStore | null> {
  if (!libraryShows().catalogue) return null;
  return (await accountRuntime())?.store ?? null;
}
