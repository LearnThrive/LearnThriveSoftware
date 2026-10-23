import type { PaperQuestion } from "./questions";

/**
 * The shape of a paper's questions, decided in ONE place for every source (a text layer, a vision reading, a mark scheme's rows):
 *
 *   3            introduces a shared context (words, facts, a diagram) and has parts, so it is NOT a task of its own
 *   3(a), 3(b)   the tasks; each carries the shared words of 3 as its stem
 *   3(a)(ii)     nested: the task carries the words of 3 and of 3(a)
 *   4            no parts: an independent parent task, kept as it is
 *
 * It runs on the whole list before anything is offered, laid out or solved, so a screen never shows "Q3" and "Q3(a)" side by side and
 * the solver always sees the facts its part depends on. It works on labels and words, never on pixels, and it is idempotent.
 */
export interface ParsedLabel {
  number: string;
  /** "a", "ii" ... one entry per level of nesting. */
  parts: string[];
}

/** "3", "3(a)", "3(a)(ii)", "Question 3(a)", "3a", "3.a" -> its number and parts; null if it is not a question label. */
export function parseLabel(raw: string): ParsedLabel | null {
  const compact = raw.replace(/\s+/g, "").replace(/^(?:question|q)\.?/i, "");
  const m = /^(\d{1,3})((?:\([a-z]{1,4}\))*)$/i.exec(compact) ?? /^(\d{1,3})[.]?([a-z])$/i.exec(compact);
  if (!m) return null;
  const rest = m[2] ?? "";
  const parts = rest.includes("(") ? [...rest.matchAll(/\(([a-z]{1,4})\)/gi)].map((p) => p[1]!.toLowerCase()) : rest ? [rest.toLowerCase()] : [];
  return { number: String(Number(m[1])), parts };
}

export const labelOf = (p: ParsedLabel): string => `${p.number}${p.parts.map((x) => `(${x})`).join("")}`;

/** "(b)" or "b" with no number, as a page that shows only a later part would print it, completed with the number that was last seen. */
export function resolveLabel(raw: string, carry: string | null): string {
  const trimmed = raw.trim();
  if (parseLabel(trimmed)) return labelOf(parseLabel(trimmed)!);
  const bare = /^\(?([a-z]{1,4})\)?$/i.exec(trimmed);
  if (bare && carry) return `${carry}(${bare[1]!.toLowerCase()})`;
  return trimmed;
}

const own = (q: PaperQuestion): string => (q.ownText ?? q.text).trim();

const COMMAND = /(?:^|[.!?]\s+|\n)\s*(?:work out|calculate|find|solve|simplify|expand|factorise|factorize|show that|write down|write|explain|give|state|draw|describe|prove|complete|estimate|measure|plot|sketch|name|identify|compare|evaluate|express|determine|circle|tick|round|convert|label|decide)\b/i;
const MARKS_TAIL = /\(\s*\d{1,2}\s*(?:marks?)?\s*\)\s*$|\[\s*\d{1,2}\s*marks?\s*\]\s*$/i;

/**
 * Is a question's own text a task, or only the words its parts share? A stem introduces facts and a picture ("Petra has 3 tins of paint."). A task
 * asks something: it ends in a question, opens a sentence with an instruction ("Work out ...", "Find ..."), or carries its own printed marks. A
 * command that ends in a colon ("Work out:"), or that points at what follows ("Work out the following."), belongs to its parts.
 */
export function isIndependentTask(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/:\s*$/.test(t)) return false;
  if (/\b(?:the following|these|each of the following|as follows|below)\s*[.:]?\s*$/i.test(t)) return false;
  // An instruction with nothing to work on ("Factorise fully.") is the parts' shared instruction; one with a number in it is a task.
  // (Lines that open with a bracket are looked at for the question mark and the marks only: a stray "(b) ..." or "(x + 1)(x - 2)" is not what is being asked.)
  const asked = t.split("\n").filter((line) => !/^\s*\(/.test(line)).join("\n");
  return /\?/.test(t) || MARKS_TAIL.test(t) || (COMMAND.test(asked) && /\d/.test(asked));
}

/** A part's words without the marker that opens them: "(b) Petra finds ..." -> "Petra finds ...". */
const unmarked = (text: string): string => text.replace(/^\s*\(?[a-z]{1,4}\)\s*/i, "").trim();

/**
 * The shared words an ancestor really contributes. A vision model sometimes files a part's own sentences under the question ("3": "(b) Petra
 * finds ..."), which would make a lone part look as if it had its question's context and stop it being linked to the real one. Words that
 * only repeat the part, or that open with a part marker, are the part's own, not shared.
 */
