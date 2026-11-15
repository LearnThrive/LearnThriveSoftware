import { getSession } from "@/lib/auth/session";
import { accountRuntime } from "@/lib/account/runtime";
import { can } from "@/lib/auth/scope";
import { logOutcome } from "@/lib/log";
import { changeRolesFor } from "@/lib/roles/handlers";
import { jsonResponse, originAllowed, readBodyLimited } from "@/lib/request-guards";

/**
 * Roles (docs/ROLE_PERMISSIONS.md). Administrators only; everyone else is told no.
 *
 *   GET   the people and their roles, and the latest changes.
 *   POST  { profileId, roles: [...] }  sets that person's WHOLE set of roles. Only those two fields are read (lib/roles/handlers.ts).
 */
export const dynamic = "force-dynamic";

const MAX_BODY = 4096;

export async function GET() {
  const user = await getSession();
  if (!user) return jsonResponse(401, { ok: false, code: "signed_out", message: "Sign in first." });
  if (!can(user, "roles.assign")) return jsonResponse(403, { ok: false, code: "NOT_ADMIN", message: "Only an administrator can see roles." });
  const rt = await accountRuntime();
  if (!rt) return jsonResponse(503, { ok: false, code: "unavailable", message: "Accounts are not available on this server." });
  const [people, history] = await Promise.all([rt.store.accounts.listProfiles(), rt.store.accounts.roleHistory(undefined, 50)]);
  return jsonResponse(200, { ok: true, people, history });
}

export async function POST(request: Request) {
  if (!originAllowed(request)) return jsonResponse(403, { ok: false, code: "origin", message: "That request did not come from this site." });
  const user = await getSession();
  const rt = await accountRuntime();
  if (!rt) return jsonResponse(503, { ok: false, code: "unavailable", message: "Accounts are not available on this server." });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return jsonResponse(415, { ok: false, code: "bad_request", message: "Send JSON." });
  }
  const read = await readBodyLimited(request, MAX_BODY);
  if (!read.ok) return jsonResponse(read.reason === "too-large" ? 413 : 400, { ok: false, code: "bad_request", message: "That request could not be read." });
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(read.bytes));
  } catch {
    return jsonResponse(400, { ok: false, code: "bad_request", message: "That is not JSON." });
  }
  const result = await changeRolesFor(user, input, rt.store.accounts);
  // Counts and codes only: who and what is in the audit log, not in the application log.
  logOutcome("roles-change", result.status === 200 ? "changed" : result.body.ok === false ? result.body.code : "refused", {});
  return jsonResponse(result.status, result.body);
}
