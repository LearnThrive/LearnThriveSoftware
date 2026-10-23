import type { ChatOwner, LibraryStore } from "@learnthrive/data/library";
import { evaluate, sameValue, satisfies, valueOf } from "@/lib/paper/maths";
import type { ToolDefinition } from "./types";
import { describeHits, type RetrievalHit } from "./retrieval";

/**
 * Real tool calling (brief section 8): a SMALL, read-only allowlist, executed by the server after validating the arguments.
 *
 * There is no shell, no code evaluation, no SQL, no URL fetch and no account or billing action here, and there is no way for an
 * argument to name a different learner or file: the service resolves the owner and the chat's own uploads on the server, so a
 * supplied id is never trusted (and none is accepted). Results are data for the model to read, never instructions: they are
 * wrapped, defused and size-limited before they go back into the conversation.
 */
export interface ToolContext {
  store: LibraryStore;
  owner: ChatOwner;
  sessionId: string;
  fileNames: ReadonlyMap<string, string>;
  search: (query: string) => Promise<RetrievalHit[]>;
  maxChars?: number;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "search_authorised_material",
    description:
      "Search the parts of the student's OWN uploaded files in this chat that are relevant to a query. Use when the student refers to earlier material without naming a page or question, or asks what their notes say. Returns at most four short passages with their page or question labels.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for, in a few words (at most 300 characters)." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_question_region",
    description:
      "Read a named page or question from the student's own uploaded files in this chat. Use when the student names a page (\"page 2\") or question (\"question 4b\") and the answer needs what is printed there.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string", description: "A page or question as printed, for example \"page 2\" or \"question 4b\"." } },
      required: ["reference"],
      additionalProperties: false,
    },
  },
  {
    name: "check_calculation",
    description:
      "Check arithmetic or algebra with the server's own checker. Use it before stating a numeric result you are unsure of. It can evaluate an expression, test whether a value satisfies an equation, or compare a calculated value with the student's answer. It cannot solve an arbitrary problem.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "An arithmetic or algebra expression to evaluate, for example \"3/4 * 24\"." },
        equation: { type: "string", description: "An equation to test, for example \"2x + 7 = 19\"." },
        answer: { type: "string", description: "A value to compare with or to test in the equation, for example \"6\" or \"x = 6\"." },
        values: { type: "object", description: "Values for letters in the expression, for example {\"x\": 6}.", additionalProperties: { type: "number" } },
      },
      additionalProperties: false,
    },
  },
] as const;

const ALLOWED_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));
const MAX_CHARS = 300;
const RESULT_CHARS = 4000;

export type ToolOutcome = { ok: true; content: string } | { ok: false; content: string; code: "unknown_tool" | "bad_arguments" | "too_large" | "unavailable" };

const asText = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new Error(field);
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new Error(field);
  if (text.length > MAX_CHARS) throw new Error(`${field}_too_long`);
  return text;
};

const defuse = (text: string) => text.replace(/<\s*\/?\s*(uploaded-file|page|retrieved|retrieved-material|passage|tool_result)\b/gi, "[marker removed]");

/**
 * Runs one tool call. NEVER throws: a malformed or unknown call comes back as a short refusal the model can recover from, and an
 * unavailable search comes back as "nothing found" rather than a failed answer.
 */
export async function runTool(name: unknown, args: unknown, ctx: ToolContext, signal?: AbortSignal): Promise<ToolOutcome> {
  if (typeof name !== "string" || !ALLOWED_NAMES.has(name)) return { ok: false, code: "unknown_tool", content: "That tool is not available. Answer with what you already know, or ask the student." };
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) return { ok: false, code: "bad_arguments", content: "Those arguments could not be read. Try again with a plain object." };
  const input = (args ?? {}) as Record<string, unknown>;
  if (signal?.aborted) return { ok: false, code: "unavailable", content: "The request was stopped." };
  try {
    if (name === "search_authorised_material") {
      const query = asText(input.query, "query");
      const hits = await ctx.search(query);
      if (!hits.length) return { ok: true, content: "Nothing in the student's uploaded files matched that query." };
      return { ok: true, content: defuse(describeHits(hits, ctx.fileNames)).slice(0, RESULT_CHARS) };
    }
    if (name === "get_question_region") {
      const reference = asText(input.reference, "reference");
      const hits = await ctx.search(reference);
      const region = hits.filter((h) => h.match === "exact");
      if (!region.length) return { ok: true, content: `No page or question matching "${reference}" is in the uploaded files of this chat. Say so rather than guessing.` };
      const text = region.map((h) => `[${[h.page ? `page ${h.page}` : null, h.label].filter(Boolean).join(", ")}]\n${h.text}`).join("\n\n");
      return { ok: true, content: defuse(text).slice(0, RESULT_CHARS) };
    }
    // check_calculation
    const expression = typeof input.expression === "string" ? input.expression.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const equation = typeof input.equation === "string" ? input.equation.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const answer = typeof input.answer === "string" ? input.answer.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const values: Record<string, number> = {};
    if (input.values !== undefined) {
      if (typeof input.values !== "object" || input.values === null || Array.isArray(input.values)) throw new Error("values");
      for (const [k, v] of Object.entries(input.values as Record<string, unknown>).slice(0, 8)) {
        if (!/^[a-z]$/i.test(k) || typeof v !== "number" || !Number.isFinite(v)) throw new Error("values");
        values[k] = v;
      }
    }
    if (equation) {
      const holds = satisfies([equation], answer || equation);
      if (holds === null) return { ok: false, code: "bad_arguments", content: "That equation could not be checked. Do not state a result from this tool." };
      return { ok: true, content: holds ? `Yes: ${answer || equation} satisfies ${equation}.` : `No: ${answer || equation} does not satisfy ${equation}.` };
    }
    if (!expression) return { ok: false, code: "bad_arguments", content: "Give an expression or an equation to check." };
    const value = evaluate(expression, values);
    if (value === null || !Number.isFinite(value)) return { ok: false, code: "bad_arguments", content: "That expression could not be evaluated. Do not state a result from this tool." };
    if (answer) {
      const claimed = valueOf(answer);
      if (claimed === null) return { ok: true, content: `${expression} = ${value}. The answer "${answer}" could not be read as a number.` };
      return { ok: true, content: sameValue(value, claimed) ? `Yes: ${expression} = ${claimed}.` : `No: ${expression} = ${value}, not ${claimed}.` };
    }
    return { ok: true, content: `${expression} = ${value}.` };
  } catch (error) {
    const code = String((error as Error)?.message ?? "");
    if (code.endsWith("_too_long")) return { ok: false, code: "too_large", content: "That argument is too long. Use a short phrase." };
    return { ok: false, code: "bad_arguments", content: "Those arguments could not be read. Try again, or answer without the tool." };
  }
}
