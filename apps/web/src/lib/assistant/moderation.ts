import { createHash } from "node:crypto";
import { PROMPT_CANARY, type BlockedCategory } from "./prompt";

/**
 * Input and output moderation (plan19 section 5.3): plain rules in front of the model's own refusals, so the cases that matter
 * most never depend on a model behaving. Rules are deliberately blunt: they over-catch a little (a maths question about "cutting"
 * a shape is fine; the words "cutting myself" are not), and a false positive costs one fixed reply, a false negative costs more.
 *
 * Input has three outcomes: allow; block with a fixed reply (the model is not called); safeguard, which is a fixed supportive
 * reply plus a flag for the safeguarding lead, and takes priority over everything else. The rules are measured against a fixture
 * of synthetic cases in tests/assistantModeration.test.mjs and the benchmark. This is a first line, not a guarantee.
 */
export type SafeguardingKind = "self_harm" | "abuse" | "unsafe";

export type InputVerdict = { action: "allow" } | { action: "block"; category: BlockedCategory } | { action: "safeguard"; kind: SafeguardingKind };

const SAFEGUARDING: Array<[SafeguardingKind, RegExp]> = [
  [
    "self_harm",
    /\b(kill(ing)?\s+(my\s*self|myself)|end(ing)?\s+(my|it\s+all)(\s+life)?|want(ed)?\s+to\s+die|wish\s+i\s+(was|were)\s+dead|better\s+off\s+(dead|without\s+me)|suicid\w*|self[\s-]?harm\w*|hurt(ing)?\s+my\s*self|cut(ting)?\s+my\s*self|harm\s+my\s*self|overdos\w+|no\s+reason\s+to\s+(live|go\s+on))\b/i,
  ],
  [
    "unsafe",
    /\b(i\s*(am|'m|m)\s+(not\s+safe|in\s+danger|scared\s+to\s+(go|be)\s+(home|alone))|not\s+safe\s+(at\s+home|here)|scared\s+to\s+go\s+home|someone\s+is\s+(going\s+to|trying\s+to)\s+(hurt|kill)\s+me|being\s+(groomed|threatened|blackmailed)|sent\s+(me\s+)?(nudes|naked\s+(photos|pictures)))\b/i,
  ],
  [
    "abuse",
    /\b(hit(s|ting)?\s+me|beat(s|ing)?\s+me|hurt(s|ing)?\s+me|touch(es|ed|ing)?\s+me\s+(in|where|when)|touch(es|ed|ing)?\s+my\s+(private|body)|(i\s+(was|am\s+being|have\s+been)\s+(abused|molested|raped)|(abuses|abused|molests|molested|raped|rapes)\s+me)|(he|she|they|someone)\s+(made|makes|forced|forces)\s+me|made\s+me\s+do\s+things|afraid\s+of\s+(my|a)\s+(dad|mum|mom|step\w*|uncle|teacher|coach)|secret\s+(touch|photo)s?)\b/i,
  ],
];

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+|your\s+|the\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|messages?)/i,
  /\b(reveal|show|print|repeat|tell\s+me)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions|rules)\b/i,
  /\byou\s+are\s+now\s+(a|an|in)\b.*\b(no\s+rules|unfiltered|jailbr\w+|developer\s+mode|dan)\b/i,
  /\b(jailbreak|developer\s+mode|do\s+anything\s+now|\bDAN\s+mode)\b/i,
  /<\/?\s*(system|uploaded-file)\s*>/i,
];

const COURSEWORK: RegExp[] = [
  /\b(write|do|complete|finish|answer)\s+(all\s+of\s+)?(my|the)\s+(nea|coursework|controlled\s+assessment|non[\s-]?exam\s+assessment|extended\s+project|dissertation|epq|portfolio)\b/i,
  /\b(write|do|complete)\s+(my|this)\s+(essay|project|assignment|homework)\s+(for\s+me|so\s+i\s+can\s+(hand|submit|send)\s+it\s+in)/i,
  /\bsomething\s+i\s+can\s+(hand|submit|turn)\s+in\s+(as\s+my\s+own|for\s+marking)\b/i,
];

