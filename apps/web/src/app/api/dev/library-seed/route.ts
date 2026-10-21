import { accountRuntime } from "@/lib/account/runtime";
import { TEST_ACCOUNT, seedBulk, seedCatalogue } from "@/lib/library/devSeed";
import { libraryStorage } from "@/lib/library/storage";
import { jsonResponse } from "@/lib/request-guards";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT AND TESTS ONLY: seeds the in-memory Library so a browser test can start from a known state.
 *
 *   { "action": "catalogue" }                        a synthetic catalogue with PDFs (idempotent)
 *   { "action": "bulk", "count": 30 }                more published resources, without files, to test paging
 *   { "action": "enrol" | "subscribe" | "grant", "email": "..." }   gives that account access of that kind
 *   { "action": "tester" }                           a confirmed, adult, enrolled test account (credentials in the response) and the catalogue
 *
 * `GET /api/dev/library-seed?action=tester` does the same from a browser address bar.
 *
 * A 404 in production twice over: the proxy refuses /api/dev/**, and this route refuses to run with NODE_ENV=production
 * or on any backend but the in-memory one.
 */
async function tester(rt: NonNullable<Awaited<ReturnType<typeof accountRuntime>>>, storage: NonNullable<ReturnType<typeof libraryStorage>>) {
  const auth = rt.auth as { userIdFor?: (email: string) => string | null };
  if (!auth.userIdFor?.(TEST_ACCOUNT.email)) {
    await rt.auth.signUp({ email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password, displayName: TEST_ACCOUNT.name, adultConfirmed: true });
    const mail = rt.outbox?.findLast((m) => m.to === TEST_ACCOUNT.email);
    if (mail) await rt.auth.verifyEmailLink(mail.tokenHash, "signup");
    const userId = auth.userIdFor?.(TEST_ACCOUNT.email);
    if (userId && rt.memory) rt.memory.seedAssignment(rt.memory.seedStudent(userId), "ACTIVE");
  }
  if (rt.memory) await seedCatalogue(rt.memory, storage);
  return jsonResponse(200, { signInAt: "/account/sign-in", email: TEST_ACCOUNT.email, password: TEST_ACCOUNT.password, access: "enrolled", note: "Development only; gone when the dev server restarts." });
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return jsonResponse(404, { error: "Not found." });
  const rt = await accountRuntime();
  const storage = libraryStorage();
  if (!rt?.memory || !storage) return jsonResponse(404, { error: "Not found." });
  if (new URL(request.url).searchParams.get("action") === "tester") return tester(rt, storage);
  return jsonResponse(400, { error: "Unknown action." });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return jsonResponse(404, { error: "Not found." });
  const rt = await accountRuntime();
  const storage = libraryStorage();
  if (!rt?.memory || !storage) return jsonResponse(404, { error: "Not found." });
  const body = (await request.json().catch(() => null)) as { action?: string; email?: string } | null;

  if (body?.action === "tester") return tester(rt, storage);
  if (body?.action === "catalogue") return jsonResponse(200, { resources: await seedCatalogue(rt.memory, storage) });
  if (body?.action === "bulk") return jsonResponse(200, { resources: await seedBulk(rt.memory, Number((body as { count?: number }).count ?? 30)) });

  if (body?.action === "enrol" || body?.action === "subscribe" || body?.action === "grant") {
    const auth = rt.auth as { userIdFor?: (email: string) => string | null };
    const userId = auth.userIdFor?.(String(body.email ?? "").trim().toLowerCase());
    if (!userId) return jsonResponse(404, { error: "No such account." });
    const now = Date.now();
    if (body.action === "enrol") rt.memory.seedAssignment(rt.memory.seedStudent(userId), "ACTIVE");
    else rt.memory.seedEntitlement(userId, body.action === "subscribe" ? "subscription" : "admin_grant", new Date(now - 60_000), null);
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(400, { error: "Unknown action." });
}
