import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef, decodePDFRawStream } from "pdf-lib";
import { extensionOf, formatBytes, sanitiseFileName, sniffKind, type FileProblem } from "@/lib/careers-files";
import { inspectPdf } from "@/lib/careers-files-server";

/**
 * What a student may attach to a question (plan19 section 5.3): a JPEG or PNG photo, or a PDF. Checked like every other upload
 * on this site (the real type from the first bytes, size limits, no scripts or encryption in a PDF), then cleaned:
 *
 *   photos   the metadata is removed (camera model, GPS position, time, thumbnails); only the orientation survives, because a
 *            phone photo that loses it arrives sideways and the model cannot read the working
 *   PDFs     the text is read out for the model; a scan (pages that are one photo each) has its page images pulled out for the
 *            vision model instead. A PDF with neither is refused with a friendly reason
 *
 * Limits (defaults; plan19 section 5.3): 8 MB a photo, 15 MB a PDF, 20 pages, three files a message. HEIC (an iPhone's default) is
 * refused with a way forward. Pure: no network, no storage. Uploaded content is UNTRUSTED text for the model to read, never instructions.
 */
export const UPLOAD_LIMITS = { imageBytes: 8 * 1024 * 1024, pdfBytes: 15 * 1024 * 1024, pdfPages: 20, filesPerMessage: 3, pdfTextChars: 12_000, scanImagesMax: 3 } as const;

export type UploadKind = "image" | "pdf_text" | "pdf_scan";

export type UploadResult =
  | { ok: true; kind: "image"; name: string; contentType: "image/jpeg" | "image/png"; bytes: Uint8Array }
  | { ok: true; kind: "pdf_text"; name: string; contentType: "application/pdf"; bytes: Uint8Array; text: string; pages: number }
  | { ok: true; kind: "pdf_scan"; name: string; contentType: "application/pdf"; bytes: Uint8Array; images: Uint8Array[]; pages: number }
  | { ok: false; problem: FileProblem };

const refuse = (code: FileProblem["code"], message: string): UploadResult => ({ ok: false, problem: { code, message } });

const HEIC = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function isHeic(bytes: Uint8Array): boolean {
  return bytes.length > 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && HEIC.has(String.fromCharCode(...bytes.subarray(8, 12)));
}

// ---- photos ----------------------------------------------------------------------------------------------------

/** The EXIF orientation (1 to 8) from a JPEG's APP1 segment, or 1. */
function jpegOrientation(app1: Uint8Array): number {
  if (app1.length < 14 || String.fromCharCode(...app1.subarray(0, 4)) !== "Exif") return 1;
  const tiff = app1.subarray(6);
  const little = tiff[0] === 0x49;
  const u16 = (o: number) => (little ? tiff[o]! | (tiff[o + 1]! << 8) : (tiff[o]! << 8) | tiff[o + 1]!);
  const u32 = (o: number) => (little ? (tiff[o]! | (tiff[o + 1]! << 8) | (tiff[o + 2]! << 16) | (tiff[o + 3]! << 24)) >>> 0 : ((tiff[o]! << 24) | (tiff[o + 1]! << 16) | (tiff[o + 2]! << 8) | tiff[o + 3]!) >>> 0);
  if (tiff.length < 8) return 1;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
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

/** A fresh APP1 segment holding only the orientation. */
function orientationOnlyExif(orientation: number): Uint8Array {
  const body = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big endian, IFD at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const length = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

/** JPEG: keep image data and colour, drop every APPn (EXIF, XMP, IPTC, thumbnails) except APP0 and a minimal orientation, and comments. */
export function cleanJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: number[] = [0xff, 0xd8];
  let orientation = 1;
  let at = 2;
  let wroteExif = false;
  const flushExif = () => {
    if (!wroteExif && orientation !== 1) {
      out.push(...orientationOnlyExif(orientation));
    }
    wroteExif = true;
  };
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      flushExif();
      for (let i = at; i < bytes.length; i += 1) out.push(bytes[i]!);
      return Uint8Array.from(out);
    }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2 || at + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(at, at + 2 + length);
    if (marker === 0xe1) orientation = Math.max(orientation, jpegOrientation(segment.subarray(4)));
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) {
      if (marker !== 0xe0) flushExif(); // the orientation goes after JFIF's APP0, before anything else
      for (const b of segment) out.push(b);
    }
    at += 2 + length;
  }
  return null;
}

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "sRGB", "cHRM", "sBIT", "bKGD"]);

