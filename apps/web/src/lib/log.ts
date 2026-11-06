/**
 * The site's one structured log line (launch checklist 3.8, docs/OBSERVABILITY.md). Every line is a JSON object with an `event` and an
 * `outcome`, written to stdout when things went as intended and to stderr otherwise, so the host's log search and alerts can filter on
 * either. It carries NO personal data: only short machine-readable values (counts, sizes, reason codes). Anything else is dropped here, so
 * a careless caller cannot put a name, an address, a username or an answer in the logs.
 *
 * No imports on purpose: instrumentation.ts loads this, and that file is compiled for every runtime.
 */
export type LogValue = string | number | boolean;

/** Outcomes that mean "working as intended": stdout. Everything else (refused, failed, rate limited, unavailable) goes to stderr. */
const ROUTINE = new Set(["ok", "sent", "received", "dropped", "duplicate", "stored", "served", "started", "stopping", "heartbeat"]);

const SAFE_TEXT = /^[a-z0-9_.:-]{1,40}$/i;

export function logOutcome(event: string, outcome: string, details: Record<string, LogValue> = {}): void {
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) safe[key] = value;
    else if (typeof value === "string" && SAFE_TEXT.test(value)) safe[key] = value;
  }
  const line = JSON.stringify({ event, outcome, ...safe });
  if (ROUTINE.has(outcome)) console.info(line);
  else console.warn(line);
}
