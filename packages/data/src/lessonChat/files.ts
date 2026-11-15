import { randomUUID } from "node:crypto";
import type { LessonFileType } from "./types";

/**
 * What may be uploaded to a lesson, and what happens to it first (docs/LESSON_CHAT.md).
 *
 *   TYPE      png, jpg or pdf only. Decided by the file's own first bytes (its "magic number"), never by the name or the type the browser
 *             claims: all three must agree, so a program renamed to .png is refused.
 *   SIZE      at most the configured cap (default 10 MB), and not empty.
 *   NAME      the name the user sent is refused if it could point somewhere (a path, `..`, a drive, a control character); otherwise it is cleaned
 *             and kept for display only. The file is STORED under a name the server generates, and found by id.
 *   METADATA  an image's EXIF (location, device, time) and other embedded text is stripped before it is stored. A JPEG keeps one thing: its
 *             orientation, so a photo of a diagram taken sideways still shows the right way up. A PDF is checked for active content
 *             (JavaScript, launch actions, embedded files) and refused if it has any; its metadata is not rewritten.
 *   SCAN      a malware scanner can plug in (`FileScanner`, repository.ts). None is installed yet.
 */

export const ALLOWED = {
  "image/png": { ext: "png", names: ["png"] },
  "image/jpeg": { ext: "jpg", names: ["jpg", "jpeg"] },
  "application/pdf": { ext: "pdf", names: ["pdf"] },
} as const satisfies Record<LessonFileType, { ext: string; names: readonly string[] }>;

export type UploadRefusal = "FILE_EMPTY" | "FILE_TOO_LARGE" | "FILE_TYPE_NOT_ALLOWED" | "FILE_NAME_NOT_ALLOWED" | "FILE_CORRUPT" | "FILE_UNSAFE";

export type UploadCheck =
  | { ok: true; contentType: LessonFileType; ext: string; bytes: Uint8Array; displayName: string }
  | { ok: false; code: UploadRefusal; message: string };

const MESSAGES: Record<UploadRefusal, string> = {
  FILE_EMPTY: "That file is empty.",
  FILE_TOO_LARGE: "That file is too large.",
  FILE_TYPE_NOT_ALLOWED: "Only PNG, JPG and PDF files can be shared.",
  FILE_NAME_NOT_ALLOWED: "That file name is not allowed.",
  FILE_CORRUPT: "That file could not be read. Try saving it again.",
  FILE_UNSAFE: "That file contains content that cannot be shared.",
};
const no = (code: UploadRefusal): UploadCheck => ({ ok: false, code, message: MESSAGES[code] });

// ---- names ---------------------------------------------------------------------------------------------------------------------------------

const MAX_NAME = 120;

/** The extension (lowercase, no dot) of a name, or null. Only the last one counts, so `a.png.exe` is `exe`. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

/** null if the name could point somewhere or is not a plain file name; otherwise a cleaned name for display. */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC");
  if (name.length === 0 || name.length > MAX_NAME) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  // Anything that is, or could be turned into, a path: separators in either style, `..`, a drive letter, a leading dot, a URL-ish encoding.
  if (/[/\\]/.test(name) || name.includes("..") || name.startsWith(".") || /^[a-zA-Z]:/.test(name) || /%2e|%2f|%5c/i.test(name) || name.includes(":")) return null;
  const cleaned = name.replace(/[^\p{L}\p{N} ._()\-]/gu, "_").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 && !cleaned.startsWith(".") ? cleaned : null;
}

// ---- type ----------------------------------------------------------------------------------------------------------------------------------

export function sniffType(bytes: Uint8Array): LessonFileType | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "image/png";
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 5 && at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46 && at(4) === 0x2d) return "application/pdf";
  return null;
}

// ---- metadata ------------------------------------------------------------------------------------------------------------------------------

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD"]);

/** The PNG without its text, EXIF and time chunks (everything not needed to draw it). null if it is not a well-formed PNG. */
export function stripPng(bytes: Uint8Array): Uint8Array | null {
  const out: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  let sawEnd = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    const end = pos + 12 + length;
    if (end > bytes.length) return null;
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    if (PNG_KEEP.has(type)) out.push(bytes.subarray(pos, end));
    pos = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  return sawEnd ? concat(out) : null;
}

