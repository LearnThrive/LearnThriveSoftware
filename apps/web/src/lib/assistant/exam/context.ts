import { workOf } from "../research/works";
import { scoreSubjects, subjectById, type SubjectId } from "./subjects";

/**
 * What the student is doing and for which exam, worked out from the message, the recent conversation and anything they have set. The current message
 * wins over the history (a student can change subject mid-chat), and an explicit setting wins over a guess. Nothing here calls a model: it is a
 * handful of patterns, so it is quick, repeatable and testable, and when it is not sure it says so (confidence) rather than pretend.
 */
export type Board = "AQA" | "Edexcel" | "OCR" | "Eduqas" | "WJEC" | "CCEA";
export type Qualification = "GCSE" | "A-level" | "AS-level" | "KS3" | "IGCSE";
export type Activity = "mark_essay" | "exam_answer" | "quote_check" | "solve" | "revise" | "explain";

/**
 * How the student wants help with a question: "answer" (give it to me in full, a model answer, a worked solution), "guided" (work through it with me,
 * a hint, let me try) or "unspecified" (they did not say, so answer directly and offer to work through it; never assume they want to be guided).
 */
export type HelpMode = "answer" | "guided" | "unspecified";

export interface StudyContext {
  subject: SubjectId | null;
  subjectLabel: string | null;
  board: Board | null;
  qualification: Qualification | null;
  tier: "Foundation" | "Higher" | null;
  marks: number | null;
  commandWord: string | null;
  activity: Activity;
  mode: HelpMode;
  /** The set text, when it is one the tutor holds reviewed material for. */
  work: string | null;
  confidence: "high" | "medium" | "low";
  /** True when this message moved to a different subject from the one the conversation was in. */
  switched: boolean;
  /** Why each part was decided, for the logs and tests. */
  reasons: string[];
}

export interface HistoryItem {
  role: "user" | "assistant" | string;
  content: string;
}

export interface ContextSettings {
  subject?: SubjectId;
  board?: Board;
  qualification?: Qualification;
}

const BOARDS: Array<[Board, RegExp]> = [
  ["AQA", /\baqa\b/i],
  ["Edexcel", /\b(?:edexcel|pearson)\b/i],
  ["OCR", /\bocr\b/i],
  ["Eduqas", /\beduqas\b/i],
  ["WJEC", /\bwjec\b/i],
  ["CCEA", /\bccea\b/i],
];

const QUALIFICATIONS: Array<[Qualification, RegExp]> = [
  ["IGCSE", /\bi\s?gcse\b/i],
  ["AS-level", /\bas[- ]level\b/i],
  ["A-level", /\ba[- ]?level\b/i],
  ["GCSE", /\bgcse\b/i],
  ["KS3", /\b(?:ks3|key stage 3)\b/i],
];

const COMMAND_WORDS = ["how far do you agree", "show that", "to what extent", "evaluate", "explain", "describe", "compare", "analyse", "analyze", "discuss", "justify", "assess", "calculate", "state", "give", "name", "identify", "outline", "define", "suggest", "write", "prove", "sketch", "estimate", "comment on"];

export function marksIn(text: string): number | null {
  const m = /[[(]\s*(\d{1,2})\s*marks?\s*[\])]|\b(\d{1,2})\s*[- ]?marks?\b|\bworth\s+(\d{1,2})\b|\bout of\s+(\d{1,2})\b/i.exec(text);
  const n = Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4]);
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : null;
}

function activityOf(text: string, subject: SubjectId | null): Activity {
  if (/\b(?:is|are)\s+(?:this|that|these|my)\s+(?:quote|quotation)s?\s+(?:correct|accurate|right|real)|\bcheck\s+(?:my|the|these|this)\s+quot|\bwho\s+says\b|\bdid\s+\w+\s+(?:really\s+)?say\b/i.test(text)) return "quote_check";
  if (/\b(?:mark|grade|level|assess|rate|critique|give feedback|feedback on|improve)\b[^.\n]{0,40}\b(?:my|this|the)\b[^.\n]{0,30}\b(?:essay|answer|response|paragraph|work|writing)\b|\b(?:mark my|grade my|what (?:mark|grade|level) would)\b/i.test(text)) return "mark_essay";
  if (text.length > 900 && /\b(?:mark|grade|feedback|level|out of)\b/i.test(text) && subject?.startsWith("english")) return "mark_essay";
  if (/\b(?:quiz me|test me|flashcards?|revision (?:notes|plan)|revise|recap)\b/i.test(text)) return "revise";
  if (/\b(?:exam|past paper|model answer|mark scheme|marks?\b|command word|how many points|full marks)\b/i.test(text)) return "exam_answer";
  if (subject === "maths" || subject === "physics" || subject === "chemistry") if (/\b(?:solve|calculate|find|work out|factoris\w*|simplif\w*|expand|prove|show that)\b/i.test(text) || /\d\s*[+\-×x*/÷^=]\s*\d/.test(text)) return "solve";
  return "explain";
}

