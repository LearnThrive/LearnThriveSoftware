import type { Instrumentation } from "next";
import { requestErrorFields } from "@/lib/observability";

/**
 * Next calls this for every error a page, route handler, server action or the proxy throws on the server (launch checklist 3.8,
 * docs/OBSERVABILITY.md). It writes one `server-error` line with the route's file pattern, the error's kind and the digest the error page
 * shows, and never the message, the URL or a header: those can hold a child's name, an id or a token. There is no third-party error
 * reporter (decided, checklist 0.6), so this line in the host's log is the record.
 *
 * Written directly rather than through logOutcome, whose filter would drop a route pattern's slashes: requestErrorFields has already
 * reduced every field to a safe shape.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(JSON.stringify({ event: "server-error", outcome: "error", ...requestErrorFields(error, request, context) }));
};
