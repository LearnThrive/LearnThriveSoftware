/**
 * The classroom server's structured log line: the same shape and rules as apps/web/src/lib/log.ts (launch checklist 3.8,
 * docs/OBSERVABILITY.md), kept as a twin because the web app's test loader cannot reach this package. One JSON object per line with an
 * `event` and an `outcome`; routine outcomes to stdout, the rest to stderr; only numbers, booleans and short codes survive, so no name,
 * room id, SDP, token or secret can reach the log.
 */
export type LogValue = string | number | boolean;

const ROUTINE = new Set(['ok', 'sent', 'received', 'dropped', 'duplicate', 'stored', 'served', 'started', 'stopping', 'heartbeat']);
const SAFE_TEXT = /^[a-z0-9_.:-]{1,40}$/i;

export function logOutcome(event: string, outcome: string, details: Record<string, LogValue> = {}): void {
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
    else if (typeof value === 'string' && SAFE_TEXT.test(value)) safe[key] = value;
  }
  const line = JSON.stringify({ event, outcome, ...safe });
  if (ROUTINE.has(outcome)) console.info(line);
  else console.warn(line);
}
