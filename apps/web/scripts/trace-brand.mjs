/**
 * plan15 Wave 10 section 14.1: turns the two raster brand files (public/brand-src/*.png, the
 * originals that used to ship at 134 KB and 292 KB) into clean vector outlines.
 *
 *   node scripts/trace-brand.mjs
 *
 * Method, so the result is reproducible and reviewable rather than a one-off export:
 *   1. Upscale 4x (Lanczos) and classify each pixel as navy, green or background by colour distance.
 *   2. Marching squares over each class's mask finds every boundary, holes included (the book's
 *      pages, the counters of the letters), as closed loops.
 *   3. Each loop is simplified with Ramer-Douglas-Peucker (epsilon ~0.35 original px) and written as
 *      one even-odd path. Coordinates are rounded to 2 decimals.
 * It writes src/components/brand/brandPaths.ts (consumed by the inline <BrandMark>/<BrandLogo>) and
 * the standalone SVG files in public/brand/. The colours are the originals' own: this redraws the
 * existing logo as vectors, it does not redesign it.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const SCALE = 4;
const BLUR = 3.4; // upscaled px: smooths the mask before it is traced
const EPSILON = 3.6; // in upscaled px (= 0.85 original px): sharp corners survive, pixel staircases do not

const SOURCES = {
  mark: join(root, "brand-src", "learnthrive-mark.png"),
  logo: join(root, "brand-src", "learnthrive-logo.png"),
};

// The originals' colours, sampled from the files.
const NAVY = [17, 44, 75];
const GREEN = [20, 134, 75];

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function smooth(mask, width, height) {
  // Blur the 0/255 mask and threshold again: rounds the one-pixel staircases of the upscale so the
  // contour (and the simplified path) is smooth rather than wobbly.
  const grey = Buffer.alloc(width * height);
  for (let i = 0; i < grey.length; i++) grey[i] = mask[i] ? 255 : 0;
  const blurred = await sharp(grey, { raw: { width, height, channels: 1 } }).blur(BLUR).extractChannel(0).raw().toBuffer();
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = blurred[i] >= 128 ? 1 : 0;
  return out;
}

async function classify(path, hasAlpha) {
  const meta = await sharp(path).metadata();
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .resize({ width: meta.width * SCALE, kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const navy = new Uint8Array(width * height);
  const green = new Uint8Array(width * height);
  // Background colour of an opaque logo: its top-left pixel.
  const bg = [data[0], data[1], data[2]];
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const alpha = data[o + 3];
    if (hasAlpha ? alpha < 110 : dist([r, g, b], bg) < 70) continue; // background
    // Hue decides, not nearest-colour: an anti-aliased edge between navy and a light background is
    // bluish-grey, never green, so it must not leak into the green mask.
    if (g - r > 28 && g - b > 22) green[i] = 1;
    else if (b - r > 14 && b >= g - 4 && r + g + b < 420) navy[i] = 1;
  }
  return { navy: await smooth(navy, width, height), green: await smooth(green, width, height), width, height };
}

/** Marching squares: every closed boundary of a binary mask, as arrays of [x, y] (pixel-edge coordinates). */
function boundaries(mask, width, height) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
  const next = new Map(); // directed edge start-key -> end point
  const key = (x, y) => `${x},${y}`;
  const add = (ax, ay, bx, by) => {
    const k = key(ax, ay);
    const list = next.get(k);
    if (list) list.push([bx, by]);
    else next.set(k, [[bx, by]]);
  };
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const c = tl | (tr << 1) | (br << 2) | (bl << 3);
      if (c === 0 || c === 15) continue;
      // Edge midpoints in doubled coordinates so keys stay integers.
      const T = [2 * x + 2, 2 * y + 1], R = [2 * x + 3, 2 * y + 2], B = [2 * x + 2, 2 * y + 3], L = [2 * x + 1, 2 * y + 2];
      const seg = (p, q) => add(p[0], p[1], q[0], q[1]);
      switch (c) {
        case 1: seg(L, T); break;
        case 2: seg(T, R); break;
        case 3: seg(L, R); break;
        case 4: seg(R, B); break;
        case 5: seg(L, B); seg(R, T); break; // saddle
        case 6: seg(T, B); break;
        case 7: seg(L, B); break;
        case 8: seg(B, L); break;
        case 9: seg(B, T); break;
        case 10: seg(T, L); seg(B, R); break; // saddle
        case 11: seg(B, R); break;
        case 12: seg(R, L); break;
        case 13: seg(R, T); break;
        case 14: seg(T, L); break;
      }
    }
  }
  const loops = [];
  for (const [startKey] of next) {
    while (next.get(startKey)?.length) {
      const [sx, sy] = startKey.split(",").map(Number);
      const loop = [[sx, sy]];
      let [cx, cy] = [sx, sy];
      for (;;) {
        const list = next.get(key(cx, cy));
        if (!list || list.length === 0) break;
        const [nx, ny] = list.pop();
        if (nx === sx && ny === sy) break;
        loop.push([nx, ny]);
        [cx, cy] = [nx, ny];
      }
      if (loop.length > 8) loops.push(loop.map(([px, py]) => [px / 2, py / 2]));
    }
  }
  return loops;
}

