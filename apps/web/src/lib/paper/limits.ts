/**
 * The Paper Tutor's size limits, in one place and from the environment (docs/ASSISTANT.md), so the upload check, the reader, the
 * question list and the output all agree. A paper beyond a limit is never quietly cut short: it is refused with the number, or (questions)
 * the first ones are kept and the rest are NAMED in the job's notice, so nobody is told a partial paper is complete.
 *
 *   PAPER_MAX_PAGES      pages a PDF may have (default 60: a full GCSE paper is 20 to 36; a booklet more)
 *   PAPER_MAX_QUESTIONS  question parts one paper may list (default 150)
 *   PAPER_RENDER_BATCH   pages drawn at a time while measuring answer space, so memory does not grow with the paper (default 6)
 *   PAPER_SCAN_LAYOUT    "false" turns off asking the vision model where a scan's answer spaces are (default on; answers then go on the worked pages)
 */
export interface PaperLimits {
  maxPages: number;
  maxQuestions: number;
  renderBatch: number;
  scanLayout: boolean;
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function paperLimits(env: Record<string, string | undefined> = process.env): PaperLimits {
  return { maxPages: int(env.PAPER_MAX_PAGES, 60, 1, 200), maxQuestions: int(env.PAPER_MAX_QUESTIONS, 150, 1, 500), renderBatch: int(env.PAPER_RENDER_BATCH, 6, 1, 20), scanLayout: env.PAPER_SCAN_LAYOUT !== "false" };
}