const ADULT: RegExp[] = [/\b(porn\w*|sex\s+(chat|video|photos?)|nsfw|nude\s+(photos?|pictures?)|erotic\w*|onlyfans)\b/i];

/** Personal details: a UK phone number, an email address, a postcode, or "my address / I live at". */
const PERSONAL: RegExp[] = [
  /(\+44\s?\d|\b0)\d{3,4}\s?\d{3}\s?\d{3,4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/,
  /\b(my\s+(home\s+)?address\s+is|i\s+live\s+(at|on)\s+\d|my\s+(phone|mobile)\s+(number\s+)?is)\b/i,
];

export function moderateInput(text: string): InputVerdict {
  const flat = text.replace(/\s+/g, " ");
  for (const [kind, pattern] of SAFEGUARDING) if (pattern.test(flat)) return { action: "safeguard", kind };
  if (PERSONAL.some((p) => p.test(flat))) return { action: "block", category: "personal_info" };
  if (INJECTION.some((p) => p.test(flat))) return { action: "block", category: "injection" };
  if (ADULT.some((p) => p.test(flat))) return { action: "block", category: "adult" };
  if (COURSEWORK.some((p) => p.test(flat))) return { action: "block", category: "coursework" };
  return { action: "allow" };
}

export type OutputReason = "prompt_leak" | "personal_info" | "adult";

export function moderateOutput(text: string): { ok: true } | { ok: false; reason: OutputReason } {
  const flat = text.replace(/\s+/g, " ");
  if (flat.includes(PROMPT_CANARY)) return { ok: false, reason: "prompt_leak" };
  if (PERSONAL.some((p) => p.test(flat))) return { ok: false, reason: "personal_info" };
  if (ADULT.some((p) => p.test(flat))) return { ok: false, reason: "adult" };
  return { ok: true };
}

/**
 * Checks a streamed answer as it arrives, before any of it reaches the person: text is held until a sentence or line ends (or
 * 160 characters build up), each held piece is checked together with a little of what came before, and once anything fails the
 * rest of the answer is dropped. What was already released was checked. `release()` returns text that is safe to show now.
 */
export class OutputGuard {
  private held = "";
  private tail = "";
  private blocked: OutputReason | null = null;

  /** Why the answer was stopped, or null. */
  get stoppedFor(): OutputReason | null {
    return this.blocked;
  }

  push(delta: string): string {
    if (this.blocked) return "";
    this.held += delta;
    const cut = Math.max(this.held.lastIndexOf("\n"), this.held.lastIndexOf(". "), this.held.lastIndexOf("? "), this.held.lastIndexOf("! "));
    if (cut < 0 && this.held.length < 160) return "";
    return this.check(cut >= 0 ? this.held.slice(0, cut + 1) : this.held, cut >= 0 ? this.held.slice(cut + 1) : "");
  }

  /** The end of the stream: check and release whatever is left. */
  finish(): string {
    if (this.blocked) return "";
    return this.check(this.held, "");
  }

  private check(piece: string, rest: string): string {
    const verdict = moderateOutput(this.tail + piece);
    if (!verdict.ok) {
      this.blocked = verdict.reason;
      this.held = "";
      return "";
    }
    this.tail = (this.tail + piece).slice(-80);
    this.held = rest;
    return piece;
  }
}

/** An opaque, stable reference to a family for a safeguarding flag, so the lead can find the account without the flag carrying an identity. */
export function accountReference(clientId: string, salt = "learnthrive-safeguarding"): string {
  return `SG-${createHash("sha256").update(`${salt}:${clientId}`).digest("hex").slice(0, 10).toUpperCase()}`;
}

/** The least that is needed to understand a flag: the kind, a short excerpt around the trigger, and the reference. */
export function safeguardingExcerpt(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}
