/**
 * plan15 Wave 9 section 13.2: a repeatable image pipeline.
 *
 *   node scripts/optimise-images.mjs            # all images named in scripts/images.config.json
 *   node scripts/optimise-images.mjs maths      # only entries whose name contains "maths"
 *   node scripts/optimise-images.mjs --check    # report only; change nothing (CI-friendly: exits 1 if over budget)
 *
 * Originals live in an UNTRACKED folder, `apps/web/assets-src/` (gitignored), so multi-megabyte
 * camera files are never committed again. This script reads <name>.<ext> from there and writes the
 * web-ready master to `public/images/<name>.jpg`:
 *   - optional deliberate crop (fractions of the original), so a portrait photo shown in a landscape
 *     card is framed on purpose instead of by `object-fit: cover`'s centre guess;
 *   - longest edge capped (default 2400px), mozjpeg at the entry's quality, metadata stripped;
 *   - a byte budget per entry (default 400 KB for a large photo, 150 KB for a portrait) that the
 *     script enforces by lowering quality in steps until it fits, and fails loudly if it cannot.
 * next/image then serves AVIF/WebP/JPEG variants per request from this master (`images.formats` in
 * next.config.ts), so the master is the only file worth committing. It also writes
 * `src/lib/imageBlur.generated.ts`: a ~24px base64 JPEG per image for `placeholder="blur"`.
 *
 * sharp is already in the tree (Next uses it for the optimiser); it is not a new dependency.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const SRC = join(root, "assets-src");
const OUT = join(root, "public", "images");
const config = JSON.parse(readFileSync(join(import.meta.dirname, "images.config.json"), "utf8"));
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const filter = args.find((arg) => !arg.startsWith("--"));

const KB = 1024;
const blurs = {};
let failed = false;

function findOriginal(name) {
  for (const ext of ["jpg", "jpeg", "png", "webp", "tif", "tiff"]) {
    const path = join(SRC, `${name}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
}

async function render(path, entry, quality) {
  let image = sharp(path, { failOn: "none" }).rotate(); // honour EXIF orientation, then strip it
  if (entry.crop) {
    const { width, height } = await sharp(path).rotate().metadata();
    image = sharp(await sharp(path).rotate().extract({
      left: Math.round(entry.crop.left * width),
      top: Math.round(entry.crop.top * height),
      width: Math.round(entry.crop.width * width),
      height: Math.round(entry.crop.height * height),
    }).toBuffer());
  }
  return image
    .resize({ width: entry.maxEdge, height: entry.maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer({ resolveWithObject: true });
}

for (const [name, entry] of Object.entries(config.images)) {
  if (filter && !name.includes(filter)) continue;
  const original = findOriginal(name);
  const target = join(OUT, `${name}.jpg`);
  const budget = (entry.budgetKb ?? (entry.kind === "portrait" ? 150 : 400)) * KB;

  if (!original) {
    // Nothing to process (the original is not on this machine): still verify what is committed.
    if (existsSync(target)) {
      const size = statSync(target).size;
      const over = size > budget;
      console.log(`${over ? "OVER " : "ok   "} ${name}.jpg  ${(size / KB).toFixed(0)} KB (budget ${budget / KB} KB) — no original in assets-src/, left as is`);
      if (over) failed = true;
      // The blur placeholder only needs the committed file.
      const tiny = await sharp(target).resize({ width: 24 }).blur(0.6).jpeg({ quality: 60 }).toBuffer();
      blurs[`/images/${name}.jpg`] = `data:image/jpeg;base64,${tiny.toString("base64")}`;
    } else console.log(`skip  ${name}: no original and nothing committed`);
    continue;
  }

  let quality = entry.quality ?? 78;
  let result = await render(original, entry, quality);
  while (result.data.length > budget && quality > 52) {
    quality -= 4;
    result = await render(original, entry, quality);
  }
  const fits = result.data.length <= budget;
  if (!fits) failed = true;
  console.log(
    `${fits ? "ok   " : "OVER "} ${name}.jpg  ${result.info.width}x${result.info.height}  q${quality}  ${(result.data.length / KB).toFixed(0)} KB (budget ${budget / KB} KB)`,
  );
  if (!checkOnly) {
    await mkdir(OUT, { recursive: true });
    writeFileSync(target, result.data);
  }
  const tiny = await sharp(result.data).resize({ width: 24 }).blur(0.6).jpeg({ quality: 60 }).toBuffer();
  blurs[`/images/${name}.jpg`] = `data:image/jpeg;base64,${tiny.toString("base64")}`;
}

if (!checkOnly && Object.keys(blurs).length > 0) {
  const generated = join(root, "src", "lib", "imageBlur.generated.ts");
  let existing = {};
  if (existsSync(generated)) {
    const match = readFileSync(generated, "utf8").match(/= (\{[\s\S]*\}) as const;/);
    if (match) existing = JSON.parse(match[1]);
  }
  const merged = Object.fromEntries(Object.entries({ ...existing, ...blurs }).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    generated,
    `// Generated by scripts/optimise-images.mjs — do not edit. ~24px blurred JPEGs for next/image's\n// \`placeholder="blur"\`, keyed by public path.\nexport const imageBlur: Record<string, string> = ${JSON.stringify(merged, null, 2)} as const;\n`,
  );
}

if (failed) {
  console.error("\nAt least one image is over its byte budget.");
  process.exit(1);
}
