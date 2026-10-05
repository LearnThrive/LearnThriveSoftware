/**
 * PDF export of approved lesson reports (plan17 C19). A pure builder: no I/O, no framework, no dependency.
 * It writes a minimal PDF 1.4 (A4, the built-in Helvetica faces, WinAnsi text), which every reader opens.
 *
 * PRIVACY BY CONSTRUCTION. The input type is the parent-visible subset (`PdfReport`), and the builder copies
 * only the named fields below into the page; it never iterates over the object it is given. A tutor's
 * `internalTutorNotes` and `confidence` therefore cannot reach the file even if a caller passes a whole
 * `LessonReport` (tests/reportPdf.test.mjs does exactly that). The route is the other half: it filters with
 * `visibleReportFor` and sends approved reports only.
 */
export interface PdfReport {
  title: string;
  subject: string;
  /** "Tue 3 Nov 2026", already formatted in the scheduling zone by the caller. */
  dateLabel: string;
  tutorName: string;
  studentNames: string;
  publicSummary: string;
  progress?: string;
  areasForImprovement?: string;
  nextSteps?: string;
  engagement?: string;
}

export interface PdfDocumentInfo {
  /** The heading on the first page, e.g. "Lesson report" or "Progress reports for Ava". */
  heading: string;
  brand: string;
  /** "Created 5 October 2026": the caller formats it. */
  footer: string;
}

// Helvetica advance widths (per 1000 em) for ASCII 32..126, from the standard AFM metrics.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];

// The Windows-1252 code points above 0x7F that British text actually uses.
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
};

/** One byte per character: ASCII and Latin-1 as they are, the cp1252 punctuation above, anything else "?". */
function toBytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out.push(0x20);
    else if (code >= 0x20 && code <= 0x7e) out.push(code);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else out.push(WIN_ANSI[ch] ?? 0x3f);
  }
  return out;
}

function width(bytes: number[], size: number, bold: boolean): number {
  let sum = 0;
  for (const b of bytes) sum += b >= 32 && b <= 126 ? W[b - 32] : 556;
  return (sum * size * (bold ? 1.06 : 1)) / 1000;
}

function wrap(text: string, size: number, maxWidth: number, bold = false): number[][] {
  const lines: number[][] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line: number[] = [];
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const bytes = toBytes(word);
      const next = line.length ? [...line, 0x20, ...bytes] : bytes;
      if (line.length && width(next, size, bold) > maxWidth) {
        lines.push(line);
        line = bytes;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const escapeByte = (b: number) => (b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b > 0x7e ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b));

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const TEXT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64;

export function buildReportsPdf(reports: PdfReport[], info: PdfDocumentInfo): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE_H - MARGIN;
  const ops = () => pages[pages.length - 1];
  const newPage = () => { pages.push([]); y = PAGE_H - MARGIN; };
  const line = (bytes: number[], size: number, bold: boolean, gray = 0.1) => {
    if (y - size < BOTTOM) newPage();
    ops().push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g ${MARGIN} ${y - size} Td (${bytes.map(escapeByte).join("")}) Tj ET`);
    y -= size * 1.35;
  };
  const block = (text: string, size: number, bold = false, gray = 0.1) => { for (const l of wrap(text, size, TEXT_W, bold)) line(l, size, bold, gray); };
  const rule = () => { if (y - 12 < BOTTOM) newPage(); ops().push(`0.8 G 0.5 w ${MARGIN} ${y - 4} m ${PAGE_W - MARGIN} ${y - 4} l S`); y -= 14; };

  block(info.brand, 11, true, 0.25);
  y -= 4;
  block(info.heading, 20, true);
  y -= 6;
  reports.forEach((r, i) => {
    if (i > 0) { y -= 6; rule(); }
    if (y < PAGE_H / 2 && i > 0) newPage();
    block(r.title, 14, true);
    block([r.subject, r.dateLabel, `Tutor: ${r.tutorName}`].filter(Boolean).join("  ·  "), 10, false, 0.35);
    if (r.studentNames) block(`Student: ${r.studentNames}`, 10, false, 0.35);
    y -= 6;
    const section = (label: string, body?: string) => {
      if (!body?.trim()) return;
      block(label, 10, true, 0.3);
      block(body, 11);
      y -= 5;
    };
    section("Summary", r.publicSummary);
    section("Progress", r.progress);
    section("Engagement", r.engagement);
    section("Areas to improve", r.areasForImprovement);
    section("Next steps", r.nextSteps);
  });

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES"); // patched below
  const font1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const font2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const footerBytes = toBytes(info.footer).map(escapeByte).join("");
  const pageIds: number[] = [];
  pages.forEach((content, index) => {
    const footer = `BT /F1 8 Tf 0.5 g ${MARGIN} 32 Td (${footerBytes}  -  Page ${index + 1} of ${pages.length}) Tj ET`;
    const stream = [...content, footer].join("\n");
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentId} 0 R >>`));
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  // Every character in the file is one byte (the stream text is escaped to ASCII above), so string length == byte length.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}
