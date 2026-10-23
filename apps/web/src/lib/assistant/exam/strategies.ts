import { describeFrame, markFrame } from "./marking";
import type { StudyContext } from "./context";
import { subjectById } from "./subjects";

/**
 * What is added to the tutor's instructions for ONE turn, from what was detected about it. Nothing is added when nothing was detected, so a
 * greeting or a general question costs no extra instruction tokens. The text never contains the student's words, only fixed wording chosen here.
 */
const ACTIVITY: Record<StudyContext["activity"], string[]> = {
  mark_essay: [
    "The student wants feedback on their own writing. Judge it against the assessment objectives, name what is working with a short quote from THEIR work, and give two or three specific improvements.",
    "Give a mark per objective with its maximum (for example \"AO1: 9/12\"), then a total. Say that this is practice feedback, not an official mark.",
    "Do not be generous to be kind: a mark must be justified by what is actually on the page.",
  ],
  exam_answer: [
    "Write the answer the way a high-scoring exam answer is written: match its length and depth to the marks, answer the command word, and stop when the marks are covered.",
    "If a mark scheme is not in front of you, do not claim what it says; describe what a good answer includes and say it is a model, not the board's wording.",
  ],
  quote_check: [
    "The student wants a quotation checked. Use the verification results. Call a quotation correct only if verification says so; otherwise say it could not be confirmed and, if the real wording is given, show it.",
  ],
  solve: ["Work through it in steps and check the result by substituting back or with a second method before stating it."],
  revise: ["Keep it active: short chunks, one question at a time, and wait for the student's attempt before revealing the answer."],
  explain: [],
};

export function strategyBlock(ctx: StudyContext, options: { researchAvailable?: boolean; essay?: string } = {}): string {
  const subject = ctx.subject ? subjectById(ctx.subject) : null;
  const activity = ACTIVITY[ctx.activity];
  if (!subject && !activity.length && !ctx.board && !ctx.marks) return "";
  const lines: string[] = ["", "THIS TURN"];
  const facts = [
    subject ? `subject ${subject.label}${ctx.confidence === "low" ? " (a guess; ask if it matters)" : ""}` : null,
    ctx.qualification ? `qualification ${ctx.qualification}` : null,
    ctx.board ? `exam board ${ctx.board}` : null,
    ctx.tier ? `${ctx.tier} tier` : null,
    ctx.work ? `set text ${ctx.work}` : null,
    ctx.marks ? `${ctx.marks} marks` : null,
    ctx.commandWord ? `command word "${ctx.commandWord}"` : null,
  ].filter(Boolean);
  if (facts.length) lines.push(`Detected: ${facts.join("; ")}. Use it only if it fits what the student asked; if the student says otherwise, believe the student.`);
  if (ctx.switched) lines.push("The student has moved to a different subject. Answer for the new one and do not carry over the old one's assumptions.");
  if (subject) {
    lines.push(`${subject.label} method:`, ...subject.strategy.map((s) => `- ${s}`), ...subject.checks.map((s) => `- ${s}`));
  }
  if (activity.length) lines.push(...activity.map((s) => `- ${s}`));
  const frame = ctx.activity === "mark_essay" ? markFrame(ctx, options.essay ?? "") : null;
  if (frame) lines.push(`Marking frame: ${describeFrame(frame)}`);
  else if (ctx.activity === "mark_essay") lines.push("- The exam board or the question's mark total is not known, so give feedback by the general assessment objectives and ask which board and mark total apply before giving a mark.");
  if (ctx.board && !options.researchAvailable) lines.push(`- You cannot look up ${ctx.board}'s documents in this chat. Do not quote or paraphrase a specification or mark scheme as if you had read it.`);
  lines.push("- Accuracy first: if you are not sure of a fact, a date, a quotation or a figure, say so plainly instead of guessing. A shorter correct answer beats a longer one with an invented detail.");
  return lines.join("\n");
}
