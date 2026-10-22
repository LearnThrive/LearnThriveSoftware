import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { mathShapes } from "./mathsvg";
import type { PaperQuestion, Rect } from "./questions";

/**
 * Writes worked solutions onto a paper. The original pages are kept as they are (copied, never re-drawn), and answers are added on
 * top in blue "pen" in the empty answer space found for each question: handwriting-style text (Patrick Hand, SIL Open Font
 * Licence) and maths typeset by MathJax as vectors. Three modes:
 *
 *   filled   the answer and as much working as fits, in the paper's own answer space
 *   worked   the paper unchanged, then pages of full worked solutions
 *   hybrid   (default) the answer in the paper's space when it fits (with the working if it fits too), a numbered reference where
 *            space is tight, and the full working on pages added at the end
 *
 * Nothing is ever written over printed text: placement only uses the space questions.ts measured as empty. Text is never shrunk
 * below a readable size (11 pt): if it does not fit, it goes on the worked pages instead. Every annotated page carries a small
 * "AI-generated worked solutions" label, and a question that was not confidently solved says so where its answer is.
 */
export type OutputMode = "filled" | "worked" | "hybrid";

export interface WorkedStep {
  /** Plain words, written in the handwriting font. */
  say?: string;
  /** LaTeX, typeset as maths. */
  math?: string;
}

export type SolveStatus = "verified" | "checked_reading" | "unchecked" | "failed" | "unsolved";

export interface SolvedQuestion extends PaperQuestion {
  transcription: string;
  /** LaTeX (or plain text) for the final answer. Empty when unsolved. */
  finalAnswer: string;
  steps: WorkedStep[];
  explanation: string;
  status: SolveStatus;
  statusNote: string;
}

export interface Placement {
  questionId: string;
  page: number;
  rect: Rect;
  kind: "answer" | "reference";
  /** Font size used: never below MIN_SIZE. */
  size: number;
}

export const INK = rgb(0.07, 0.24, 0.62);
export const WARN = rgb(0.62, 0.32, 0.02);
export const GREY = rgb(0.35, 0.39, 0.43);
export const MIN_SIZE = 11;
const SIZES = [14, 13, 12, MIN_SIZE];
const LINE_GAP = 1.35;

export const STATUS_TEXT: Record<SolveStatus, string> = {
  verified: "Checked by calculation",
  checked_reading: "Checked by calculation (against the AI's reading of the question)",
  unchecked: "Not checked by calculation: look over this one",
  failed: "Not confidently solved: the check did not agree",
  unsolved: "Not confidently solved",
};

export function fontBytes(): Uint8Array {
  for (const base of [process.cwd(), join(process.cwd(), "apps", "web")]) {
    const path = join(base, "assets", "fonts", "PatrickHand-Regular.ttf");
    if (existsSync(path)) return new Uint8Array(readFileSync(path));
  }
  throw new Error("the handwriting font is missing (apps/web/assets/fonts/PatrickHand-Regular.ttf)");
}