function perpendicular(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

function rdp(points, eps) {
  if (points.length < 3) return points;
  let index = 0, max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > max) { max = d; index = i; }
  }
  if (max > eps) {
    const left = rdp(points.slice(0, index + 1), eps);
    return left.slice(0, -1).concat(rdp(points.slice(index), eps));
  }
  return [points[0], points[points.length - 1]];
}

function simplifyLoop(loop, eps) {
  // Split the ring at two far-apart points so RDP has stable anchors.
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < loop.length; i += Math.max(1, Math.floor(loop.length / 64))) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > best) { best = d; b = i; }
  }
  const first = rdp(loop.slice(a, b + 1), eps);
  const second = rdp(loop.slice(b).concat([loop[0]]), eps);
  return first.slice(0, -1).concat(second.slice(0, -1));
}

function pathOf(loops, offsetX, offsetY) {
  const f = (v) => (Math.round(v * 100) / 100).toString();
  return loops
    .map((loop) => {
      const pts = simplifyLoop(loop, EPSILON).map(([x, y]) => [(x - offsetX) / SCALE, (y - offsetY) / SCALE]);
      if (pts.length < 3) return "";
      return `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
    })
    .filter(Boolean)
    .join("");
}

function bbox(loops) {
  let minX = 1e9, minY = 1e9, maxX = 0, maxY = 0;
  for (const loop of loops) for (const [x, y] of loop) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
}

async function trace(name, hasAlpha) {
  const { navy, green, width, height } = await classify(SOURCES[name], hasAlpha);
  const navyLoops = boundaries(navy, width, height);
  const greenLoops = boundaries(green, width, height);
  const all = navyLoops.concat(greenLoops);
  const box = bbox(all);
  const pad = 2 * SCALE;
  const ox = box.minX - pad, oy = box.minY - pad;
  const w = Math.round(((box.maxX - box.minX + 2 * pad) / SCALE) * 100) / 100;
  const h = Math.round(((box.maxY - box.minY + 2 * pad) / SCALE) * 100) / 100;
  return { width: w, height: h, navy: pathOf(navyLoops, ox, oy), green: pathOf(greenLoops, ox, oy) };
}

if (!existsSync(SOURCES.mark) || !existsSync(SOURCES.logo)) {
  console.error("Missing brand-src/learnthrive-mark.png or brand-src/learnthrive-logo.png (the original rasters).");
  process.exit(1);
}

const mark = await trace("mark", true);
const logo = await trace("logo", false);

const colours = { navy: `#${NAVY.map((v) => v.toString(16).padStart(2, "0")).join("")}`, green: `#${GREEN.map((v) => v.toString(16).padStart(2, "0")).join("")}` };

mkdirSync(join(root, "src", "components", "brand"), { recursive: true });
writeFileSync(
  join(root, "src", "components", "brand", "brandPaths.ts"),
  `// Generated by scripts/trace-brand.mjs from the original brand rasters — do not edit by hand.\n` +
    `export const brandColours = ${JSON.stringify(colours)} as const;\n` +
    `export const brandMarkPaths = ${JSON.stringify(mark)} as const;\n` +
    `export const brandLogoPaths = ${JSON.stringify(logo)} as const;\n`,
);

const svg = (shape, navy, green) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${shape.width} ${shape.height}" width="${shape.width}" height="${shape.height}" role="img" aria-label="LearnThrive Tuition">` +
  `<path fill="${navy}" fill-rule="evenodd" d="${shape.navy}"/><path fill="${green}" fill-rule="evenodd" d="${shape.green}"/></svg>\n`;

const out = join(root, "public", "brand");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "learnthrive-mark.svg"), svg(mark, colours.navy, colours.green));
writeFileSync(join(out, "learnthrive-logo.svg"), svg(logo, colours.navy, colours.green));
// For dark backgrounds: the navy ink becomes a soft off-white, the green a lighter green.
writeFileSync(join(out, "learnthrive-mark-light.svg"), svg(mark, "#eef4f8", "#5fd08e"));
writeFileSync(join(out, "learnthrive-logo-light.svg"), svg(logo, "#eef4f8", "#5fd08e"));
writeFileSync(join(out, "learnthrive-mark-mono.svg"), svg(mark, "#0e2a47", "#0e2a47"));

console.log(`mark ${mark.width}x${mark.height}  navy ${mark.navy.length} B  green ${mark.green.length} B`);
console.log(`logo ${logo.width}x${logo.height}  navy ${logo.navy.length} B  green ${logo.green.length} B`);
