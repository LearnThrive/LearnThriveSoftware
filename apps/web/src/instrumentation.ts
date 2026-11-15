import type { Instrumentation } from "next";
import { requestErrorLine } from "@/lib/observability";

/**
 * Runs once when the server starts. The bank transfer details are checked here (lib/bank/config.ts): partly set or malformed, or missing in
 * production with the signed-in app open, and the server REFUSES TO START with a message naming each variable at fault and never a value.
 * Skipped while building (the build has no host environment) and on the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertBankConfig } = await import("@/lib/bank/config");
  assertBankConfig();
}

/**
 * Next calls this for every error a page, route handler, server action or the proxy throws on the server (launch checklist 3.8,
 * docs/OBSERVABILITY.md). It writes one `server-error` line with the route's file pattern, the error's kind and the digest the error page
 * shows, and never the message, the URL or a header: those can hold a child's name, an id or a token. There is no third-party error
 * reporter (decided, checklist 0.6), so this line in the host's log is the record.
 *
 * A page cut short because the browser went away (someone clicked on before it finished streaming) is not a server failure: it becomes a
 * `request-aborted` line on stdout instead, so it never sets off the server-error alert (requestErrorLine, clientWentAway).
 *
 * Written directly rather than through logOutcome, whose filter would drop a route pattern's slashes: requestErrorFields has already
 * reduced every field to a safe shape.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const { stream, line } = requestErrorLine(error, request, context);
  if (stream === "stdout") console.log(line);
  else console.error(line);
};
