import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor, type LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
// The TeX packages must be imported to be registered: without these, \implies, \text and friends are silently unknown.
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js";

/**
 * LaTeX to vector shapes for a PDF: MathJax (Apache-2.0) typesets the maths as SVG glyph outlines, and this flattens them (every
 * group's transform applied to every point) into plain path data and rectangles in one coordinate system, so pdf-lib can draw
 * them as true vectors: crisp when zoomed or printed, no fonts to embed, and the maths is exactly what MathJax typeset (never a
 * generated picture of maths).
 *
 * Coordinates: SVG-style, y down, the baseline at y = 0, units of 1/1000 em. Multiply by size/1000 for points.
 */
export interface MathShapes {
  paths: string[];
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  /** The box: from minX, ascent above the baseline (positive), descent below it (positive), in 1/1000 em. */
  minX: number;
  width: number;
  ascent: number;
  descent: number;
}

let engine: { adaptor: LiteAdaptor; convert: (tex: string, display: boolean) => LiteElement } | null = null;

function mathEngine() {
  if (!engine) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", { InputJax: new TeX({ packages: ["base", "ams", "newcommand", "noundefined"] }), OutputJax: new SVG({ fontCache: "none" }) });
    engine = { adaptor, convert: (tex, display) => doc.convert(tex, { display }) as LiteElement };
  }
  return engine;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(value: string | null): Matrix {
  let m = IDENTITY;
  if (!value) return m;
  for (const [, fn, raw] of value.matchAll(/(translate|scale|matrix)\s*\(([^)]*)\)/g)) {
    const n = raw!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === "translate") m = multiply(m, [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]);
    else if (fn === "scale") m = multiply(m, [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]);
    else if (n.length === 6) m = multiply(m, n as Matrix);
  }
  return m;
}

/** Applies a matrix to path data. Handles the commands MathJax's fonts use (and their relative forms); curves keep their shape. */
export function transformPath(d: string, m: Matrix): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? [];
  const out: string[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The previous curve's control point, for T and S, and which kind of curve it was.
  let prevCx = 0;
  let prevCy = 0;
  let prevKind = "";
  const num = () => Number(tokens[i++]);
  const point = (px: number, py: number) => {
    const [tx, ty] = apply(m, px, py);
    return `${round(tx)} ${round(ty)}`;
  };
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const relative = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const rx = (v: number) => (relative ? x + v : v);
    const ry = (v: number) => (relative ? y + v : v);
    if (C === "Z") {
      out.push("Z");
      x = startX;
      y = startY;
      continue;
    }
    if (C === "T") {
      const nx = rx(num());
      const ny = ry(num());
      const cx = prevKind === "Q" ? 2 * x - prevCx : x;
      const cy = prevKind === "Q" ? 2 * y - prevCy : y;
      out.push(`Q ${point(cx, cy)} ${point(nx, ny)}`);
      prevCx = cx;
      prevCy = cy;
      prevKind = "Q";
      x = nx;
      y = ny;
      continue;
    }
    if (C === "M" || C === "L") {
      const nx = rx(num());
      const ny = ry(num());
      out.push(`${C} ${point(nx, ny)}`);
      prevKind = "";
      if (C === "M") {
        startX = nx;
        startY = ny;
        cmd = relative ? "l" : "L"; // further pairs after a move are lines
      }
      x = nx;
      y = ny;
    } else if (C === "H") {
      x = relative ? x + num() : num();
      out.push(`L ${point(x, y)}`);
      prevKind = "";
    } else if (C === "V") {
      y = relative ? y + num() : num();
      out.push(`L ${point(x, y)}`);
      prevKind = "";
    } else if (C === "Q") {
      const x1 = rx(num());
      const y1 = ry(num());
      const nx = rx(num());
      const ny = ry(num());
      out.push(`Q ${point(x1, y1)} ${point(nx, ny)}`);
      prevCx = x1;
      prevCy = y1;
      prevKind = "Q";
      x = nx;
      y = ny;
    } else if (C === "C") {
      const x1 = rx(num());
      const y1 = ry(num());
      const x2 = rx(num());
      const y2 = ry(num());
      const nx = rx(num());
      const ny = ry(num());
      out.push(`C ${point(x1, y1)} ${point(x2, y2)} ${point(nx, ny)}`);
      prevCx = x2;
      prevCy = y2;
      prevKind = "C";
      x = nx;
      y = ny;
    } else if (C === "S") {
      const x2 = rx(num());
      const y2 = ry(num());
      const nx = rx(num());
      const ny = ry(num());
      const x1 = prevKind === "C" ? 2 * x - prevCx : x;
      const y1 = prevKind === "C" ? 2 * y - prevCy : y;
      out.push(`C ${point(x1, y1)} ${point(x2, y2)} ${point(nx, ny)}`);
      prevCx = x2;
      prevCy = y2;
      prevKind = "C";
      x = nx;
      y = ny;
    } else if (C === "A") {
      // Elliptical arcs do not occur in MathJax's fonts; if one does, draw a straight line to its end rather than fail.
      i += 5;
      const nx = rx(num());
      const ny = ry(num());
      out.push(`L ${point(nx, ny)}`);
      x = nx;
      y = ny;
    } else {
      i += 1; // an unknown token: skip it
    }
  }
  return out.join(" ");
}

const round = (v: number) => Math.round(v * 100) / 100;

const cache = new Map<string, MathShapes | null>();

/** The shapes of one formula, or null if MathJax could not typeset it (an unknown command, a character it has no outline for). */
export function mathShapes(tex: string, display = false): MathShapes | null {
  const key = `${display ? "D" : "I"}${tex}`;
  if (cache.has(key)) return cache.get(key)!;
  let result: MathShapes | null = null;
  try {
    const { adaptor, convert } = mathEngine();
    const container = convert(tex, display);
    const svg = adaptor.firstChild(container) as LiteElement;
    const html = adaptor.outerHTML(container);
    if (!/<svg/.test(html) || /data-mml-node="merror"|<text/.test(html)) {
      result = null;
    } else {
      const view = (adaptor.getAttribute(svg, "viewBox") ?? "0 0 0 0").split(/\s+/).map(Number);
      const paths: string[] = [];
      const rects: MathShapes["rects"] = [];
      const walk = (node: LiteElement, m: Matrix) => {
        const kind = adaptor.kind(node);
        if (kind === "#text" || kind === "#comment") return;
        const here = multiply(m, parseTransform(adaptor.getAttribute(node, "transform")));
        if (kind === "path") {
          const d = adaptor.getAttribute(node, "d");
          if (d) paths.push(transformPath(d, here));
        } else if (kind === "rect") {
          const rx = Number(adaptor.getAttribute(node, "x") ?? 0);
          const ry = Number(adaptor.getAttribute(node, "y") ?? 0);
          const rw = Number(adaptor.getAttribute(node, "width") ?? 0);
          const rh = Number(adaptor.getAttribute(node, "height") ?? 0);
          const [ax, ay] = apply(here, rx, ry);
          const [bx, by] = apply(here, rx + rw, ry + rh);
          rects.push({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) });
        }
        for (const child of adaptor.childNodes(node) as LiteElement[]) walk(child, here);
      };
      for (const child of adaptor.childNodes(svg) as LiteElement[]) walk(child, IDENTITY);
      const [minX, minY, w, h] = view as [number, number, number, number];
      result = { paths, rects, minX, width: w, ascent: -minY, descent: h + minY };
    }
  } catch {
    result = null;
  }
  cache.set(key, result);
  return result;
}
