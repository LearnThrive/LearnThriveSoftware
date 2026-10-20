import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/**
 * Stamps every PDF the Library hands out with who it was issued to and when (plan19 phase D). Terms forbid sharing
 * and resale; this is the deterrent and the evidence, not DRM: anyone can still print it to a new file. Two marks
 * per page, both small and light so the page stays usable: a footer line, and one faint diagonal line across the
 * middle. The PDF's own metadata also carries the line, so it survives a crop.
 *
 * Text is written in the PDF's standard Helvetica (WinAnsi), so a name is first reduced to what that font can
 * draw (`pdfSafe`): anything else becomes "?". Nothing here reads the PDF's text or runs anything in it.
 */
export interface WatermarkOptions {
  /** The downloader's name, or their email address if they have not given one. */
  holder: string;
  at: Date;
}

/** Keeps printable Latin-1 (what WinAnsi can draw); anything else becomes "?"; collapses spaces; bounded length. */
export function pdfSafe(text: string, max = 80): string {
  const cleaned = text
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/[^\x20-\x7e\xa1-\xff]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}?` : cleaned;
}

export function stampText(options: WatermarkOptions): string {
  const when = options.at.toISOString().slice(0, 16).replace("T", " ");
  return `Licensed to ${pdfSafe(options.holder) || "a LearnThrive account"} on ${when} UTC. LearnThrive Library: not for sharing or resale.`;
}

export async function watermarkPdf(original: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = stampText(options);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const footerSize = Math.max(6, Math.min(8, width / 80));
    const fit = (size: number) => font.widthOfTextAtSize(line, size);
    // A long name on a narrow page: shrink to fit rather than run off the edge.
    const size = fit(footerSize) > width - 24 ? Math.max(4, ((width - 24) / fit(footerSize)) * footerSize) : footerSize;
    page.drawText(line, { x: 12, y: 10, size, font, color: rgb(0.38, 0.42, 0.46) });

    const diagonalSize = Math.max(12, Math.min(22, width / 30));
    const textWidth = font.widthOfTextAtSize(line, diagonalSize);
    const scale = textWidth > Math.hypot(width, height) * 0.8 ? (Math.hypot(width, height) * 0.8) / textWidth : 1;
    const drawn = diagonalSize * scale;
    const w = font.widthOfTextAtSize(line, drawn);
    page.drawText(line, {
      x: width / 2 - (w / 2) * Math.cos(Math.PI / 6),
      y: height / 2 - (w / 2) * Math.sin(Math.PI / 6),
      size: drawn,
      font,
      rotate: degrees(30),
      color: rgb(0.55, 0.6, 0.65),
      opacity: 0.18,
    });
  }
  doc.setSubject(line);
  doc.setKeywords(["LearnThrive Library", "licensed copy"]);
  doc.setProducer("LearnThrive Library");
  return doc.save({ useObjectStreams: false });
}
