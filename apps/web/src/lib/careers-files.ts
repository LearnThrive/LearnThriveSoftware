import { careersConfig } from "@/lib/careers-config";

/**
 * File rules for the careers application that the browser and the server share: what is accepted, the size
 * limits, the friendly messages, and how a file name is cleaned. No Node imports. The browser applies these
 * as a courtesy so a person learns of a problem straight away; the server (careers-files-server.ts) applies
 * them again, and goes further by looking at what a file actually contains, because anything the browser
 * checks can be bypassed.
 */
export type FileSlot = "cv" | "coverLetterFile" | "supporting";

export type FileProblemCode =
  | "type"
  | "empty"
  | "too-big"
  | "too-many"
  | "total"
  | "content"
  | "encrypted"
  | "script"
  | "macro"
  | "embedded"
  | "unreadable";

export interface FileProblem {
  code: FileProblemCode;
  message: string;
}

const { limits } = careersConfig;

export function slotRules(slot: FileSlot): { maxBytes: number; extensions: readonly string[] } {
  if (slot === "cv") return limits.cv;
  if (slot === "coverLetterFile") return limits.coverLetterFile;
  return limits.supporting;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The accepted formats in words, for a hint or an error. */
export function acceptedFormatsText(slot: FileSlot): string {
  return slot === "supporting" ? "PDF, Word (.docx), JPG or PNG" : "PDF or Word (.docx)";
}

/** The `accept` attribute for a file input. */
export function acceptAttribute(slot: FileSlot): string {
  return slotRules(slot)
    .extensions.map((extension) => `.${extension}`)
    .join(",");
}

/** The last extension of a file name, lower-case, without the dot ("" if there is none). */
export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

const KNOWN_BAD_FORMATS: Record<string, string> = {
  doc: "Older Word (.doc) files are not accepted. Open the file and use Save as PDF, or save it as .docx.",
  docm: "Word files that can contain macros (.docm) are not accepted. Save the document as a PDF.",
  odt: "OpenDocument (.odt) files are not accepted. Save the document as a PDF.",
  rtf: "Rich Text (.rtf) files are not accepted. Save the document as a PDF.",
  pages: "Pages files are not accepted. Export the document as a PDF.",
  heic: "HEIC photos are not accepted. Save or share the photo as a JPG, or take a screenshot of it as a PNG.",
  heif: "HEIF photos are not accepted. Save or share the photo as a JPG.",
  zip: "Compressed archives are not accepted. Upload each document on its own.",
  rar: "Compressed archives are not accepted. Upload each document on its own.",
  "7z": "Compressed archives are not accepted. Upload each document on its own.",
  exe: "This type of file is not accepted.",
  js: "This type of file is not accepted.",
  bat: "This type of file is not accepted.",
  cmd: "This type of file is not accepted.",
  vbs: "This type of file is not accepted.",
  scr: "This type of file is not accepted.",
  jar: "This type of file is not accepted.",
  ps1: "This type of file is not accepted.",
};

/** Checks one file by what the browser or the request tells us: its name and size. */
export function checkFileBasics(slot: FileSlot, name: string, size: number): FileProblem | null {
  const rules = slotRules(slot);
  const extension = extensionOf(name);
  if (!extension || !rules.extensions.includes(extension)) {
    return {
      code: "type",
      message: KNOWN_BAD_FORMATS[extension] ?? `This file type is not accepted. Please use a ${acceptedFormatsText(slot)} file. If you can, use Save as PDF.`,
    };
  }
  if (size <= 0) return { code: "empty", message: "This file is empty. Please choose a different file." };
  if (size > rules.maxBytes) {
    return {
      code: "too-big",
      message: `This file is ${formatBytes(size)}, which is over the ${formatBytes(rules.maxBytes)} limit. Please choose a smaller file, or save a smaller copy.`,
    };
  }
  return null;
}

export function totalProblem(sizes: readonly number[]): FileProblem | null {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > limits.totalBytes) {
    return {
      code: "total",
      message: `Your files add up to ${formatBytes(total)}, which is over the ${formatBytes(limits.totalBytes)} limit for the whole application. Remove a file or choose smaller ones.`,
    };
  }
  return null;
}

export interface CleanName {
  base: string;
  ext: string;
  full: string;
}

/**
 * A safe file name for an attachment: no path, no control or direction-changing characters, only letters,
 * digits, spaces, hyphens, underscores and brackets, no dots in the base (so `cv.exe.pdf` becomes
 * `cv-exe.pdf` and cannot pass for something else), at most 80 characters. Falls back to "document".
 */
export function sanitiseFileName(raw: string): CleanName {
  let name = raw.normalize("NFC");
  name = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "");
  const ext = extensionOf(name);
  const withoutExt = ext ? name.slice(0, name.length - ext.length - 1) : name;
  let base = withoutExt
    .replace(/[^\p{L}\p{N} _()-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/^[-\s]+|[-\s]+$/g, "");
  if (base.length > 80) base = base.slice(0, 80).replace(/[-\s]+$/g, "");
  if (!base) base = "document";
  return { base, ext, full: ext ? `${base}.${ext}` : base };
}

/** What kind of file the first bytes say it is. `zip` is the container a .docx is. */
export type SniffedKind = "pdf" | "zip" | "jpeg" | "png" | "unknown";

export function sniffKind(bytes: Uint8Array): SniffedKind {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return "pdf"; // %PDF-
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return "zip";
  if (startsWith(0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  return "unknown";
}

/** The kind of content a file with this extension must contain. */
export function expectedKind(extension: string): SniffedKind {
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "zip";
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png") return "png";
  return "unknown";
}

export const SUPPORTING_DOCUMENT_TYPES = [
  { value: "qualification", label: "Qualification or certificate" },
  { value: "identity", label: "Identity document" },
  { value: "right-to-work", label: "Right-to-work document" },
  { value: "other", label: "Other" },
] as const;

export type SupportingDocumentType = (typeof SUPPORTING_DOCUMENT_TYPES)[number]["value"];

export function isSupportingDocumentType(value: unknown): value is SupportingDocumentType {
  return SUPPORTING_DOCUMENT_TYPES.some((type) => type.value === value);
}

/** Identity and right-to-work files are sensitive: the email flags them and they have their own retention. */
export function isSensitiveDocumentType(type: SupportingDocumentType): boolean {
  return type === "identity" || type === "right-to-work";
}
