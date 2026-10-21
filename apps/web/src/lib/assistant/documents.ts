import { createCanvas, ImageData, type Canvas } from "@napi-rs/canvas";
import type { FileProblem } from "@/lib/careers-files";

/**
 * Reads what a student uploads so the model sees what the student sees (Study Buddy document understanding).
 *
 * PDFs go through pdf.js (Apache-2.0, the reader Firefox uses), page by page:
 *   - the text layer is read WITH positions and rebuilt into lines in reading order, page by page, so nothing loses its page;
 *   - its quality is judged by words, not by characters: a font without a text map comes out as letters that look fine and mean
 *     nothing ("3HUFHQWDJHV" for "Percentages"), and that must count as unreadable text, not as good text;
 *   - a page is also RENDERED to a picture (@napi-rs/canvas, MIT) when its text is missing or poor (a scan, outlined text), when
 *     it has pictures on it (a diagram, a photo, a table drawn as an image), or when its maths is laid out in a way plain text
 *     loses (a fraction stacked over a line comes out as "3 4"). The vision model reads those pictures. A text-only model cannot,
 *     and the chat service refuses rather than pretend (see service.ts).
 * Photos are decoded with their orientation applied, so a phone's sideways portrait arrives upright, shrunk to a sensible size and
 * re-encoded, which also drops every byte of metadata (camera, GPS position, time).
 *
 * Everything here is untrusted input. pdf.js is run with script evaluation off and system fonts off; page count, size and total time
 * are bounded; nothing is written to disk. Text that comes out of a document is material for the model to read, never instructions.
 */

