import type { LineBox, PageReading, RenderedPage } from "@/lib/assistant/documents";

/**
 * Finds the questions on a paper and the empty space each one leaves for its answer, from the text layer's positioned lines.
 *
 * A question starts at a line beginning with its number ("3", "3.", "3)", "Question 3", "Q3"), in increasing order down the paper. Parts follow
 * in sequence: (a), (b) ... and, inside a part, (i), (ii) ...; what is solved is each LEAF (3(a)(ii), or 3 itself if it has no parts), with the words the
 * parts share as its stem. The id is opaque (q1, q2 ... in paper order); the label as printed is `number`. Cover, formulae and blank pages hold no questions.
 * Its answer space is the tallest band of the page, between the end of its text and the start of the next question (or the page's
 * bottom margin), that holds no printed text, where dotted or underlined answer lines count as space (writing on them is the point).
 * Coordinates are PDF units with the origin at the bottom left, as pdf.js and pdf-lib both use.
 *
 * Pages without a usable text layer (scans, outlined text) have no positions: their questions are found by the vision model
 * instead (solve.ts) and their answers go on the worked-solution pages, never guessed onto the scan.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PaperQuestion {
  /** "q3" */
  id: string;
  /** "3" as printed. */
  number: string;
  page: number;
  /** The question's own text, as read from the page (a transcription comes from the model for pictured pages). */
  text: string;
  marks: number | null;
  /** Where the question's text sits. */
  box: Rect | null;
  /** The empty space below it, for the answer (the tallest band); null when there is none or the page has no positions. */
  answer: Rect | null;
  /** Every empty band below it, top to bottom: an answer goes in the first one it fits (usually the answer box). */
  bands: Rect[];
  /** A dotted "Answer ......" line, if the paper has one: where a final answer is written. */
  answerLine: Rect | null;
  /** True when the text came from the page's text layer (and can be compared with the model's transcription). */
  fromText: boolean;
  /** The question it belongs to ("3" for 3(a)(ii)). A question with parts is not solved as a whole: each part is, with the stem as its context. */
  group?: string;
  /** "(a)" or "(ii)" as printed; absent for a whole question. `number` is the full printed label, "3(a)(ii)". */
  partLabel?: string;
  /** What the parts share (the words before (a), and the part above for (i)): context for this part, already included in `text`. */
  stem?: string;
  /** This part on its own, without the stem, for display. */
  ownText?: string;
  /** Where the answer space on a scanned page came from, and how sure the model was (it was checked against the drawing of the page before use). */
  layout?: { source: "vision"; confidence: number };
  /** The question runs on over a page; the text includes the part that carried over. */
  continued?: boolean;
  /** Where to look for answer space: kept so the space can be measured later, page by page, from a drawing of the page. */
  space?: { left: number; right: number; bottom: number; top: number };
}

const START = /^(?:question\s*|q\.?\s*)?(\d{1,3})(?:\s*[.):]\s*|\s+(?=\(?[a-z(])|\s*$)/i;
/** A mark scheme's question rows: "2 12 M1 ..." (the number, then the answer, which may itself be a number). Taken only for exactly the next number. */
const START_ROW = /^(?:question\s*|q\.?\s*)?(\d{1,3})(?:\s*[.):]\s*|\s+|\s*$)/i;
const WRITABLE =/^[\s.…_\-–]*$|^\s*answer\b[\s.…_:]*(?:\S{0,4})\s*$|\.{6,}|_{6,}|…{3,}/i;
const MARKS = /\((\d{1,2})\s*marks?\)|\[(\d{1,2})\s*marks?\]|\((\d{1,2})\)\s*$/i;
const MARGIN = 36;
const MIN_ANSWER_HEIGHT = 18;

function marksOf(text: string): number | null {
  const m = MARKS.exec(text);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null;
}

/** Lines that are page furniture rather than content: page numbers, "Turn over", "Total for question N". */
function furniture(line: LineBox, page: PageReading): boolean {
  if (/^(turn over|do not write|total for question|\d{1,3}\s*$|page \d+)/i.test(line.text)) return true;
  return line.y < MARGIN * 0.75 || line.y + line.h > page.height - MARGIN * 0.5;
}

/**
 * The empty bands between two heights of a rendered page, top to bottom. Rows holding ink are obstacles (text, diagrams, pictures).
 * Three kinds of thin ink are not: a dotted or dashed answer line (writing on it is the point), the side edges of an answer box (a
 * few pixels in a row), and a solid rule such as a box's top or bottom edge, which instead SPLITS the space, so an answer written
 * inside a box stays inside it.
 */
