/**
 * Gating for the motion debug overlay (plan11.md task 1: "the overlay never renders in production
 * unless an explicit development/debug condition is satisfied").
 *
 * Kept as a pure function of its inputs — not something that reads `process.env` or `window`
 * itself — so the rule can be unit-tested exhaustively (tests/motion.test.mjs) rather than only
 * observed in a browser, and so a future change to it can't quietly widen who sees the overlay.
 *
 * The rule, in full:
 *   - the visitor must ask for it with `?motionDebug=1` (nothing shows just because of the build);
 *   - in development (and the test environment) that is enough;
 *   - in production it additionally needs the build to have been made with
 *     NEXT_PUBLIC_MOTION_DEBUG=1 — an explicit, per-build decision that a normal deploy never has;
 *   - any environment it does not recognise fails closed.
 */
export const MOTION_DEBUG_PARAM = "motionDebug";

export interface MotionDebugEnvironment {
  /** process.env.NODE_ENV, inlined by Next.js at build time. */
  nodeEnv: string | undefined;
  /** process.env.NEXT_PUBLIC_MOTION_DEBUG === "1", inlined at build time. */
  productionOptIn: boolean;
  /** window.location.search */
  search: string;
}

const NON_PRODUCTION_ENVIRONMENTS: ReadonlySet<string> = new Set(["development", "test"]);

export function shouldShowMotionDebug({ nodeEnv, productionOptIn, search }: MotionDebugEnvironment): boolean {
  if (new URLSearchParams(search).get(MOTION_DEBUG_PARAM) !== "1") return false;
  if (nodeEnv === "production") return productionOptIn;
  return nodeEnv !== undefined && NON_PRODUCTION_ENVIRONMENTS.has(nodeEnv);
}