// Loaded on first use: pdf.js is large and only the assistant needs it. The legacy build is the one meant for Node.
type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
const pdfjs = () => (pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs"));

export const DOCUMENT_LIMITS = {
  /** Pages sent to the model as pictures in one message: each costs context, and the local model has 8k tokens. */
  imagesPerMessage: 3,
  /** Long side of a rendered page, in pixels: enough for exam-paper print. */
  renderLongSide: 1400,
  /** Long side of a photo after resizing. */
  photoLongSide: 1600,
  /** Text kept per page, and in all, for the model. */
  pageTextChars: 4000,
  totalTextChars: 12_000,
  /** The most one document may take to read. */
  totalMs: 25_000,
} as const;

export type TextQuality = "good" | "poor" | "none";

export interface PageReading {
  number: number;
  text: string;
  textQuality: TextQuality;
  /** Images on the page (a scan, a photo, a diagram drawn as a picture). */
  hasPictures: boolean;
  /** Short numbers stacked over each other (fractions, indices): the text layer alone may mislead. */
  stackedMaths: boolean;
  /** A rendered picture of the page (JPEG), when one was made. */
  image: Uint8Array | null;
  /** The text lines with their boxes, and the page's size and rotation (PDF units): for placing answers on the original. */
  lines: LineBox[];
  width: number;
  height: number;
  rotation: number;
  /** Where the visible page starts in PDF coordinates (the crop box's lower-left corner; usually 0, 0). */
  originX: number;
  originY: number;
}

export type PdfReading =
  | { ok: true; pageCount: number; pages: PageReading[]; shownAsImages: number[]; textOnly: number[] }
  | { ok: false; problem: FileProblem };

const problem = (code: FileProblem["code"], message: string): { ok: false; problem: FileProblem } => ({ ok: false, problem: { code, message } });

export const DOCUMENT_MESSAGES = {
  locked: "This PDF needs a password to open. Please save a copy without the password (or print it to a new PDF) and upload that.",
  damaged: "This PDF looks damaged, so we could not open it. Please download or save it again and upload the new copy.",
  blank: "We opened that PDF but every page looks empty. If you can see questions on it, please print it to a new PDF or send a photo of the page.",
  slow: "That PDF took too long to read. Please send just the pages you need, or a photo of the page.",
  photo: "We could not open that photo. Please take it again, or send a screenshot.",
} as const;

// ---- reading the text layer --------------------------------------------------------------------------------------

/** Words that occur in almost any school text. A page of real words has some; text from a broken font map has none. */
const COMMON_WORDS = new Set(
  "the a an and or of to in on is are be it its that this for with as at by from what which who how why when where work out find show give your you answer question questions solve calculate write explain use using value values number numbers each total marks mark diagram not if then there one two three four five six".split(
    " ",
  ),
);

export function textQuality(text: string): TextQuality {
  const visible = text.replace(/\s+/g, "");
  if (visible.length < 3) return "none";
  // Replacement characters, private-use glyphs and control characters: a font with no usable text map.
  const junk = (visible.match(/[\p{Co}\p{Cc}�]/gu) ?? []).length;
  if (junk / visible.length > 0.05) return "poor";
  const words = text.toLowerCase().match(/\p{L}{2,}/gu) ?? [];
  if (words.length >= 3) {
    const common = words.filter((w) => COMMON_WORDS.has(w)).length;
    if (common === 0 || common / words.length < 0.04) return "poor";
  }
  return "good";
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rebuilds lines from positioned text items: top to bottom, left to right, a space where there is a visible gap. Also reports
 * whether short items sit stacked over each other in the same column, which is how a fraction or an index is drawn.
 */
/** A line of text with its box, in PDF units (origin bottom-left, as the page's own coordinates). */
export interface LineBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function layoutText(items: Item[]): { text: string; stackedMaths: boolean; lines: LineBox[] } {
  const usable = items.filter((i) => i.str.trim() !== "");
  const rows: Item[][] = [];
  for (const item of [...usable].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => r.some((other) => Math.abs(other.y - item.y) < Math.max(2, Math.max(other.h, item.h) * 0.5)));
    if (row) row.push(item);
    else rows.push([item]);
  }
  const boxes: LineBox[] = [];
  const lines = rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    const left = Math.min(...row.map((i) => i.x));
    const right = Math.max(...row.map((i) => i.x + i.w));
    const bottom = Math.min(...row.map((i) => i.y));
    const top = Math.max(...row.map((i) => i.y + i.h));
    // The row's own size and baseline come from its largest text; smaller text raised above it is an index (x^5), below it a subscript.
    const size = Math.max(...row.map((i) => i.h));
    const base = row.filter((i) => i.h >= size * 0.9).reduce((sum, i, _, all) => sum + i.y / all.length, 0);
    let line = "";
    let end = -Infinity;
    for (const item of row) {
      const gap = item.x - end;
      const small = item.h < size * 0.85;
      const raised = small && item.y - base > size * 0.2;
      const lowered = small && base - item.y > size * 0.12;
      if (!raised && !lowered && line && gap > Math.max(1, item.h * 0.15) && !line.endsWith(" ") && !item.str.startsWith(" ")) line += " ";
      const str = item.str.trim();
      line += raised ? `^${str.length > 1 ? `(${str})` : str}` : lowered ? `_${str.length > 1 ? `(${str})` : str}` : item.str;
      end = item.x + item.w;
    }
    const text = line.replace(/\s+/g, " ").trim();
    if (text) boxes.push({ text, x: left, y: bottom, w: right - left, h: top - bottom });
    return text;
  });

  const short = usable.filter((i) => /^\s*[\p{L}\p{N}.()+\-−]{1,4}\s*$/u.test(i.str));
  let stackedMaths = false;
  for (let a = 0; a < short.length && !stackedMaths; a += 1) {
    for (let b = 0; b < short.length; b += 1) {
      const top = short[a]!;
      const bottom = short[b]!;
      const dy = top.y - bottom.y;
      const size = Math.max(top.h, bottom.h, 1);
      const overlap = Math.min(top.x + top.w, bottom.x + bottom.w) - Math.max(top.x, bottom.x);
      if (dy > size * 0.4 && dy < size * 1.8 && overlap > Math.min(top.w, bottom.w) * 0.5) {
        stackedMaths = true;
        break;
      }
    }
  }
  return { text: lines.filter(Boolean).join("\n"), stackedMaths, lines: boxes };
}

// ---- pictures ------------------------------------------------------------------------------------------------------