/** The EXIF orientation (2 to 8) of a JPEG's APP1 segment, or 1. Reads only that one tag. */
function exifOrientation(segment: Uint8Array): number {
  // segment = "Exif\0\0" + TIFF
  if (segment.length < 14 || String.fromCharCode(segment[0]!, segment[1]!, segment[2]!, segment[3]!) !== "Exif") return 1;
  const tiff = segment.subarray(6);
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  if (tiff.length < 8 || u16(2) !== 0x2a) return 1;
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 2 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** A minimal APP1 holding only the orientation tag. Nothing else of the original EXIF survives. */
function orientationSegment(orientation: number): Uint8Array {
  const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const body = new Uint8Array(6 + tiff.length);
  body.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  body.set(tiff, 6);
  const length = body.length + 2;
  return concat([new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff]), body]);
}

/**
 * The JPEG without its EXIF/XMP/IPTC/comment segments (APP1 to APP15 and COM), keeping the image data byte for byte, and one tiny new APP1
 * holding just the orientation when the photo was taken rotated. null if it is not a well-formed JPEG.
 */
export function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const out: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation = 1;
  let pos = 2;
  let inserted = false;
  const insert = () => {
    if (!inserted && orientation > 1) out.push(orientationSegment(orientation));
    inserted = true;
  };
  while (pos < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    while (bytes[pos] === 0xff && pos < bytes.length) pos += 1; // fill bytes
    const marker = bytes[pos];
    pos += 1;
    if (marker === undefined) return null;
    if (marker === 0xd9) { insert(); out.push(new Uint8Array([0xff, 0xd9])); return concat(out); } // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(new Uint8Array([0xff, marker])); continue; } // no length
    if (pos + 2 > bytes.length) return null;
    const length = (bytes[pos]! << 8) | bytes[pos + 1]!;
    if (length < 2 || pos + length > bytes.length) return null;
    const segment = bytes.subarray(pos + 2, pos + length);
    const whole = bytes.subarray(pos - 2, pos + length);
    if (marker === 0xda) { // start of scan: the rest is image data, copied as it is
      insert();
      out.push(bytes.subarray(pos - 2));
      return concat(out);
    }
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(segment);
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      // The orientation goes in once the application segments (where it was read from) are behind us: before the first real image header.
      if (marker !== 0xe0) insert();
      out.push(whole);
    }
    pos += length;
  }
  return null;
}

const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- the whole check -----------------------------------------------------------------------------------------------------------------------

export interface UploadInput {
  /** The name the user's browser sent. */
  name: unknown;
  /** The type the user's browser claimed. */
  declaredType: unknown;
  bytes: Uint8Array;
}

/** Validates an upload and returns the bytes to store (metadata stripped). Every refusal says why, and nothing is stored on a refusal. */
export function checkUpload(input: UploadInput, maxBytes: number): UploadCheck {
  const displayName = cleanDisplayName(input.name);
  if (displayName === null) return no("FILE_NAME_NOT_ALLOWED");
  if (input.bytes.length === 0) return no("FILE_EMPTY");
  if (input.bytes.length > maxBytes) return no("FILE_TOO_LARGE");

  const sniffed = sniffType(input.bytes);
  const ext = extensionOf(displayName);
  const declared = typeof input.declaredType === "string" ? input.declaredType.split(";")[0]!.trim().toLowerCase() : "";
  // The bytes, the name's extension and the claimed type must all say the same allowed thing.
  if (sniffed === null || declared !== sniffed || ext === null || !(ALLOWED[sniffed].names as readonly string[]).includes(ext)) return no("FILE_TYPE_NOT_ALLOWED");

  let bytes: Uint8Array | null;
  if (sniffed === "image/png") bytes = stripPng(input.bytes);
  else if (sniffed === "image/jpeg") bytes = stripJpeg(input.bytes);
  else {
    bytes = input.bytes;
    if (PDF_ACTIVE.test(Buffer.from(input.bytes).toString("latin1"))) return no("FILE_UNSAFE");
  }
  if (bytes === null) return no("FILE_CORRUPT");
  return { ok: true, contentType: sniffed, ext: ALLOWED[sniffed].ext, bytes, displayName };
}

/** The key a file is stored under: made here, from the lesson and a fresh id. Nothing the user sent is in it. */
export function newStorageKey(lessonId: string, ext: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(lessonId) || !/^[a-z0-9]{2,4}$/.test(ext)) throw new Error("A storage key is made only from a plain lesson id and extension.");
  return `lessons/${lessonId}/${randomUUID()}.${ext}`;
}
