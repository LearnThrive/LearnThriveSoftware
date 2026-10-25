import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { draw, fontBytes, GREY, heightOf, layOut, type Line } from "./annotate";
import { OUTCOME_TEXT, summarise, totalsLine, type MarkedQuestion, type Outcome } from "./mark";

/**
 * The marked copy: the student's own pages exactly as uploaded (copied, never re-drawn), a small symbol in the left margin beside
 * each question the AI could judge, and feedback pages added at the end. Every page says the marks are the AI's estimates. Nothing
 * is written over the student's work: the symbols sit in the margin, and only where the paper's text layer says where the question is.
 */
const TICK = rgb(0.07, 0.42, 0.26);
const CROSS = rgb(0.72, 0.15, 0.15);
const PARTLY = rgb(0.75, 0.45, 0.02);
const NAVY = rgb(0.06, 0.16, 0.28);
const INK = rgb(0.07, 0.24, 0.62);

const COLOUR: Record<Outcome, ReturnType<typeof rgb>> = { correct: TICK, partly: PARTLY, incorrect: CROSS, needs_checking: GREY, no_answer: GREY };

function symbol(page: PDFPage, outcome: Outcome, x: number, y: number) {
  const colour = COLOUR[outcome];
  if (outcome === "correct") {
    page.drawLine({ start: { x, y: y + 5 }, end: { x: x + 4, y }, thickness: 1.6, color: colour });
    page.drawLine({ start: { x: x + 4, y }, end: { x: x + 11, y: y + 12 }, thickness: 1.6, color: colour });
  } else if (outcome === "incorrect") {
    page.drawLine({ start: { x, y }, end: { x: x + 10, y: y + 10 }, thickness: 1.6, color: colour });
    page.drawLine({ start: { x, y: y + 10 }, end: { x: x + 10, y }, thickness: 1.6, color: colour });
  } else if (outcome === "partly") {
    // A tick with a dot beside it: some credit, not all.
    page.drawLine({ start: { x, y: y + 5 }, end: { x: x + 4, y }, thickness: 1.4, color: colour });
    page.drawLine({ start: { x: x + 4, y }, end: { x: x + 10, y: y + 11 }, thickness: 1.4, color: colour });
    page.drawCircle({ x: x + 14, y: y + 2, size: 1.6, color: colour });
  } else {
    page.drawCircle({ x: x + 5, y: y + 5, size: 5, borderColor: colour, borderWidth: 1.2 });
  }
}

export async function markPaper(original: Uint8Array, marked: MarkedQuestion[], options: { withScheme: boolean; showMarks?: boolean }): Promise<{ pdf: Uint8Array; feedbackPages: number[] }> {
  const showMarks = options.showMarks ?? true;
  const source = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const hand = await doc.embedFont(fontBytes(), { subset: true });
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const copied = await doc.copyPages(source, source.getPageIndices());
  for (const page of copied) doc.addPage(page);
  doc.setTitle("AI-estimated feedback on a completed paper");
  doc.setProducer("LearnThrive AI");

  for (const q of marked) {
    const page = copied[q.page - 1];
    // Only where the question's place is known (a text layer) and the margin is wide enough for the symbol: never over the work.
    if (!page || !q.box || q.box.x < 26 || page.getRotation().angle % 360 !== 0) continue;
    symbol(page, q.outcome, q.box.x - 22, q.box.y + q.box.h - 12);
  }
  for (const page of copied) {
    const { width } = page.getSize();
    const label = showMarks ? "AI-estimated feedback - not an official mark" : "AI feedback - no marks shown";
    page.drawText(label, { x: width / 2 - sans.widthOfTextAtSize(label, 7) / 2, y: 10, size: 7, font: sans, color: GREY });
  }

  const [pw, ph] = copied[0] ? [copied[0].getWidth(), copied[0].getHeight()] : [595.28, 841.89];
  const margin = 48;
  const usable = pw - margin * 2;
  const feedbackPages: number[] = [];
  let page = doc.addPage([pw, ph]);
  feedbackPages.push(doc.getPageCount());
  let y = ph - margin;
  const text = (lines: Line[], x = margin, gap = 5) => {
    const laid = layOut(lines, usable - (x - margin), hand) ?? layOut(lines.map((l) => (l.kind === "math" ? { kind: "text" as const, text: l.tex, font: sans, size: 9, colour: l.colour } : l)), usable, sans)!;
    if (y - heightOf(laid) < margin) {
      page = doc.addPage([pw, ph]);
      feedbackPages.push(doc.getPageCount());
      y = ph - margin;
      page.drawText("AI-estimated feedback (continued)", { x: margin, y: y - 11, size: 11, font: bold, color: GREY });
      y -= 26;
    }
    y = draw(page, laid, x, y) - gap;
  };

  page.drawText("Feedback on your paper", { x: margin, y: y - 18, size: 18, font: bold, color: NAVY });
  y -= 30;
  const s = summarise(marked);
  text([{ kind: "text", text: `${showMarks ? "These marks are AI estimates, not official marks." : "No marks are shown: this checker has not yet been validated against work marked by a qualified person, so it gives feedback only."}${options.withScheme ? " The mark scheme you supplied was confirmed as this paper's and used, but this is not an examiner's decision." : " There was no confirmed mark scheme, so the AI worked out its own answers, checked them by calculation, and used a provisional rubric."} A question the AI could not read or check is marked "needs checking", not wrong.`, font: sans, size: 9.5, colour: GREY }], margin, 8);
  text([{ kind: "text", text: `${s.correct} correct, ${s.partly} partly right, ${s.incorrect} not right, ${s.needsChecking} needing checking, ${s.noAnswer} with no answer found.`, font: bold, size: 11, colour: NAVY }], margin, 4);
  if (showMarks) text([{ kind: "text", text: totalsLine(s.totals), font: sans, size: 10, colour: NAVY }], margin, 12);

  for (const q of marked) {
    const marks = !showMarks ? "" : q.estimate !== null && q.outOf !== null ? ` - AI-estimated ${q.estimate} of ${q.outOf} marks (${q.assessment.basis === "scheme" ? "official scheme" : "provisional rubric"})` : q.assessment.marks.pending > 0 ? ` - ${q.assessment.marks.pending} mark${q.assessment.marks.pending === 1 ? "" : "s"} waiting for a person` : q.outOf ? ` - ${q.outOf} marks on the paper, not estimated` : "";
    text([{ kind: "text", text: `Question ${q.number}: ${OUTCOME_TEXT[q.outcome]}${marks}`, font: bold, size: 12, colour: COLOUR[q.outcome] }], margin, 3);
    if (q.student.answer) text([{ kind: "text", text: "You wrote:", font: sans, size: 9, colour: GREY }, { kind: "math", tex: q.student.answer, size: 12, colour: GREY }], margin + 10, 3);
    if (q.reference.finalAnswer && q.outcome !== "needs_checking") text([{ kind: "text", text: "Checked answer:", font: sans, size: 9, colour: GREY }, { kind: "math", tex: q.reference.finalAnswer, size: 12, colour: INK }], margin + 10, 3);
    text([{ kind: "text", text: q.feedback || q.reason, font: hand, size: 12.5, colour: INK }], margin + 10, q.assessment.review ? 3 : 12);
    if (q.assessment.review) text([{ kind: "text", text: `Needs a person: ${q.assessment.review.why}`, font: sans, size: 9, colour: GREY }], margin + 10, 12);
  }
  return { pdf: await doc.save(), feedbackPages };
}
