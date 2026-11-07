/**
 * LearnThrive creates every account (launch checklist 0.2): in production nobody signs up, and no learner is invited by a guardian. The
 * self-service flows stay only for a local server and the tests, where the Library's journeys still run on them. One switch, so the
 * routes, the pages and the links cannot disagree about whether they are open.
 */
export function selfServiceAccounts(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production";
}