async function withBudget<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), ms)));
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The EXIF orientation (1 to 8) of a JPEG, or 1. Read from the first APP1 "Exif" segment. */
export function jpegOrientation(bytes: Uint8Array): number {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) break;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif") {
      const tiff = bytes.subarray(at + 10, at + 2 + length);
      const little = tiff[0] === 0x49;
      const u16 = (o: number) => (o + 1 < tiff.length ? (little ? tiff[o]! | (tiff[o + 1]! << 8) : (tiff[o]! << 8) | tiff[o + 1]!) : 0);
      const u32 = (o: number) => (u16(little ? o + 2 : o) * 65536 + u16(little ? o : o + 2)) >>> 0;
      const ifd = u32(4);
      const count = u16(ifd);
      for (let i = 0; i < count && ifd + 2 + i * 12 + 12 <= tiff.length; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    at += 2 + length;
  }
  return 1;
}

/** Decodes with pure-JavaScript decoders, which throw on a bad file. (The native canvas decoder crashes the process on some
 * corrupt PNGs and truncated JPEGs, so untrusted bytes never reach it: it only ever gets clean pixels.) Bounded in size. */
async function decodePhoto(bytes: Uint8Array, kind: "jpeg" | "png"): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  try {
    if (kind === "jpeg") {
      const { decode } = await import("jpeg-js");
      const image = decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 60, maxMemoryUsageInMB: 512 });
      return { width: image.width, height: image.height, data: image.data };
    }
    const { PNG } = await import("pngjs");
    const image = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { checkCRC: true });
    if (image.width * image.height > 60_000_000) return null;
    return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength) };
  } catch {
    return null;
  }
}

