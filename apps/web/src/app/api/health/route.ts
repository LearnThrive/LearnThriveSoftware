/**
 * Uptime check for the host or a monitor (plan15 Wave 12 section 16.6). Answers "is the server up and
 * rendering", nothing more: no secrets, no configuration, no dependency calls, so it can be polled
 * freely and cannot leak anything. Never cached.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