// Refusing the answer, or asking for a hint or a turn at it, is the clearest sign of all.
const GUIDED = /\b(?:work(?:ing)? (?:it |this |that )?through|walk (?:me )?through|talk (?:me )?through|guide me|(?:give me|just) a hint|hints?\b|(?:do ?n['’]?t|do not|without)\s+(?:give|tell|giving|telling|show|showing)\b[^.\n]{0,25}\b(?:answer|solution)|let me (?:try|have a go|work)|i (?:want|would like|'d like) to (?:try|work (?:it|this|that) out|figure)|(?:help|teach) me (?:to )?(?:work|figure|understand|learn|do)\b|one step at a time|quiz me|test me)\b/i;
const ANSWER = /\b(?:model answers?|sample answers?|example answers?|exemplar|worked (?:solution|answer|example)s?|(?:full|complete|whole) (?:answer|solution|working|response)|(?:top|full)[- ]marks? (?:answer|response)|(?:level|grade) \d+ (?:answer|response)|(?:just |please )?(?:give|tell|show|send|write) me (?:the |an? )?(?:model |full |complete |final |correct |worked )?(?:answer|solution|working|response|paragraph)s?|what(?:'s| is| are) the (?:correct |final )?answers?|(?:answer|solve|do|write) (?:this|that|it)(?: for me| please|\b)|i just (?:want|need) the answer|how would (?:you|a student) answer)\b/i;

export function helpModeOf(text: string, history: readonly HistoryItem[] = []): HelpMode {
  // "No hints" and "without a hint" ask for the opposite of a hint.
  const asked = text.replace(/\b(?:no|without|skip(?: the)?|not|do(?:n['’]?t| not) (?:need|want)(?: any)?)\s+(?:a\s+)?hints?\b/gi, " ");
  if (GUIDED.test(asked)) return "guided";
  if (ANSWER.test(text)) return "answer";
  // A student already being guided who replies with an attempt is still being guided; being given an answer is a one-off.
  const earlier = history.filter((m) => m.role === "user").slice(-2);
  return earlier.length && earlier.some((m) => GUIDED.test(m.content)) && !earlier.some((m) => ANSWER.test(m.content)) ? "guided" : "unspecified";
}

function detectSubject(text: string): { id: SubjectId; score: number; margin: number } | null {
  const scored = scoreSubjects(text);
  const top = scored[0];
  if (!top || top.score < 2) return null;
  return { id: top.id, score: top.score, margin: top.score - (scored[1]?.score ?? 0) };
}

export function detectStudyContext(text: string, options: { history?: readonly HistoryItem[]; settings?: ContextSettings } = {}): StudyContext {
  const reasons: string[] = [];
  const settings = options.settings ?? {};
  const recent = (options.history ?? []).slice(-8);
  const past = recent.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const pastAll = recent.map((m) => m.content).join("\n");

  let subject: SubjectId | null = null;
  let confidence: StudyContext["confidence"] = "low";
  let switched = false;
  const current = detectSubject(text);
  const earlier = detectSubject(past || pastAll);
  if (settings.subject) {
    subject = settings.subject;
    confidence = "high";
    reasons.push("subject set by the student");
  } else if (current) {
    subject = current.id;
    confidence = current.margin >= 3 ? "high" : "medium";
    reasons.push(`subject from this message (${current.id}, score ${current.score})`);
    if (earlier && earlier.id !== current.id && earlier.score >= 3) {
      switched = true;
      reasons.push(`changed from ${earlier.id}`);
    }
  } else if (earlier) {
    subject = earlier.id;
    confidence = earlier.margin >= 3 ? "medium" : "low";
    reasons.push(`subject carried on from earlier in the chat (${earlier.id})`);
  }

  const find = <T>(table: Array<[T, RegExp]>, setting?: T): T | null => {
    if (setting) return setting;
    for (const source of [text, past]) for (const [value, re] of table) if (re.test(source)) return value;
    return null;
  };
  const board = find(BOARDS, settings.board);
  const qualification = find(QUALIFICATIONS, settings.qualification);
  const tier = /\bhigher\b(?:\s+tier)?/i.test(text) && subject === "maths" ? "Higher" : /\bfoundation\b(?:\s+tier)?/i.test(text) && subject === "maths" ? "Foundation" : null;
  const lower = text.toLowerCase();
  const commandWord = COMMAND_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(lower)) ?? null;
  const work = workOf(text) ?? (subject === "english_literature" ? workOf(past) : null);
  if (board) reasons.push(`board ${board}`);
  const activity = activityOf(text, subject);

  return {
    subject,
    subjectLabel: subject ? subjectById(subject).label : null,
    board,
    qualification,
    tier,
    marks: marksIn(text),
    commandWord,
    activity,
    mode: helpModeOf(text, recent),
    work,
    confidence,
    switched,
    reasons,
  };
}
