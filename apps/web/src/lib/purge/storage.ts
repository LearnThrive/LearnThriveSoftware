import { supabaseKeyHeaders } from "@/lib/supabaseKeys";

/**
 * Stored files for a purge, deleted BEFORE any row (the same order, and the same reason, as the retention job in
 * lib/assistant/retention.ts): deleting a chat row does not delete the private object, so a row removed while its file lingers would make the
 * file unfindable. Following that rule here means a purge that cannot remove a file changes nothing at all.
 *
 * Server only. The secret key never reaches a browser or a log, and nothing from a response is logged.
 */
export async function deleteStoredObjects(paths: string[], env: Record<string, string | undefined> = process.env): Promise<{ removed: number; failed: number }> {
  if (paths.length === 0) return { removed: 0, failed: 0 };
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("The stored files must be removed before a purge, and this server has no storage key to remove them with.");
  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/+$/, "")}/storage/v1/object/chat-uploads`, {
      method: "DELETE",
      headers: { ...supabaseKeyHeaders(key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [...new Set(paths)] }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    return { removed: 0, failed: paths.length };
  }
  // A 404 means the object is already gone, which is what a purge wants.
  if (response.ok || response.status === 404) return { removed: paths.length, failed: 0 };
  return { removed: 0, failed: paths.length };
}