/** Characters a font cannot draw are replaced, so pdf-lib never throws on an unusual symbol in an explanation. */
function drawable(font: PDFFont, text: string): string {
  const set = new Set((font as unknown as { getCharacterSet?: () => number[] }).getCharacterSet?.() ?? []);
  if (set.size === 0) return text.replace(/[^\x20-\x7e£]/g, "?");
  const swaps: Record<string, string> = { "−": "-", "×": "x", "÷": "/", "≤": "<=", "≥": ">=", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-" };
  return [...text].map((c) => (set.has(c.codePointAt(0)!) ? c : (swaps[c] ?? "?"))).join("");
}

export type Line =
  | { kind: "text"; text: string; font: PDFFont; size: number; colour: ReturnType<typeof rgb> }
  | { kind: "math"; tex: string; size: number; colour: ReturnType<typeof rgb>; label?: { text: string; font: PDFFont } };

interface Laid {
  line: Line;
  width: number;
  ascent: number;
  descent: number;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean).map((word) => drawable(font, word));
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= width || !current) current = trial;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Lays out lines for a width: text wraps, maths that will not fit (or fails to typeset) becomes text. Returns null if a formula is wider than the space. */
export function layOut(lines: Line[], width: number, font: PDFFont): Laid[] | null {
  const out: Laid[] = [];
  for (const line of lines) {
    if (line.kind === "math") {
      const shapes = mathShapes(line.tex);
      if (shapes) {
        const k = line.size / 1000;
        const labelWidth = line.label ? line.label.font.widthOfTextAtSize(line.label.text, line.size) + line.size * 0.4 : 0;
        if (labelWidth + shapes.width * k > width) return null;
        out.push({ line, width: labelWidth + shapes.width * k, ascent: Math.max(shapes.ascent * k, line.size * 0.8), descent: Math.max(shapes.descent * k, line.size * 0.25) });
        continue;
      }
      // MathJax could not typeset it: write the source as text rather than lose it.
      const plain = `${line.label ? `${line.label.text} ` : ""}${line.tex}`;
      for (const text of wrap(plain, font, line.size, width)) out.push({ line: { kind: "text", text, font, size: line.size, colour: line.colour }, width: font.widthOfTextAtSize(text, line.size), ascent: line.size * 0.8, descent: line.size * 0.25 });
      continue;
    }
    for (const text of wrap(line.text, line.font, line.size, width)) out.push({ line: { ...line, text }, width: line.font.widthOfTextAtSize(text, line.size), ascent: line.size * 0.8, descent: line.size * 0.25 });
  }
  return out;
}

export const heightOf = (laid: Laid[]) => laid.reduce((sum, l) => sum + (l.ascent + l.descent) * (LINE_GAP - 0.1) + 2, 0);

/** Draws laid-out lines from a top-left corner; returns the y below the last line. */
export function draw(page: PDFPage, laid: Laid[], x: number, top: number): number {
  let y = top;
  for (const l of laid) {
    y -= l.ascent * (LINE_GAP - 0.1) + 1;
    if (l.line.kind === "text") page.drawText(l.line.text, { x, y, size: l.line.size, font: l.line.font, color: l.line.colour });
    else {
      const shapes = mathShapes(l.line.tex)!;
      const k = l.line.size / 1000;
      let start = x;
      if (l.line.label) {
        page.drawText(l.line.label.text, { x, y, size: l.line.size, font: l.line.label.font, color: l.line.colour });
        start += l.line.label.font.widthOfTextAtSize(l.line.label.text, l.line.size) + l.line.size * 0.4;
      }
      const ox = start - shapes.minX * k;
      for (const d of shapes.paths) page.drawSvgPath(d, { x: ox, y, scale: k, color: l.line.colour, borderWidth: 0 });
      for (const r of shapes.rects) page.drawRectangle({ x: ox + r.x * k, y: y - (r.y + r.h) * k, width: r.w * k, height: r.h * k, color: l.line.colour, borderWidth: 0 });
    }
    y -= l.descent * (LINE_GAP - 0.1) + 1;
  }
  return y;
}

/** "\\pounds 68", "£68" or "\\$5": the sign moves into the label, the number stays maths. */
export function splitCurrency(tex: string): { sign: string; tex: string } {
  const m = /^\s*(?:\\pounds\s*|£|\\\$|\$|€|\\euro\s*)/.exec(tex);
  if (!m) return { sign: "", tex };
  const sign = /pounds|£/.test(m[0]) ? "£" : /euro|€/.test(m[0]) ? "€" : "$";
  return { sign, tex: tex.slice(m[0].length).trim() || "0" };
}

function answerLine(tex: string, size: number, font: PDFFont): Line {
  const { sign, tex: rest } = splitCurrency(tex);
  // Display style, so a fraction in the answer is full size rather than squeezed onto one line.
  return { kind: "math", tex: `\\displaystyle ${rest}`, size, colour: INK, label: { text: `Answer:${sign ? ` ${sign}` : ""}`, font } };
}