/** A photo, upright (its orientation applied), at most `photoLongSide` on its long side, re-encoded: no metadata survives. */
export async function preparePhoto(bytes: Uint8Array, kind: "jpeg" | "png"): Promise<{ ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; problem: FileProblem }> {
  const pixels = await decodePhoto(bytes, kind);
  if (!pixels || !pixels.width || !pixels.height) return problem("unreadable", DOCUMENT_MESSAGES.photo);
  const source = createCanvas(pixels.width, pixels.height);
  source.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength), pixels.width, pixels.height), 0, 0);

  const orientation = kind === "jpeg" ? jpegOrientation(bytes) : 1;
  const sideways = orientation >= 5; // 5 to 8 swap width and height
  const fullW = sideways ? pixels.height : pixels.width;
  const fullH = sideways ? pixels.width : pixels.height;
  const scale = Math.min(1, DOCUMENT_LIMITS.photoLongSide / Math.max(fullW, fullH));
  const width = Math.max(1, Math.round(fullW * scale));
  const height = Math.max(1, Math.round(fullH * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (kind === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  // The EXIF orientations as transforms of the output, drawing the stored picture into it (w and h are the stored size, scaled).
  const w = pixels.width * scale;
  const h = pixels.height * scale;
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  ctx.setTransform(...transforms[orientation]!);
  ctx.drawImage(source, 0, 0, w, h);
  const out = kind === "jpeg" ? canvas.toBuffer("image/jpeg", 88) : canvas.toBuffer("image/png");
  return { ok: true, bytes: new Uint8Array(out), width, height };
}

/** True if a rendered page is (almost) one colour: nothing is drawn on it. */
function looksBlank(canvas: Canvas): boolean {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  let inked = 0;
  const step = 4 * 7; // every 7th pixel is plenty
  for (let i = 0; i < data.length; i += step) if (data[i]! < 200 || data[i + 1]! < 200 || data[i + 2]! < 200) inked += 1;
  return inked / (data.length / step) < 0.0005;
}

// ---- PDFs ------------------------------------------------------------------------------------------------------------

export interface ReadOptions {
  /** The student's question: pages it names ("page 3", "question 5") are pictured first. */
  question?: string;
  /** Most pages to picture for this document (the message has a shared budget). Default `imagesPerMessage`; 0 for a text-only model. */
  maxImages?: number;
  /** Make the pictures at all (false for the quick check when a file is uploaded). */
  render?: boolean;
  /** Most pages allowed. */
  maxPages?: number;
}

/**
 * Reads a PDF into pages. Never throws: every failure comes back as a problem the student can act on (a password, a damaged file,
 * too many pages, blank pages, too slow).
 */
export async function readPdfDocument(bytes: Uint8Array, options: ReadOptions = {}): Promise<PdfReading> {
  const { render = true, maxPages = 20 } = options;
  const started = Date.now();
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, stopAtErrors: false, verbosity: 0 });
  let doc: Awaited<typeof task.promise>;
  try {
    const opened = await withBudget(task.promise, 10_000);
    if (opened === "timeout") {
      void task.destroy();
      return problem("unreadable", DOCUMENT_MESSAGES.slow);
    }
    doc = opened;
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === "PasswordException") return problem("encrypted", DOCUMENT_MESSAGES.locked);
    return problem("unreadable", DOCUMENT_MESSAGES.damaged);
  }
  try {
    const pageCount = doc.numPages;
    if (pageCount === 0) return problem("empty", "That PDF has no pages.");
    if (pageCount > maxPages) return problem("too-many", `That PDF has ${pageCount} pages; the limit is ${maxPages}. Please send fewer pages.`);

    const imageOps = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageMaskXObject, lib.OPS.paintImageXObjectRepeat, lib.OPS.paintImageMaskXObjectRepeat, lib.OPS.paintSolidColorImageMask].filter((op) => typeof op === "number"));
    const pages: PageReading[] = [];
    let totalText = 0;
    for (let n = 1; n <= pageCount; n += 1) {
      if (Date.now() - started > DOCUMENT_LIMITS.totalMs) return problem("unreadable", DOCUMENT_MESSAGES.slow);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        const [a, b, c, d, e, f] = raw.transform as number[];
        items.push({ str: raw.str, x: e!, y: f!, w: raw.width, h: Math.hypot(c!, d!) || Math.hypot(a!, b!) || raw.height });
      }
      const { text: laidOut, stackedMaths, lines } = layoutText(items);
      const view = page.view as number[];
      let text = laidOut.slice(0, DOCUMENT_LIMITS.pageTextChars);
      if (totalText + text.length > DOCUMENT_LIMITS.totalTextChars) text = text.slice(0, Math.max(0, DOCUMENT_LIMITS.totalTextChars - totalText));
      totalText += text.length;
      const ops = await page.getOperatorList();
      const hasPictures = ops.fnArray.some((fn) => imageOps.has(fn));
      pages.push({ number: n, text, textQuality: textQuality(laidOut), hasPictures, stackedMaths, image: null, lines, width: view[2]! - view[0]!, height: view[3]! - view[1]!, rotation: page.rotate, originX: view[0]!, originY: view[1]! });
      page.cleanup();
    }

    // Which pages the model sees as pictures: pages the student named, then pages whose text cannot be trusted, then pages with
    // pictures on them, then maths laid out on more than one line. At most `imagesPerMessage`.
    const prefer = new Set(options.question ? pagesAskedAbout(options.question, pages) : []);
    const rank = (p: PageReading) => (prefer.has(p.number) ? 0 : p.textQuality !== "good" ? 1 : p.hasPictures ? 2 : p.stackedMaths ? 3 : 9);
    const candidates = [...pages].filter((p) => rank(p) < 9).sort((a, b) => rank(a) - rank(b) || a.number - b.number);
    const chosen = candidates.slice(0, Math.max(0, options.maxImages ?? DOCUMENT_LIMITS.imagesPerMessage)).map((p) => p.number);
    // A page with no usable text still needs a look even when there is no room to send it, to know whether it is blank.
    const mustRender = new Set([...chosen, ...pages.filter((p) => p.textQuality === "none").map((p) => p.number)]);

    let blankPages = 0;
    if (render || pages.every((p) => p.textQuality !== "good")) {
      for (const p of pages) {
        if (!mustRender.has(p.number)) continue;
        if (Date.now() - started > DOCUMENT_LIMITS.totalMs) return problem("unreadable", DOCUMENT_MESSAGES.slow);
        const page = await doc.getPage(p.number);
        const base = page.getViewport({ scale: 1 });
        const scale = DOCUMENT_LIMITS.renderLongSide / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const drawn = await withBudget(page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise, 8_000);
        page.cleanup();
        if (drawn === "timeout") return problem("unreadable", DOCUMENT_MESSAGES.slow);
        if (looksBlank(canvas)) {
          if (p.textQuality === "none") blankPages += 1;
          continue;
        }
        if (render && chosen.includes(p.number)) p.image = new Uint8Array(canvas.toBuffer("image/jpeg", 85));
      }
    }
    if (pages.every((p) => p.textQuality === "none") && blankPages === pages.length) return problem("unreadable", DOCUMENT_MESSAGES.blank);
    const shownAsImages = pages.filter((p) => p.image).map((p) => p.number);
    const textOnly = pages.filter((p) => !p.image).map((p) => p.number);
    return { ok: true, pageCount, pages, shownAsImages, textOnly };
  } finally {
    void doc.destroy();
  }
}

