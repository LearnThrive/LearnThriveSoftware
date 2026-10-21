"use client";

import dynamic from "next/dynamic";
import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/assistant/markdown";
import styles from "./study-buddy.module.css";

// KaTeX (and its fonts) arrive only when an answer actually has maths in it.
const KatexMath = dynamic(() => import("./KatexMath"), { ssr: false, loading: () => <span className={styles.mathPending}>…</span> });

function inline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "b":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "i":
        return <em key={i}>{inline(n.children)}</em>;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "math":
        return <KatexMath key={i} tex={n.tex} display={false} />;
      case "br":
        return <br key={i} />;
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={i}>{inline(b.children)}</p>;
    case "h": {
      const H = (`h${b.level}` as "h3" | "h4" | "h5");
      return <H key={i}>{inline(b.children)}</H>;
    }
    case "ul":
      return (
        <ul key={i}>
          {b.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i}>
          {b.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ol>
      );
    case "quote":
      return <blockquote key={i}>{inline(b.children)}</blockquote>;
    case "code":
      return (
        <pre key={i}>
          <code>{b.text}</code>
        </pre>
      );
    case "math":
      return (
        <div key={i} className={styles.display}>
          <KatexMath tex={b.tex} display />
        </div>
      );
  }
}

/** An answer as safe React elements: Markdown and maths, never raw HTML (lib/assistant/markdown.ts). */
export function RenderedAnswer({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={styles.answer}>{blocks.map(block)}</div>;
}
