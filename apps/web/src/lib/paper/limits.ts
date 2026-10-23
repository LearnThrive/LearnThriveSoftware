/**
 * The Paper Tutor's size limits, in one place and from the environment (docs/ASSISTANT.md), so the upload check, the reader, the
 * question list and the output all agree. A paper beyond a limit is never quietly cut short: it is refused with the number, or (questions)
 * the first ones are kept and the rest are NAMED in the job's notice, so nobody is told a partial paper is complete.
 *
 *   PAPER_MAX_PAGES      pages a PDF may have (default 60: a full GCSE paper is 20 to 36; a booklet more)
 *   PAPER_MAX_QUESTIONS  question parts one paper may list (default 150)
 *   PAPER_RENDER_BATCH   pages drawn at a time while measuring answer space, so memory does not grow with the paper (default 6)
 *   PAPER_SCAN_LAYOUT    "false" turns off asking the vision model where a scan's answer spaces are (default on; answers then go on the worked pages)
 *   PAPER_CONTEXT        the model's context for solving (default 8192: a page picture, the working and a reasoning retry together do not fit 4096).
 *                        A different value from the chat's reloads the model once when the work changes kind, so keep them equal if both are busy.
 *   PAPER_MAX_TOKENS     tokens for one solution (default 1800: a four-mark solution with every line written out is about 600; the old 900 cut some short)
 *   PAPER_REASONING_TOKENS  tokens for a reasoning retry, thinking and answer together (default 3600)
 *   PAPER_CROSS_CHECK    "false" skips the second, independent attempt at a task read from a picture (default on: it is the only check on how a diagram was read)
 */
export interface PaperLimits {
  maxPages: number;
  maxQuestions: number;
  renderBatch: number;
  scanLayout: boolean;
  context: number;
  maxTokens: number;
  reasoningTokens: number;
  crossCheck: boolean;
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function paperLimits(env: Record<string, string | undefined> = process.env): PaperLimits {
  return { maxPages: int(env.PAPER_MAX_PAGES, 60, 1, 200), maxQuestions: int(env.PAPER_MAX_QUESTIONS, 150, 1, 500), renderBatch: int(env.PAPER_RENDER_BATCH, 6, 1, 20), scanLayout: env.PAPER_SCAN_LAYOUT !== "false", context: int(env.PAPER_CONTEXT, 8192, 2048, 32768), maxTokens: int(env.PAPER_MAX_TOKENS, 1800, 400, 6000), reasoningTokens: int(env.PAPER_REASONING_TOKENS, 3600, 800, 8000), crossCheck: env.PAPER_CROSS_CHECK !== "false" };
}
