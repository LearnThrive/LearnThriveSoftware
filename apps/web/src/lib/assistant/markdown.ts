/**
 * A small, safe Markdown reader for Study Buddy's answers (plan19 section 5.3): paragraphs, headings, bullet and numbered lists,
 * quotes, code blocks, bold, italic, inline code and LaTeX maths. It produces a plain tree, and the page turns the tree into React
 * elements, so there is NO raw HTML anywhere: an answer that contains `<script>` or `<img onerror=...>` shows those characters as
 * text. Links are not made clickable (the text is kept, the address is dropped): an AI answer must not be a way to send a child
 * to a web page. Maths is handed to KaTeX by the page, which is loaded only on this screen. Pure.
 */
export type Inline =
  | { t: "text"; text: string }
  | { t: "b"; children: Inline[] }
  | { t: "i"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "math"; tex: string }
  | { t: "br" };

export type Block =
  | { t: "p"; children: Inline[] }
  | { t: "h"; level: 3 | 4 | 5; children: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "math"; tex: string };

const MAX_MATH = 400;

/** Inline spans. Order matters: code first (nothing inside it is read), then maths, then emphasis. */
export function parseInline(source: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", text });
    text = "";
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const rest = source.slice(i);
    // `code`
    if (c === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // \( ... \)
    if (rest.startsWith("\\(")) {
      const end = source.indexOf("\\)", i + 2);
      if (end > i + 2 && end - i < MAX_MATH) {
        flush();
        out.push({ t: "math", tex: source.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    // $ ... $ : not a price. The opening $ is followed by a non-space, the closing one preceded by a non-space and not followed by a digit.
    if (c === "$" && source[i + 1] !== "$" && source[i + 1] !== undefined && !/\s/.test(source[i + 1]!)) {
      let end = i + 1;
      let found = -1;
      while ((end = source.indexOf("$", end)) >= 0 && end - i < MAX_MATH) {
        if (source[end - 1] !== "\\" && !/\s/.test(source[end - 1]!) && !/\d/.test(source[end + 1] ?? "")) {
          found = end;
          break;
        }
        end += 1;
      }
      if (found > i + 1) {
        flush();
        out.push({ t: "math", tex: source.slice(i + 1, found) });
        i = found + 1;
        continue;
      }
    }
    // **bold** and *italic* (and _italic_ at a word edge), limited in depth so nesting cannot run away.
    if (depth < 3 && (rest.startsWith("**") || rest.startsWith("__"))) {
      const mark = rest.slice(0, 2);
      const end = source.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", children: parseInline(source.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 3 && (c === "*" || c === "_") && source[i + 1] !== " " && source[i + 1] !== undefined && (c === "*" || !/\w/.test(source[i - 1] ?? " "))) {
      const end = source.indexOf(c, i + 1);
      if (end > i + 1 && source[end - 1] !== " " && (c === "*" || !/\w/.test(source[end + 1] ?? " "))) {
        flush();
        out.push({ t: "i", children: parseInline(source.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    // [label](address): keep the label only.
    if (c === "[") {
      const m = /^\[([^\]\n]{1,200})\]\(((?:[^()\n]|\([^()\n]*\)){0,500})\)/.exec(rest);
      if (m) {
        flush();
        out.push(...parseInline(m[1]!, depth + 1));
        i += m[0].length;
        continue;
      }
    }
    if (c === "\n") {
      flush();
      out.push({ t: "br" });
      i += 1;
      continue;
    }
    text += c;
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ t: "p", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*```(\w{0,20})\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i += 1;
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    // $$ ... $$ or \[ ... \], on one line or across a few.
    const open = /^\s*(\$\$|\\\[)/.exec(line);
    if (open) {
      const close = open[1] === "$$" ? "$$" : "\\]";
      let text = line.slice(open[0].length);
      let j = i;
      let closed = text.includes(close);
      while (!closed && j + 1 < lines.length && j - i < 20) {
        j += 1;
        text += " " + lines[j]!;
        closed = lines[j]!.includes(close);
      }
      if (closed) {
        const tex = text.slice(0, text.indexOf(close)).trim();
        if (tex && tex.length <= MAX_MATH * 2) {
          flushParagraph();
          blocks.push({ t: "math", tex });
          i = j + 1;
          continue;
        }
      }
    }
    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ t: "h", level: Math.min(5, Math.max(3, heading[1]!.length + 2)) as 3 | 4 | 5, children: parseInline(heading[2]!.trim()) });
      i += 1;
      continue;
    }
    const bullet = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? "ul" : "ol";
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = kind === "ul" ? /^\s{0,3}[-*+]\s+(.*)$/.exec(lines[i]!) : /^\s{0,3}\d{1,3}[.)]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i += 1;
      }
      blocks.push({ t: kind, items });
      continue;
    }
    if (/^\s{0,3}>\s?/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ t: "quote", children: parseInline(quoted.join("\n")) });
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

/** The words of a tree with the markup removed: what a screen reader announces and what "copy" puts on the clipboard if plain text is wanted. */
export function plainText(blocks: readonly Block[]): string {
  const inline = (nodes: readonly Inline[]): string => nodes.map((n) => (n.t === "text" || n.t === "code" ? n.text : n.t === "math" ? n.tex : n.t === "br" ? " " : inline(n.children))).join("");
  return blocks
    .map((b) => ("items" in b ? b.items.map(inline).join(". ") : b.t === "code" ? b.text : b.t === "math" ? b.tex : inline(b.children)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
