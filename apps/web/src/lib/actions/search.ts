"use server";

import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { getSession } from "@/lib/auth/session";
import { searchApp, type AppSearchResult } from "@/lib/search/appSearch";

/**
 * The app palette's search (plan15 Wave 11 section 15.2). The user comes from the server-validated session
 * cookie, never from an argument; the only thing the browser sends is the query text. A missing or expired
 * session returns no results rather than redirecting (a palette that bounced you to /login mid-typing
 * would be worse than one that finds nothing), and everything else is decided by `searchApp`, which can
 * only search what the same page-level readers would show this person (see lib/search/appSearch.ts and
 * its tests/appSearch.test.mjs).
 */
export async function searchAppAction(query: string): Promise<AppSearchResult[]> {
  const user = await getSession();
  if (!user) return [];
  return searchApp(getDataProvider(), user, query);
}
