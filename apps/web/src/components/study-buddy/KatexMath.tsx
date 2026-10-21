"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

/**
 * One piece of maths, drawn by KaTeX. This module (KaTeX and its stylesheet and fonts, all served from this site) is loaded only
 * on the Study Buddy screen and only when an answer contains maths. KaTeX's output is HTML it generates itself from the formula;
 * `trust` is off (no links, no raw HTML, no commands that fetch anything), the size and macro expansion are capped, and a formula
 * it cannot read is shown as plain text instead of an error.
 */
export default function KatexMath({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "htmlAndMathml", trust: false, strict: "ignore", maxSize: 12, maxExpand: 200, errorColor: "currentColor" });
    } catch {
      return null;
    }
  }, [tex, display]);
  if (html === null) return <code>{tex}</code>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
