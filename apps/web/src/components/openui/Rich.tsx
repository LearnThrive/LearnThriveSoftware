"use client";

import dynamic from "next/dynamic";
import { Fragment, type ReactNode } from "react";
import { parseInline, type Inline } from "@/lib/assistant/markdown";
import styles from "./openui.module.css";

// KaTeX (and its fonts) arrive only when something on the page has maths in it, exactly as for an ordinary answer.
export const KatexMath = dynamic(() => import("../study-buddy/KatexMath"), { ssr: false, loading: () => <span className={styles.mathPending}>…</span> });

function render(nodes: readonly Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "b":
        return <strong key={i}>{render(n.children)}</strong>;
      case "i":
        return <em key={i}>{render(n.children)}</em>;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "math":
        return <KatexMath key={i} tex={n.tex} display={false} />;
      case "br":
        return <br key={i} />;
    }
  });
}

/**
 * A short piece of text a component shows (a label, a table cell, a quiz option): Markdown emphasis and maths between $ signs, drawn as React elements,
 * never as HTML (lib/assistant/markdown.ts). A model-written string is data here, not markup.
 */
export function Rich({ text }: { text: unknown }) {
  if (typeof text !== "string" || !text) return null;
  return <>{render(parseInline(text))}</>;
}
