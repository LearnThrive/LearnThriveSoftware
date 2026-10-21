import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/account/session";

/**
 * The Library's old sign-in address. There is one sign-in now (/login); this stays so links in old emails, bookmarks and the pages
 * that predate the change keep working. `next` is kept (and re-checked there).
 */
export default async function LegacySignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(typeof raw === "string" ? raw : undefined, "");
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
}
