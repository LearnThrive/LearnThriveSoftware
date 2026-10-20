import { accountRuntime } from "@/lib/account/runtime";
import { jsonResponse } from "@/lib/request-guards";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT AND TESTS ONLY: the emails the in-memory account backend would have sent, newest last, so the e2e
 * tests can follow a verification link. A 404 in production twice over: the proxy refuses /api/dev/**, and this
 * route refuses to run with NODE_ENV=production or on any backend but the in-memory one.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return jsonResponse(404, { error: "Not found." });
  const rt = await accountRuntime();
  if (!rt?.outbox) return jsonResponse(404, { error: "Not found." });
  const to = new URL(request.url).searchParams.get("to")?.trim().toLowerCase();
  const messages = rt.outbox.filter((m) => !to || m.to === to);
  return jsonResponse(200, { messages }, { "Cache-Control": "no-store" });
}