export function sharedWords(ancestorText: string, partText: string): string {
  const stem = ancestorText.trim();
  if (!stem) return "";
  const mine = unmarked(partText);
  const theirs = unmarked(stem);
  // Only the part's own words repeated: nothing is shared.
  if (mine && theirs.includes(mine)) return theirs.replace(mine, "").trim();
  // Words that open with a part marker are a part's, however they were filed.
  if (/^\s*\(?[a-z]{1,4}\)\s/i.test(stem) || /^\s*\([a-z]{1,4}\)/i.test(stem)) return "";
  return stem;
}

/**
 * The tasks of a list of questions, in the order given. A question that has parts in the list is dropped and its words become the
 * stem of each of its parts (and of their parts). The same printed label appearing again starts a new, separate group: two sections
 * of a worksheet both numbered from 1 (or two papers in one file) are never merged.
 */
export function normaliseQuestions(list: readonly PaperQuestion[]): PaperQuestion[] {
  type Item = { q: PaperQuestion; label: ParsedLabel | null; group: string };
  const seen = new Map<string, Set<string>>();
  const instance = new Map<string, number>();
  const items: Item[] = list.map((q) => {
    const label = parseLabel(q.number);
    if (!label) return { q, label, group: q.group ?? q.number };
    const key = labelOf(label);
    let inst = instance.get(label.number) ?? 1;
    let labels = seen.get(`${label.number}#${inst}`);
    if (!labels) seen.set(`${label.number}#${inst}`, (labels = new Set()));
    if (labels.has(key)) {
      inst += 1;
      instance.set(label.number, inst);
      seen.set(`${label.number}#${inst}`, (labels = new Set()));
    }
    labels.add(key);
    return { q, label, group: inst === 1 ? label.number : `${label.number}#${inst}` };
  });

  const byKey = new Map<string, Item>();
  for (const item of items) if (item.label) byKey.set(`${item.group}|${labelOf(item.label)}`, item);
  const hasParts = (item: Item): boolean => {
    if (!item.label) return false;
    const prefix = `${item.group}|${labelOf(item.label)}(`;
    for (const key of byKey.keys()) if (key.startsWith(prefix)) return true;
    return false;
  };

  const out: PaperQuestion[] = [];
  const groupStem = new Map<string, string>();
  for (const item of items) {
    const { q, label, group } = item;
    if (!label) {
      out.push(q);
      continue;
    }
    // A task read on an earlier page already carries the shared words of its question: a later part listed without them gets the same.
    if (q.groupStem && !groupStem.has(group)) groupStem.set(group, q.groupStem);
    // A parent with parts is context for them, and not a task of its own, unless it asks something itself (and is not merely a part's words filed under it).
    if (hasParts(item)) {
      const prefix = `${group}|${labelOf(label)}(`;
      const child = [...byKey.entries()].find(([key]) => key.startsWith(prefix))?.[1];
      const words = child ? sharedWords(own(q), own(child.q)) : "";
      if (!isIndependentTask(words)) continue;
    }
    const top = byKey.get(`${group}|${label.number}`);
    const ancestors: PaperQuestion[] = [];
    for (let depth = 0; depth < label.parts.length; depth += 1) {
      const above = byKey.get(`${group}|${labelOf({ number: label.number, parts: label.parts.slice(0, depth) })}`);
      if (above && above !== item) ancestors.push(above.q);
    }
    const mineRaw = own(q);
    const fromAncestors = ancestors.map((a) => sharedWords(own(a), mineRaw)).filter(Boolean).join("\n");
    // The shared words of the question itself, remembered for a later part that is listed without it (the next page of a long question).
    const topWords = top && top !== item && hasParts(top) ? sharedWords(own(top.q), mineRaw) : "";
    if (topWords) groupStem.set(group, topWords);
    const inherited = label.parts.length > 0 ? groupStem.get(group) : undefined;
    const stem = fromAncestors || q.stem || inherited || "";
    // The part's words may have been filed under its question (the model put them all in the parent): take them from there.
    const misfiled = !mineRaw && ancestors.length > 0 ? unmarked(own(ancestors.at(-1)!)) : "";
    // A part read from a picture may open with its own marker ("(b) Petra finds ..."): the label already says it.
    const last = label.parts.at(-1);
    const marker = last ? new RegExp(`^\\s*\\(?${last}\\)\\s*`, "i") : null;
    const mine = marker ? (mineRaw || misfiled).replace(marker, "").trim() : mineRaw || misfiled;
    const shared = groupStem.get(group) ?? q.groupStem;
    out.push({
      ...q,
      number: labelOf(label),
      group,
      partLabel: label.parts.length > 0 ? `(${label.parts.at(-1)})` : q.partLabel,
      stem: stem || undefined,
      ownText: mine,
      text: [stem, mine].filter(Boolean).join("\n").trim(),
      ...(shared ? { groupStem: shared } : {}),
    });
  }
  return out;
}