/** Defuses the markers used around uploads and pages, so a document cannot close its own wrapper or fake a page. */
export const defuse = (text: string) => text.replace(/<\s*\/?\s*(uploaded-file|page)\b/gi, "[marker removed]");

export interface RenderedPage {
  number: number;
  /** Pixels per PDF unit. */
  scale: number;
  width: number;
  height: number;
  /** RGBA, row by row from the top. */
  data: Uint8ClampedArray;
  /** The same page as a JPEG, for showing. */
  jpeg: () => Uint8Array;
}

/** Renders pages of a (trusted, already checked) PDF to pixels: for finding empty space and for previews. */
export async function renderPdfPages(bytes: Uint8Array, { scale = 1, pages: wanted }: { scale?: number; pages?: number[] } = {}): Promise<RenderedPage[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  try {
    const out: RenderedPage[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      if (wanted && !wanted.includes(n)) continue;
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
      page.cleanup();
      out.push({ number: n, scale, width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, jpeg: () => new Uint8Array(canvas.toBuffer("image/jpeg", 85)) });
    }
    return out;
  } finally {
    void doc.destroy();
  }
}

/** Page numbers the student's question points at: "page 3", "p. 4", "question 5" (looked up in the text). */
export function pagesAskedAbout(question: string, pages: Array<Pick<PageReading, "number" | "text">>): number[] {
  const out = new Set<number>();
  for (const m of question.matchAll(/\b(?:page|pg|p\.)\s*(\d{1,2})\b/gi)) out.add(Number(m[1]));
  for (const m of question.matchAll(/\b(?:question|q\.?)\s*(\d{1,2})\b/gi)) {
    const q = m[1]!;
    const hit = pages.find((p) => new RegExp(`(^|\\n)\\s*(question\\s*)?${q}\\b[.)]?`, "i").test(p.text));
    if (hit) out.add(hit.number);
  }
  return [...out];
}

/**
 * The text the model gets for one document: every page labelled, what was pictured said plainly, and pages whose text could not be
 * read marked as such, so the model can say what it cannot see instead of guessing.
 */
export function describeDocument(name: string, reading: Extract<PdfReading, { ok: true }>, firstImageIndex: number): string {
  const lines: string[] = [];
  let index = firstImageIndex;
  for (const page of reading.pages) {
    const pictured = page.image ? `picture ${(index += 1)} is this page` : "not pictured";
    const quality = page.textQuality === "good" ? "text read from the file" : page.textQuality === "poor" ? "the file's text layer is garbled, so use the picture if there is one" : "no text in the file (a scan or drawing)";
    const notes = [pictured, quality];
    if (page.hasPictures && !page.image) notes.push("this page has a diagram or image you have NOT been shown");
    if (page.stackedMaths) notes.push(page.image ? "some maths (fractions, indices) is stacked over several lines in the text: read it from the picture" : "some maths (fractions, indices) is stacked over several lines and you have not seen the picture: ask before assuming");
    lines.push(`<page number="${page.number}"${page.image ? ` picture="${index}"` : ""} note="${notes.join("; ")}">`);
    if (page.textQuality === "good" && page.text) lines.push(defuse(page.text));
    lines.push("</page>");
  }
  const unseen = reading.pages.filter((p) => !p.image && p.textQuality !== "good").map((p) => p.number);
  const header = `<uploaded-file name="${name.replace(/"/g, "'")}" pages="${reading.pageCount}"${unseen.length ? ` unseen-pages="${unseen.join(",")}"` : ""}>`;
  return [header, ...lines, "</uploaded-file>"].join("\n");
}
