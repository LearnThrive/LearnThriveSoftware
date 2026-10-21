import { createHash } from "node:crypto";
import { ACKNOWLEDGEMENT, CONSENT_VERSION, COOLING_OFF_DRAFT } from "./consumer";

/**
 * The hash recorded with a checkout consent: it pins the exact wording the person agreed to. Server only (node:crypto), which is why it is
 * not in consumer.ts: the pricing card is a client component and imports the wording from there, and must not pull in a Node module.
 */
export const consentHash = (): string => createHash("sha256").update(`${CONSENT_VERSION}\n${COOLING_OFF_DRAFT}\n${ACKNOWLEDGEMENT}`).digest("hex");