function answerLines(q: SolvedQuestion, font: PDFFont, size: number, withSteps: boolean): Line[] {
  const lines: Line[] = [];
  if (withSteps) {
    for (const step of q.steps) {
      if (step.say) lines.push({ kind: "text", text: step.say, font, size: size * 0.92, colour: INK });
      if (step.math) lines.push({ kind: "math", tex: step.math, size, colour: INK });
    }
  }
  if (q.finalAnswer) lines.push(answerLine(q.finalAnswer, size * 1.05, font));
  if (q.status === "failed" || q.status === "unsolved" || q.status === "unchecked") lines.push({ kind: "text", text: `(${STATUS_TEXT[q.status]})`, font, size: Math.max(MIN_SIZE, size * 0.85), colour: WARN });
  return lines;
}

export async function annotatePaper(original: Uint8Array, questions: SolvedQuestion[], mode: OutputMode = "hybrid"): Promise<{ pdf: Uint8Array; placements: Placement[]; workedPages: number[] }> {
  const source = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const hand = await doc.embedFont(fontBytes(), { subset: true });
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const copied = await doc.copyPages(source, source.getPageIndices());
  for (const page of copied) doc.addPage(page);
  const originalCount = copied.length;
  doc.setTitle("AI-generated worked solutions");
  doc.setProducer("LearnThrive Study Buddy");

  const placements: Placement[] = [];
  const needsWorked = new Set<string>();
  // The worked pages start after the paper: the first one's number, for references written on the paper.
  const workedStart = originalCount + 1;

  for (const q of questions) {
    if (mode === "worked") {
      needsWorked.add(q.id);
      continue;
    }
    const page = copied[q.page - 1];
    const bands = q.bands.length ? q.bands : q.answer ? [q.answer] : [];
    if (!page || bands.length === 0 || page.getRotation().angle % 360 !== 0) {
      // No measured space (a scan, a rotated page): the answer is only on the worked pages.
      needsWorked.add(q.id);
      continue;
    }
    let placed = false;
    // The working and the answer if they fit, else the answer alone; in the first band (nearest the question) that takes it, at the
    // largest size that fits, never below MIN_SIZE.
    for (const rect of bands) {
      const inner = { x: rect.x + 6, y: rect.y + 3, w: rect.w - 12, h: rect.h - 6 };
      for (const withSteps of [true, false]) {
        for (const size of SIZES) {
          const laid = layOut(answerLines(q, hand, size, withSteps), inner.w, hand);
          if (!laid || heightOf(laid) > inner.h) continue;
          const end = draw(page, laid, inner.x, inner.y + inner.h);
          placements.push({ questionId: q.id, page: q.page, rect: { x: inner.x, y: end, w: Math.max(...laid.map((l) => l.width)), h: inner.y + inner.h - end }, kind: "answer", size });
          placed = true;
          if (!withSteps || mode === "hybrid") needsWorked.add(q.id);
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    const inner = { x: bands[0]!.x + 6, y: bands[0]!.y + 3, w: bands[0]!.w - 12, h: bands[0]!.h - 6 };
    if (!placed) {
      needsWorked.add(q.id);
      // Too tight even for the answer: a short reference, if even that fits.
      const note = `See worked solutions, page ${workedStart}`;
      const size = MIN_SIZE;
      if (hand.widthOfTextAtSize(note, size) <= inner.w && size * 1.3 <= inner.h) {
        page.drawText(note, { x: inner.x, y: inner.y + inner.h - size, size, font: hand, color: INK });
        placements.push({ questionId: q.id, page: q.page, rect: { x: inner.x, y: inner.y + inner.h - size * 1.3, w: hand.widthOfTextAtSize(note, size), h: size * 1.3 }, kind: "reference", size });
      }
    }
  }

  // The label on every page of the paper.
  for (const page of copied) {
    const { width } = page.getSize();
    const label = "AI-generated worked solutions - may contain mistakes";
    page.drawText(label, { x: width / 2 - sans.widthOfTextAtSize(label, 7) / 2, y: 10, size: 7, font: sans, color: GREY });
  }

  // The worked-solution pages.
  const workedPages: number[] = [];
  const worked = questions.filter((q) => needsWorked.has(q.id));
  if (worked.length) {
    const [pw, ph] = copied[0] ? [copied[0].getWidth(), copied[0].getHeight()] : [595.28, 841.89];
    const margin = 48;
    const usable = pw - margin * 2;
    let page = doc.addPage([pw, ph]);
    workedPages.push(doc.getPageCount());
    let y = ph - margin;
    const header = () => {
      page.drawText("AI-generated worked solutions", { x: margin, y: y - 18, size: 18, font: bold, color: rgb(0.06, 0.16, 0.28) });
      y -= 26;
      const note = layOut([{ kind: "text", text: "Written by an AI and may contain mistakes. Answers marked as not confidently solved or not checked need a careful look.", font: sans, size: 9.5, colour: GREY }], usable, sans)!;
      y = draw(page, note, margin, y) - 12;
    };
    header();
    const newPage = () => {
      page = doc.addPage([pw, ph]);
      workedPages.push(doc.getPageCount());
      y = ph - margin;
      page.drawText("AI-generated worked solutions (continued)", { x: margin, y: y - 11, size: 11, font: bold, color: GREY });
      y -= 26;
    };
    for (const q of worked) {
      const blocks: Line[][] = [
        [{ kind: "text", text: `Question ${q.number}${q.marks ? ` (${q.marks} mark${q.marks === 1 ? "" : "s"})` : ""}`, font: bold, size: 13, colour: rgb(0.06, 0.16, 0.28) }],
        // The model's reading (a stacked fraction's text layer is scrambled), without a "Question 3 (2 marks)" the heading already says.
        [{ kind: "text", text: q.transcription.replace(/^\s*(?:question|q\.?)\s*\d{1,2}\s*(?:[([]\d{1,2}\s*marks?[)\]])?[\s.:)]*/i, "").trim() || q.text, font: sans, size: 9.5, colour: GREY }],
        [{ kind: "text", text: STATUS_TEXT[q.status] + (q.statusNote ? `. ${q.statusNote}` : ""), font: sans, size: 9, colour: q.status === "verified" || q.status === "checked_reading" ? rgb(0.07, 0.42, 0.26) : WARN }],
        ...q.steps.map((step): Line[] => [...(step.say ? [{ kind: "text" as const, text: step.say, font: hand, size: 13, colour: INK }] : []), ...(step.math ? [{ kind: "math" as const, tex: step.math, size: 13, colour: INK }] : [])]),
        ...(q.finalAnswer ? [[answerLine(q.finalAnswer, 14, hand)]] : [[{ kind: "text" as const, text: "No answer: this question was not confidently solved.", font: hand, size: 13, colour: WARN }]]),
        ...(q.explanation ? [[{ kind: "text" as const, text: q.explanation, font: hand, size: 12, colour: INK }]] : []),
      ];
      for (const [i, block] of blocks.entries()) {
        const laid = layOut(block, usable, hand) ?? layOut(block.map((l) => (l.kind === "math" ? { kind: "math" as const, tex: l.tex, size: 10, colour: l.colour } : l)), usable, hand) ?? layOut(block.map((l) => (l.kind === "math" ? { kind: "text" as const, text: l.tex, font: sans, size: 9, colour: l.colour } : l)), usable, sans)!;
        const height = heightOf(laid);
        if (y - height < margin) newPage();
        y = draw(page, laid, margin + (i >= 3 ? 10 : 0), y) - (i === 0 ? 2 : 5);
      }
      y -= 14;
      if (y > margin + 20) page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: pw - margin, y: y + 6 }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
    }
  }
  return { pdf: await doc.save(), placements, workedPages };
}
