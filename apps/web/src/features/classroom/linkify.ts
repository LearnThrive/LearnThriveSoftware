export type TextPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/**
 * Splits a chat message into plain text and web links, so a pasted address becomes clickable. Only http and https links count (never javascript:, data:,
 * file: or mailto:), the text is never treated as HTML (the parts are drawn by React as text), and punctuation that ends a sentence is left outside the
 * link ("see https://example.com/page." links to the page, not "page."). A link that does not parse as a real address stays as plain text.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
  let from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    let raw = match[0];
    // Closing brackets belong to the link only if it opened one ("https://en.wikipedia.org/wiki/Pi_(number)").
    while (/[.,;:!?'")\]}]$/.test(raw)) {
      const last = raw[raw.length - 1]!;
      if ((last === ')' && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) || (last === ']' && (raw.match(/\[/g)?.length ?? 0) >= (raw.match(/\]/g)?.length ?? 0))) break;
      raw = raw.slice(0, -1);
    }
    let href: string | null = null;
    try {
      const url = new URL(raw);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) href = url.href;
    } catch { /* not an address */ }
    if (!href) continue;
    if (match.index > from) parts.push({ kind: 'text', text: text.slice(from, match.index) });
    parts.push({ kind: 'link', text: raw, href });
    from = match.index + raw.length;
    pattern.lastIndex = from;
  }
  if (from < text.length) parts.push({ kind: 'text', text: text.slice(from) });
  return parts.length ? parts : [{ kind: 'text', text }];
}