/** PNG: keep only the chunks needed to draw it. Text, time, physical size, embedded profile and EXIF chunks go. */
export function cleanPng(bytes: Uint8Array): Uint8Array | null {
  const out: number[] = Array.from(bytes.subarray(0, 8));
  let at = 8;
  let sawEnd = false;
  while (at + 12 <= bytes.length) {
    const length = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) return null;
    if (PNG_KEEP.has(type)) for (let i = at; i < end; i += 1) out.push(bytes[i]!);
    at = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  return sawEnd ? Uint8Array.from(out) : null;
}

// ---- PDFs ------------------------------------------------------------------------------------------------------

function readString(source: string, at: number): { text: string; next: number } | null {
  if (source[at] === "(") {
    let depth = 1;
    let out = "";
    let i = at + 1;
    while (i < source.length && depth > 0) {
      const c = source[i]!;
      if (c === "\\") {
        const n = source[i + 1] ?? "";
        const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "", f: "", "(": "(", ")": ")", "\\": "\\" };
        if (n in map) {
          out += map[n];
          i += 2;
        } else if (/[0-7]/.test(n)) {
          const octal = /^[0-7]{1,3}/.exec(source.slice(i + 1, i + 4))![0];
          out += String.fromCharCode(Number.parseInt(octal, 8));
          i += 1 + octal.length;
        } else {
          i += 2;
        }
        continue;
      }
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      out += c;
      i += 1;
    }
    return { text: out, next: i + 1 };
  }
  if (source[at] === "<" && source[at + 1] !== "<") {
    const end = source.indexOf(">", at);
    if (end < 0) return null;
    const hex = source.slice(at + 1, end).replace(/\s+/g, "");
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    return { text: out, next: end + 1 };
  }
  return null;
}

/** Text shown by a page's content stream: the strings of Tj, TJ, ' and ". Best effort for simple fonts; subset or CID fonts come out as noise. */
export function textOfContent(content: string): string {
  const out: string[] = [];
  let line = "";
  const flush = () => {
    if (line.trim()) out.push(line.trim());
    line = "";
  };
  let i = 0;
  while (i < content.length) {
    const c = content[i]!;
    if (c === "(" || (c === "<" && content[i + 1] !== "<")) {
      const s = readString(content, i);
      if (!s) break;
      line += s.text;
      i = s.next;
    } else if (c === "[") {
      i += 1;
    } else if (c === "]") {
      i += 1;
    } else if ((c === "T" && (content[i + 1] === "d" || content[i + 1] === "D" || content[i + 1] === "*")) || (c === "E" && content[i + 1] === "T")) {
      flush();
      i += 2;
    } else if (c === "-" || /[0-9.]/.test(c)) {
      // A kerning number inside TJ: a large negative one is a word space.
      const m = /^-?\d*\.?\d+/.exec(content.slice(i));
      if (m) {
        if (Number(m[0]) < -200 && line && !line.endsWith(" ")) line += " ";
        i += m[0].length;
      } else i += 1;
    } else {
      i += 1;
    }
  }
  flush();
  return out.join("\n");
}

