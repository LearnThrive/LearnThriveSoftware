import { inflateRawSync } from "node:zlib";
import {
  checkFileBasics,
  expectedKind,
  extensionOf,
  sniffKind,
  type FileProblem,
  type FileSlot,
} from "@/lib/careers-files";

/**
 * Server-side inspection of an uploaded file: not what it is called, what it is. Server only.
 *
 * WHAT THIS CAN AND CANNOT DO. It checks the first bytes against the claimed type, refuses a PDF that is
 * encrypted or carries scripting, launch or embedded-file features, and refuses a .docx that is not a real
 * Word package, that can contain macros or embedded objects, or that looks like a decompression bomb. It
 * reads a Word package's table of contents and ONE small part of it; it never unpacks the whole archive.
 *
 * IT CANNOT SCAN FOR VIRUSES. The PDF check is a byte scan: it cannot see inside compressed object
 * streams, so a determined attacker can hide a feature from it. Every attachment is untrusted. The emails
 * say so, and the destination mailbox's own filtering is the second layer. Anything stronger (a malware
 * scanning service) would send applicants' documents to another company and is a decision for the owners.
 */
export type FileVerdict = { ok: true } | { ok: false; problem: FileProblem };

const reject = (code: FileProblem["code"], message: string): FileVerdict => ({ ok: false, problem: { code, message } });

const WRONG_CONTENT =
  "This file does not look like the type its name says. Please open it, save it again as a PDF or Word (.docx) file, and upload that.";

export function inspectFile(slot: FileSlot, name: string, bytes: Uint8Array): FileVerdict {
  const basics = checkFileBasics(slot, name, bytes.length);
  if (basics) return { ok: false, problem: basics };

  const extension = extensionOf(name);
  const wanted = expectedKind(extension);
  if (sniffKind(bytes) !== wanted) return reject("content", WRONG_CONTENT);

  if (extension === "pdf") return inspectPdf(bytes);
  if (extension === "docx") return inspectDocx(bytes);
  return { ok: true };
}

// ── PDF ─────────────────────────────────────────────────────────────────────────────────────────────

const PDF_FEATURES: ReadonlyArray<[pattern: RegExp, verdict: FileVerdict]> = [
  [/\/Encrypt\b/, reject("encrypted", "This PDF is protected with a password or encryption. Please save an unprotected copy and upload that.")],
  [/\/(?:JavaScript|JS)\b/, reject("script", "This PDF contains scripting, which we cannot accept. Please print it to a new PDF and upload that.")],
  [/\/(?:Launch|SubmitForm|ImportData|GoToE|GoToR)\b/, reject("script", "This PDF contains actions that run or open other files, which we cannot accept. Please print it to a new PDF and upload that.")],
  [/\/(?:EmbeddedFile|RichMedia|XFA)\b/, reject("embedded", "This PDF contains embedded files or interactive content, which we cannot accept. Please print it to a new PDF and upload that.")],
];

function inspectPdf(bytes: Uint8Array): FileVerdict {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("latin1")
    // A PDF name can hide a letter as #xx (/J#61vaScript is /JavaScript); read them as written.
    .replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  for (const [pattern, verdict] of PDF_FEATURES) if (pattern.test(text)) return verdict;
  return { ok: true };
}

// ── DOCX (a zip package) ────────────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024;
const MAX_RATIO = 200;
const MAX_CONTENT_TYPES_BYTES = 256 * 1024;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Reads a zip's central directory (its table of contents). Returns null if it is not a plain, intact zip. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.byteLength;
  if (length < 22) return null;

  let eocd = -1;
  for (let i = length - 22; i >= Math.max(0, length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const totalEntries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  // ZIP64 (0xFFFF / 0xFFFFFFFF markers) is not something a CV needs.
  if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) return null;
  if (totalEntries === 0 || totalEntries > MAX_ENTRIES) return null;
  if (directoryOffset + directorySize > eocd) return null;

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let n = 0; n < totalEntries; n += 1) {
    if (cursor + 46 > length || view.getUint32(cursor, true) !== 0x02014b50) return null;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if (cursor + 46 + nameLength > length) return null;
    const name = Buffer.from(bytes.buffer, bytes.byteOffset + cursor + 46, nameLength).toString("utf8");
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const FORBIDDEN_PART = /(?:^|\/)(?:vbaProject[^/]*|vbaData[^/]*)$|(?:^|\/)(?:activeX|embeddings|macros)\//i;
const FORBIDDEN_EXTENSION = /\.(?:exe|dll|js|vbs|bat|cmd|ps1|scr|com|jar|msi)$/i;

function inspectDocx(bytes: Uint8Array): FileVerdict {
  const entries = readZipDirectory(bytes);
  if (!entries) return reject("content", WRONG_CONTENT);

  let totalUncompressed = 0;
  for (const entry of entries) {
    if (entry.flags & 0x1) return reject("encrypted", "This Word file is protected with a password or encryption. Please save an unprotected copy and upload that.");
    if (entry.name.includes("..") || entry.name.startsWith("/") || entry.name.includes("\\")) return reject("content", WRONG_CONTENT);
    if (FORBIDDEN_PART.test(entry.name) || FORBIDDEN_EXTENSION.test(entry.name)) {
      return reject("macro", "This Word file contains macros or embedded objects, which we cannot accept. Please save it as a PDF and upload that.");
    }
    totalUncompressed += entry.uncompressedSize;
    if (entry.uncompressedSize > 1024 * 1024 && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_RATIO) {
      return reject("content", WRONG_CONTENT);
    }
  }
  if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) return reject("content", WRONG_CONTENT);

  const contentTypes = entries.find((entry) => entry.name === "[Content_Types].xml");
  const mainPart = entries.find((entry) => entry.name === "word/document.xml");
  if (!contentTypes || !mainPart) return reject("content", WRONG_CONTENT);

  const xml = readSmallEntry(bytes, contentTypes);
  if (xml === null) return reject("content", WRONG_CONTENT);
  if (/macroEnabled|vbaProject/i.test(xml)) {
    return reject("macro", "This Word file can contain macros, which we cannot accept. Please save it as a PDF and upload that.");
  }
  if (!xml.includes("wordprocessingml.document.main+xml")) return reject("content", WRONG_CONTENT);
  return { ok: true };
}

/** Inflates one small part of the package (the content-types list). Null if it cannot be read safely. */
function readSmallEntry(bytes: Uint8Array, entry: ZipEntry): string | null {
  if (entry.uncompressedSize > MAX_CONTENT_TYPES_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.byteLength || view.getUint32(offset, true) !== 0x04034b50) return null;
  const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) return null;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset + dataStart, entry.compressedSize);
  try {
    if (entry.method === 0) return data.toString("utf8");
    if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_CONTENT_TYPES_BYTES }).toString("utf8");
  } catch {
    return null;
  }
  return null;
}
