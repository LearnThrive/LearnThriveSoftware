import type { LineBox, PageReading, RenderedPage } from "@/lib/assistant/documents";

/**
 * Finds the questions on a paper and the empty space each one leaves for its answer, from the text layer's positioned lines.
 *
 * A question starts at a line beginning with its number ("3", "3.", "3)", "Question 3", "Q3"), in increasing order down the paper.
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
}

const START = /^(?:question\s*|q\.?\s*)?(\d{1,2})(?:\s*[.):]\s*|\s+(?=\(?[a-z(])|\s*$)/i;
const WRITABLE = /^[\s.…_\-–]*$|^\s*answer\b[\s.…_:]*(?:\S{0,4})\s*$|\.{6,}|_{6,}|…{3,}/i;
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

/** The questions on the paper, in order. With renders of the pages, answer space avoids diagrams and pictures as well as text. */
export function findQuestions(pages: readonly PageReading[], renders: readonly RenderedPage[] = []): PaperQuestion[] {
  const found: Array<{ q: PaperQuestion; lines: LineBox[] }> = [];
  let expect = 1;
  for (const page of pages) {
    if (page.textQuality !== "good") continue;
    const lines = [...page.lines].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const line of lines) {
      const m = START.exec(line.text);
      const n = m ? Number(m[1]) : NaN;
      // A new question: the next number (or a jump forward of a few, for a paper that starts mid-way), never backwards.
      if (m && n >= expect && n <= expect + 3 && !WRITABLE.test(line.text)) {
        expect = n + 1;
        found.push({ q: { id: `q${n}`, number: String(n), page: page.number, text: "", marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: true }, lines: [line] });
        continue;
      }
      const current = found.at(-1);
      if (current && current.q.page === page.number && !furniture(line, page)) current.lines.push(line);
    }
  }

  for (let i = 0; i < found.length; i += 1) {
    const { q, lines } = found[i]!;
    const page = pages.find((p) => p.number === q.page)!;
    const content = lines.filter((l) => !WRITABLE.test(l.text));
    const joined = content.map((l) => l.text).join("\n").replace(START, (all) => (/question|q/i.test(all) ? "" : all)).trim();
    q.marks = marksOf(joined);
    q.text = joined.replace(/^\s*[([]\d{1,2}\s*marks?[)\]]\s*/i, "").trim();
    const top = Math.max(...content.map((l) => l.y + l.h));
    const bottom = Math.min(...content.map((l) => l.y));
    const left = Math.min(...page.lines.map((l) => l.x), MARGIN * 2);
    const right = Math.max(...page.lines.map((l) => l.x + l.w), page.width - MARGIN * 2);
    q.box = { x: left, y: bottom, w: right - left, h: top - bottom };

    // The band below the text, down to the next question on the same page (or the bottom margin).
    const next = found[i + 1];
    const floor = next && next.q.page === q.page ? Math.max(...next.lines.map((l) => l.y + l.h)) + 6 : MARGIN;
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
    const render = renders.find((r) => r.number === q.page);
    q.bands = render ? freeBands(render, page, { left, right, bottom: floor, top: ceiling }) : best ? [best] : [];
    q.answer = q.bands.reduce<Rect | null>((tallest, band) => (!tallest || band.h > tallest.h ? band : tallest), null);
    const answerLine = lines.find((l) => /^\s*answer\b/i.test(l.text) && WRITABLE.test(l.text));
    q.answerLine = answerLine ? { x: answerLine.x, y: answerLine.y, w: answerLine.w, h: answerLine.h } : null;
  }
  return found.map((f) => f.q);
}