/** How much of a string is ordinary letters, digits, spaces and punctuation: noise from a CID font scores low. */
export function readableRatio(text: string): number {
  if (!text) return 0;
  const good = (text.match(/[A-Za-z0-9 .,;:!?'"()\-+*/=<>%\n]/g) ?? []).length;
  return good / text.length;
}

function contentBytes(doc: PDFDocument, pageNode: PDFDict): string {
  const contents = pageNode.lookup(PDFName.of("Contents"));
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  let text = "";
  for (const s of streams) {
    if (s instanceof PDFRawStream) {
      try {
        text += `${Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")}\n`;
      } catch {
        /* an undecodable stream contributes nothing */
      }
    }
  }
  return text;
}

/** The JPEG image streams (DCTDecode) on a page: what a scanned page is made of. Largest first. */
function pageJpegs(doc: PDFDocument, pageNode: PDFDict): Uint8Array[] {
  const resources = pageNode.lookup(PDFName.of("Resources"));
  if (!(resources instanceof PDFDict)) return [];
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return [];
  const found: Uint8Array[] = [];
  for (const [, ref] of xobjects.entries()) {
    const object = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const filter = object.dict.lookup(PDFName.of("Filter"));
    const names = filter instanceof PDFArray ? filter.asArray().map((f) => String(f)) : [String(filter)];
    if (names.length === 1 && names[0] === "/DCTDecode") found.push(object.getContents());
  }
  return found.sort((a, b) => b.length - a.length);
}

export type PdfReading = { ok: true; kind: "pdf_text"; text: string; pages: number } | { ok: true; kind: "pdf_scan"; images: Uint8Array[]; pages: number } | { ok: false; problem: FileProblem };

export async function readPdf(bytes: Uint8Array): Promise<PdfReading> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: false, updateMetadata: false });
  } catch {
    return { ok: false, problem: { code: "unreadable", message: "We could not read that PDF. Please save it again, or take a photo of the page instead." } };
  }
  let pages: number;
  try {
    pages = doc.getPageCount();
  } catch {
    return { ok: false, problem: { code: "unreadable", message: "We could not read that PDF. Please save it again, or take a photo of the page instead." } };
  }
  if (pages === 0) return { ok: false, problem: { code: "empty", message: "That PDF has no pages." } };
  if (pages > UPLOAD_LIMITS.pdfPages) return { ok: false, problem: { code: "too-many", message: `That PDF has ${pages} pages; the limit is ${UPLOAD_LIMITS.pdfPages}. Please send fewer pages.` } };

  let text = "";
  for (const page of doc.getPages()) {
    const node = page.node as unknown as PDFDict;
    text += `${textOfContent(contentBytes(doc, node))}\n`;
    if (text.length > UPLOAD_LIMITS.pdfTextChars * 2) break;
  }
  text = text.trim();
  if (text.length >= 30 * Math.min(pages, 3) && readableRatio(text) >= 0.85) {
    return { ok: true, kind: "pdf_text", text: text.slice(0, UPLOAD_LIMITS.pdfTextChars), pages };
  }
  const images: Uint8Array[] = [];
  for (const page of doc.getPages()) {
    const best = pageJpegs(doc, page.node as unknown as PDFDict)[0];
    if (best) images.push(best);
    if (images.length >= UPLOAD_LIMITS.scanImagesMax) break;
  }
  if (images.length > 0) return { ok: true, kind: "pdf_scan", images, pages };
  return { ok: false, problem: { code: "unreadable", message: "We could not read any text or pictures in that PDF. Please take a photo of the page instead." } };
}

// ---- the entry point -------------------------------------------------------------------------------------------

export async function inspectChatUpload(name: string, bytes: Uint8Array): Promise<UploadResult> {
  if (bytes.length === 0) return refuse("empty", "That file is empty.");
  if (isHeic(bytes)) return refuse("type", "That is a HEIC photo, which we cannot read. On an iPhone, set Camera to Most Compatible, or take a screenshot of the photo and send that.");
  const extension = extensionOf(name);
  const kind = sniffKind(bytes);
  const clean = sanitiseFileName(name).full;

  if (kind === "jpeg" || kind === "png") {
    if (!["jpg", "jpeg", "png"].includes(extension) || (kind === "jpeg") !== (extension === "jpg" || extension === "jpeg")) return refuse("content", "This file does not look like the type its name says.");
    if (bytes.length > UPLOAD_LIMITS.imageBytes) return refuse("too-big", `That photo is ${formatBytes(bytes.length)}; the limit is ${formatBytes(UPLOAD_LIMITS.imageBytes)}.`);
    const cleaned = kind === "jpeg" ? cleanJpeg(bytes) : cleanPng(bytes);
    if (!cleaned) return refuse("unreadable", "We could not read that photo. Please try another.");
    return { ok: true, kind: "image", name: clean, contentType: kind === "jpeg" ? "image/jpeg" : "image/png", bytes: cleaned };
  }
  if (kind === "pdf") {
    if (extension !== "pdf") return refuse("content", "This file does not look like the type its name says.");
    if (bytes.length > UPLOAD_LIMITS.pdfBytes) return refuse("too-big", `That PDF is ${formatBytes(bytes.length)}; the limit is ${formatBytes(UPLOAD_LIMITS.pdfBytes)}.`);
    const verdict = inspectPdf(bytes);
    if (!verdict.ok) return verdict;
    const read = await readPdf(bytes);
    if (!read.ok) return read;
    return read.kind === "pdf_text"
      ? { ok: true, kind: "pdf_text", name: clean, contentType: "application/pdf", bytes, text: read.text, pages: read.pages }
      : { ok: true, kind: "pdf_scan", name: clean, contentType: "application/pdf", bytes, images: read.images, pages: read.pages };
  }
  return refuse("type", "Please send a JPEG or PNG photo, or a PDF.");
}