export function freeBands(render: RenderedPage, page: { height: number; originX?: number; originY?: number }, area: { left: number; right: number; bottom: number; top: number }): Rect[] {
  const s = render.scale;
  // Pixel rows run down from the top of the visible page; PDF y runs up from its bottom. pageTop is the PDF y of row 0.
  const ox = page.originX ?? 0;
  const pageTop = (page.originY ?? 0) + page.height;
  const c0 = Math.max(0, Math.floor((area.left - ox) * s));
  const c1 = Math.min(render.width, Math.ceil((area.right - ox) * s));
  const r0 = Math.max(0, Math.floor((pageTop - area.top) * s));
  const r1 = Math.min(render.height, Math.ceil((pageTop - area.bottom) * s));
  const span = Math.max(1, c1 - c0);
  const minDark = Math.max(6, span * 0.01);
  // 0 empty, 1 ink, 2 a solid rule (most of the width, unbroken)
  const kind: number[] = [];
  for (let r = r0; r < r1; r += 1) {
    let dark = 0;
    let longest = 0;
    let run = 0;
    for (let c = c0; c < c1; c += 1) {
      const i = (r * render.width + c) * 4;
      if (render.data[i]! < 170 || render.data[i + 1]! < 170 || render.data[i + 2]! < 170) {
        dark += 1;
        run += 1;
        if (run > longest) longest = run;
      } else run = 0;
    }
    kind.push(longest > span * 0.5 ? 2 : dark > minDark ? 1 : 0);
  }
  // Thin runs of ink (up to about 3 points tall): a solid one is a rule (a separator), a broken one is an answer line (space).
  const thin = Math.max(2, Math.round(3 * s));
  for (let i = 0; i < kind.length; ) {
    if (kind[i] === 0) {
      i += 1;
      continue;
    }
    let j = i;
    let solid = false;
    while (j < kind.length && kind[j] !== 0) {
      if (kind[j] === 2) solid = true;
      j += 1;
    }
    if (j - i <= thin) for (let k = i; k < j; k += 1) kind[k] = solid ? 2 : 0;
    i = j;
  }
  const bands: Rect[] = [];
  const pad = 3;
  for (let i = 0; i < kind.length; ) {
    if (kind[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < kind.length && kind[j] === 0) j += 1;
    const top = pageTop - (r0 + i) / s - pad;
    const bottom = pageTop - (r0 + j) / s + pad;
    if (top - bottom >= MIN_ANSWER_HEIGHT) bands.push({ x: area.left, y: bottom, w: area.right - area.left, h: top - bottom });
    i = j;
  }
  return bands;
}

/**
 * Measures the answer space of the questions on ONE drawn page and replaces their text-only estimate. Called page by page, each drawing
 * dropped before the next, so a long paper never holds every page's pixels at once. The same measurement as passing every render to
 * findQuestions, which is what the tests hold it to.
 */
export function refineAnswerSpace(questions: readonly PaperQuestion[], pages: readonly PageReading[], render: RenderedPage): void {
  const page = pages.find((p) => p.number === render.number);
  if (!page) return;
  for (const q of questions) {
    if (q.page !== render.number || !q.space) continue;
    q.bands = freeBands(render, page, q.space);
    q.answer = q.bands.reduce<Rect | null>((tallest, band) => (!tallest || band.h > tallest.h ? band : tallest), null);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What kind of page it is
// ---------------------------------------------------------------------------------------------------------------------------------

export type PageKind = "questions" | "cover" | "formulae" | "blank";

const COVER_SIGNS = [/candidate/i, /centre\s*(?:number|no)/i, /surname/i, /forename|first name/i, /time allowed/i, /total marks|maximum mark/i, /you must have/i, /^\s*instructions?\s*$/im, /information for candidates/i, /paper (?:reference|code)/i, /signature/i, /write your name/i, /do not return the (?:question|exam) paper/i];

/**
 * A page that holds no questions: the cover (name boxes, "Time allowed 1 hour 30 minutes", instructions), a formulae sheet, or a blank page. The cover
 * matters most: "1 hour 30 minutes" looks exactly like the start of question 1. A page is only called blank when it has no content line at all, or says so.
 */
export function classifyPage(page: PageReading, isFirst: boolean): PageKind {
  const content = page.lines.filter((l) => !furniture(l, page));
  const says = /intentionally left blank|this page is blank|blank page|do not write on this page/i.test(page.text);
  if (page.textQuality === "good" && (content.length === 0 || (says && content.length <= 8))) return "blank";
  if (page.textQuality === "none" && !page.hasPictures && page.text.trim() === "") return "blank";
  if (page.textQuality !== "good") return "questions";
  if (isFirst && COVER_SIGNS.filter((re) => re.test(page.text)).length >= 3) return "cover";
  const head = [...content].sort((a, b) => b.y - a.y).slice(0, 4).map((l) => l.text).join(" ");
  if (/\bformulae?\b|formula sheet|data sheet/i.test(head)) return "formulae";
  return "questions";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Question parts: 1(a)(ii)
// ---------------------------------------------------------------------------------------------------------------------------------

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
const PART = /^(?:\(([a-z]|[ivx]{1,4})\)|([a-z])\))\s*/i;

interface Node {
  /** "3", "3(a)", "3(a)(ii)" as printed. */
  label: string;
  /** The part on its own: "(a)", "(ii)"; empty for a whole question. */
  partLabel: string;
  depth: number;
  parent: Node | null;
  children: Node[];
  /** The node's own lines on the page it starts on. */
  lines: LineBox[];
  page: number;
  /** Lines that carry on over the page (a question that runs onto the next page). */
  continued: Array<{ page: number; lines: LineBox[] }>;
  /** "3" for every node of question 3. */
  group: string;
}

const content = (lines: readonly LineBox[]) => lines.filter((l) => !WRITABLE.test(l.text));

/** The questions on the paper, in order. With renders of the pages, answer space avoids diagrams and pictures as well as text. */
export function findQuestions(pages: readonly PageReading[], renders: readonly RenderedPage[] = [], options: { rows?: boolean } = {}): PaperQuestion[] {
  const nodes: Node[] = [];
  let expect = 1;
  let top: Node | null = null;
  let letter: Node | null = null;
  let letterCode = 0;
  let roman = 0;

  /** Which part a line opens, if any, judged by the sequence: the next letter, or the next roman numeral. Never from the look of the line alone. */
  const partOf = (text: string): { token: string; kind: "letter" | "roman"; length: number } | null => {
    const m = PART.exec(text);
    if (!m || !top) return null;
    const token = (m[1] ?? m[2] ?? "").toLowerCase();
    const nextLetter = String.fromCharCode((letterCode || 96) + 1);
    const asLetter = token.length === 1 && token === nextLetter;
    const asRoman = ROMAN[roman] === token;
    if (asRoman && (!asLetter || !(token === "i" && nextLetter === "i"))) return { token, kind: "roman", length: m[0].length };
    if (asLetter) return { token, kind: "letter", length: m[0].length };
    return null;
  };
  const open = (part: { token: string; kind: "letter" | "roman"; length: number }, line: LineBox, page: PageReading): Node => {
    const parent = part.kind === "roman" ? letter ?? top! : top!;
    const node: Node = { label: `${parent.label}(${part.token})`, partLabel: `(${part.token})`, depth: parent.depth + 1, parent, children: [], lines: [line], page: page.number, continued: [], group: top!.group };
    parent.children.push(node);
    nodes.push(node);
    if (part.kind === "letter") {
      letter = node;
      letterCode = part.token.charCodeAt(0);
      roman = 0;
    } else roman += 1;
    return node;
  };

  for (const page of pages) {
    if (page.textQuality !== "good" || classifyPage(page, page === pages[0]) !== "questions") continue;
    const lines = [...page.lines].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const line of lines) {
      const m = (options.rows ? START_ROW : START).exec(line.text);
      const n = m ? Number(m[1]) : NaN;
      // A new question: the next number (or a jump forward of a few, for a paper that starts mid-way), never backwards. A scheme's rows must be exactly the next.
      if (m && (options.rows ? n === expect : n >= expect && n <= expect + 3) && !WRITABLE.test(line.text)) {
        expect = n + 1;
        top = { label: String(n), partLabel: "", depth: 0, parent: null, children: [], lines: [line], page: page.number, continued: [], group: String(n) };
        nodes.push(top);
        letter = null;
        letterCode = 0;
        roman = 0;
        // "1 (a) Work out ...": the number and the first part share a line, so there is no stem and the line belongs to the part.
        const first = partOf(line.text.slice(m[0].length));
        if (first) {
          top.lines = [];
          open(first, line, page);
        }
        continue;
      }
      const part = partOf(line.text);
      if (part) {
        open(part, line, page);
        continue;
      }
      const current = nodes.at(-1);
      if (!current || furniture(line, page)) continue;
      if (current.page === page.number) current.lines.push(line);
      else {
        const run = current.continued.find((c) => c.page === page.number);
        if (run) run.lines.push(line);
        else current.continued.push({ page: page.number, lines: [line] });
      }
    }
  }

  /** A node's own words: its lines, then what ran over onto later pages. A part's own label is dropped (it is in the label). */
  const own = (node: Node): string => {
    const all = [...content(node.lines), ...node.continued.flatMap((c) => content(c.lines))].map((l) => l.text).join("\n");
    const text = node.depth === 0 ? all.replace(START, (whole) => (/question|q/i.test(whole) ? "" : whole)) : all.replace(PART, "");
    return text.trim();
  };

  const leaves = nodes.filter((n) => n.children.length === 0);
  const made: PaperQuestion[] = [];
  for (const leaf of leaves) {
    const lines = leaf.lines;
    const page = pages.find((p) => p.number === leaf.page)!;
    const chain: Node[] = [];
    for (let at: Node | null = leaf; at; at = at.parent) chain.unshift(at);
    const body = content(lines);
    if (body.length === 0) continue;
    const mine = own(leaf);
    const stem = chain.slice(0, -1).map(own).filter(Boolean).join("\n");
    const joined = [stem, mine].filter(Boolean).join("\n");
    const q: PaperQuestion = {
      id: `q${made.length + 1}`,
      number: leaf.label,
      page: leaf.page,
      text: joined.replace(/^\s*[([]\d{1,2}\s*marks?[)\]]\s*/i, "").trim(),
      marks: marksOf(mine),
      box: null,
      answer: null,
      bands: [],
      answerLine: null,
      fromText: true,
      group: leaf.group,
      partLabel: leaf.partLabel || undefined,
      stem: stem || undefined,
      ownText: mine.replace(/^\s*[([]\d{1,2}\s*marks?[)\]]\s*/i, "").trim(),
      continued: leaf.continued.length > 0 || undefined,
    };
    const topY = Math.max(...body.map((l) => l.y + l.h));
    const bottom = Math.min(...body.map((l) => l.y));
    const left = Math.min(...page.lines.map((l) => l.x), MARGIN * 2);
    const right = Math.max(...page.lines.map((l) => l.x + l.w), page.width - MARGIN * 2);
    q.box = { x: left, y: bottom, w: right - left, h: topY - bottom };

    // The band below the text, down to whatever starts next on the same page (a part, a question, or a stem between parts) or the bottom margin.
    const at = nodes.indexOf(leaf);
    const next = nodes.slice(at + 1).find((n) => n.lines.length > 0);
    const floor = next && next.page === leaf.page ? Math.max(...next.lines.map((l) => l.y + l.h)) + 6 : MARGIN;
    const ceiling = bottom - 4;
    const obstacles = page.lines
      .filter((l) => !WRITABLE.test(l.text) && !furniture(l, page) && l.y < ceiling && l.y + l.h > floor)
      .sort((a, b) => b.y - a.y);
    let bestTop = ceiling;
    let best: Rect | null = null;
    for (const cut of [...obstacles, null]) {
      const bandBottom = cut ? cut.y + cut.h + 2 : floor;
      const height = bestTop - bandBottom;
      if (height >= MIN_ANSWER_HEIGHT && (!best || height > best.h)) best = { x: left, y: bandBottom, w: right - left, h: height };
      if (cut) bestTop = cut.y - 2;
    }
    const render = renders.find((r) => r.number === leaf.page);
    q.space = { left, right, bottom: floor, top: ceiling };
    q.bands = render ? freeBands(render, page, q.space) : best ? [best] : [];
    q.answer = q.bands.reduce<Rect | null>((tallest, band) => (!tallest || band.h > tallest.h ? band : tallest), null);
    const answerLine = lines.find((l) => /^\s*answer\b/i.test(l.text) && WRITABLE.test(l.text));
    q.answerLine = answerLine ? { x: answerLine.x, y: answerLine.y, w: answerLine.w, h: answerLine.h } : null;
    made.push(q);
  }
  return made;
}
