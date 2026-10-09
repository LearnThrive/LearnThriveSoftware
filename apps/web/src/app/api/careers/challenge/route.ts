import { careersConfig } from "@/lib/careers-config";
import { humanCheckAvailable, issuePowChallenge, issueTextChallenge } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome } from "@/lib/request-guards";

/**
 * Issues a human-check challenge (lib/human-check.ts). Used by the careers application, the safeguarding
 * reconfirmation and the subject request. `?mode=text` asks for the short-sum fallback, for a browser that
 * cannot run the proof of work.
 *
 * No Origin check: a same-origin GET carries none, and a challenge is useless without solving it. It is
 * rate limited so the endpoint cannot be used to generate work for free, and it is never cached.
 */
export const dynamic = "force-dynamic";

const limiter = new SlidingWindowLimiter(careersConfig.rateLimits.challenge.perClient, careersConfig.rateLimits.challenge.global);

export async function GET(request: Request) {
  if (!limiter.allow(clientAddress(request.headers))) {
    logOutcome("human-check", "rate_limited");
    return jsonResponse(429, { error: "Too many requests. Please wait a few minutes and try again." });
  }
  if (!humanCheckAvailable()) {
    logOutcome("human-check", "unavailable");
    return jsonResponse(503, { error: "The check that confirms you are a person is not available right now. Please email us instead." });
  }
  const text = new URL(request.url).searchParams.get("mode") === "text";
  const challenge = text ? issueTextChallenge() : issuePowChallenge();
  if (!challenge) return jsonResponse(503, { error: "The check that confirms you are a person is not available right now. Please email us instead." });
  return jsonResponse(200, { ...challenge });
}
