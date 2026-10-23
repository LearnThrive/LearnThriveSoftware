import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";

/**
 * One handwriting for the whole page. The prose is written in Patrick Hand (SIL Open Font Licence); the maths used to be typeset by
 * MathJax in a TeX textbook face, so every equation sat in a visibly different hand. MathJax still does the LAYOUT (fractions, roots,
 * powers, spacing: it is very good at that and exact about it), but each glyph it places is swapped for the same letter or digit from the
 * handwriting font, positioned in the box MathJax gave it. A glyph the font does not have (a tall stretched bracket, a big radical) keeps
 * MathJax's outline rather than being guessed. Nothing is wobbled or distorted: notation must stay exact and legible.
 */
export function fontBytes(): Uint8Array {
  for (const base of [process.cwd(), join(process.cwd(), "apps", "web")]) {
    const path = join(base, "assets", "fonts", "PatrickHand-Regular.ttf");
    if (existsSync(path)) return new Uint8Array(readFileSync(path));
  }
  throw new Error("the handwriting font is missing (apps/web/assets/fonts/PatrickHand-Regular.ttf)");
}

interface HandFont {
  unitsPerEm: number;
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): { path: { commands: unknown[]; toSVG(): string }; bbox: { minX: number; maxX: number; minY: number; maxY: number } };
}

let font: HandFont | null = null;
function handFont(): HandFont | null {
  if (font) return font;
  try {
    font = fontkit.create(Buffer.from(fontBytes())) as unknown as HandFont;
  } catch {
    font = null;
  }
  return font;
}

/** MathJax's code point for a glyph -> the character to write: the italic alphabet becomes the plain one, a few symbols are renamed. */
export function characterFor(code: number): string | null {
  if (code >= 0x1d434 && code <= 0x1d44d) return String.fromCharCode(0x41 + code - 0x1d434);
  if (code >= 0x1d44e && code <= 0x1d467) return String.fromCharCode(0x61 + code - 0x1d44e);
  if (code === 0x210e) return "h";
  if (code === 0x1d70b) return "π";
  if (code === 0x22c5) return "·";
  if (code === 0x2217) return "×";
  if (code === 0xa0 || code === 0x2009 || code === 0x200a) return null;
  if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return String.fromCharCode(code);
  // Punctuation, brackets and operators the font draws, taken as they are.
  if ("()[]+=<>/.,:;%!?£°²³×÷−≤≥≈≠±√π".includes(String.fromCharCode(code))) return String.fromCharCode(code);
  return null;
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The box of an absolute-coordinate path (every number pair, control points included): enough to place a glyph where MathJax drew one. */
export function boxOfPath(d: string): Box | null {
  const n = (d.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  if (n.length < 4) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    minX = Math.min(minX, n[i]!);
    maxX = Math.max(maxX, n[i]!);
    minY = Math.min(minY, n[i + 1]!);
    maxY = Math.max(maxY, n[i + 1]!);
  }
  return { minX, maxX, minY, maxY };
}

type Matrix = [number, number, number, number, number, number];
const cache = new Map<string, string | null>();
const OPERATORS = "+=<>×÷−≤≥≈≠±·";

/**
 * The handwriting outline for the glyph MathJax drew in `box` (coordinates in 1/1000 em, y up, baseline 0), as path data in the same
 * coordinates, or null to keep MathJax's own outline. `transform` applies a matrix to path data (mathsvg.ts's transformPath).
 */
export function handGlyph(code: number, box: Box, transform: (d: string, m: Matrix) => string): string | null {
  const key = `${code}|${Math.round(box.minX)}|${Math.round(box.maxX)}|${Math.round(box.minY)}|${Math.round(box.maxY)}`;
  if (cache.has(key)) return cache.get(key)!;
  const f = handFont();
  const char = characterFor(code);
  let out: string | null = null;
  if (f && char && f.hasGlyphForCodePoint(char.codePointAt(0)!)) {
    const glyph = f.glyphForCodePoint(char.codePointAt(0)!);
    const gb = glyph.bbox;
    const gw = gb.maxX - gb.minX;
    const gh = gb.maxY - gb.minY;
    const bw = box.maxX - box.minX;
    const bh = box.maxY - box.minY;
    if (gw > 0 && gh > 0 && bw > 0 && bh > 0) {
      const k = 1000 / f.unitsPerEm;
      if (char === "√") {
        // A radical must reach the bar MathJax drew over the root: fitted to its box, not just centred. Only the ordinary size is replaced; a tall
        // stretched radical (a long expression under it) keeps MathJax's own shape.
        if (bh < 1300) out = transform(glyph.path.toSVG(), [(bw / gw), 0, 0, (bh / gh), box.minX - gb.minX * (bw / gw), box.minY - gb.minY * (bh / gh)]);
      } else if (bh < 1500) {
        // Same size as the font draws it (its digits and capitals are within a percent of TeX's), centred in the box MathJax gave it, and
        // narrowed only if it would run into its neighbours.
        const sx = Math.min(k, (bw * 1.2) / gw);
        const dx = (box.minX + box.maxX) / 2 - (sx * (gb.minX + gb.maxX)) / 2;
        // Operators sit on the maths axis (where a fraction bar is), so their middle is put where MathJax's was; letters and digits stay on the baseline.
        const dy = OPERATORS.includes(char) ? (box.minY + box.maxY) / 2 - (k * (gb.minY + gb.maxY)) / 2 : 0;
        out = transform(glyph.path.toSVG(), [sx, 0, 0, k, dx, dy]);
      }
    }
  }
  cache.set(key, out);
  return out;
}
