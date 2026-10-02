/**
 * plan15 Wave 10 section 14.1: the full icon set, generated from the vector mark so it can never drift
 * from it. Run after scripts/trace-brand.mjs:
 *
 *   node scripts/make-icons.mjs
 *
 * Writes (all from public/brand/learnthrive-mark.svg):
 *   src/app/icon.svg          the tab icon; adapts to a dark tab strip with prefers-color-scheme
 *   src/app/favicon.ico       16/32/48 px, PNG-in-ICO (every browser from IE9 and up reads it)
 *   src/app/apple-icon.png    180x180 for iOS: opaque (iOS fills transparency black), cream ground
 *   public/icons/icon-192.png, icon-512.png   PWA "any" icons on the cream ground
 *   public/icons/maskable-512.png             PWA maskable: light mark on navy inside the 80% safe zone
 * Next.js picks up icon.svg / favicon.ico / apple-icon.png from src/app by file convention.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const markSvg = readFileSync(join(root, "public", "brand", "learnthrive-mark.svg"), "utf8");
const lightSvg = readFileSync(join(root, "public", "brand", "learnthrive-mark-light.svg"), "utf8");
const CREAM = "#fbf8f2";
const NAVY = "#0e2a47";

// Pull the two path datas out of the traced SVG so the favicon can theme them with CSS.
const paths = [...markSvg.matchAll(/<path fill="([^"]+)" fill-rule="evenodd" d="([^"]+)"\/>/g)];
const viewBox = markSvg.match(/viewBox="([^"]+)"/)[1];
const [navyColour, navyPath] = [paths[0][1], paths[0][2]];
const [greenColour, greenPath] = [paths[1][1], paths[1][2]];

writeFileSync(
  join(root, "src", "app", "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><style>.n{fill:${navyColour}}.g{fill:${greenColour}}@media(prefers-color-scheme:dark){.n{fill:#eef4f8}.g{fill:#5fd08e}}</style><path class="n" fill-rule="evenodd" d="${navyPath}"/><path class="g" fill-rule="evenodd" d="${greenPath}"/></svg>\n`,
);

/** The mark centred on a square canvas, scaled so it occupies `fill` of the canvas's width. */
async function onGround(size, background, svg, fill) {
  const markSize = Math.round(size * fill);
  const mark = await sharp(Buffer.from(svg), { density: 600 }).resize({ width: markSize, height: markSize, fit: "inside" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const icons = join(root, "public", "icons");
mkdirSync(icons, { recursive: true });
writeFileSync(join(root, "src", "app", "apple-icon.png"), await onGround(180, CREAM, markSvg, 0.7));
writeFileSync(join(icons, "icon-192.png"), await onGround(192, CREAM, markSvg, 0.7));
writeFileSync(join(icons, "icon-512.png"), await onGround(512, CREAM, markSvg, 0.7));
// Maskable: platforms crop to a circle/squircle, so the mark stays inside the central 80%.
writeFileSync(join(icons, "maskable-512.png"), await onGround(512, NAVY, lightSvg, 0.56));

// favicon.ico: an ICONDIR header, one ICONDIRENTRY per size, then each size's PNG bytes.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => onGround(s, { r: 0, g: 0, b: 0, alpha: 0 }, markSvg, 0.96)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + sizes.length * 16;
const entries = pngs.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizes[i], 0);
  entry.writeUInt8(sizes[i], 1);
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync(join(root, "src", "app", "favicon.ico"), Buffer.concat([header, ...entries, ...pngs]));

console.log("icons written: icon.svg, favicon.ico, apple-icon.png, icons/icon-192.png, icons/icon-512.png, icons/maskable-512.png");
