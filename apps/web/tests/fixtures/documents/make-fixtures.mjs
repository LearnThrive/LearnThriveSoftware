#!/usr/bin/env node
/**
 * Builds the document regression fixtures for LearnThrive AI (the PDF/image ingestion tests). Run once; the outputs are committed so the
 * tests are deterministic:   node tests/fixtures/documents/make-fixtures.mjs
 *
 * Real producers on purpose: the text PDFs are printed by Chromium (subset CID fonts with ToUnicode maps, exactly what browsers, Word
 * and exam boards produce), the scans are real raster pages embedded by pdf-lib, and the photos are real screenshots. Every document
 * carries a question with ONE known answer, so a test can check that the content actually reached the model.
 *
 *   text-native.pdf        Chromium-printed worksheet                       Q: Solve 2x + 7 = 19             A: x = 6
 *   gcse-multipage.pdf     3 pages: fractions, indices, simultaneous, word   Q3 (page 2): 3/4 + 1/8           A: 7/8
 *   mixed.pdf              text, a vector triangle and a raster table        the sides are ONLY in the picture  A: 10 cm
 *   scan-flate.pdf         one page that is a PNG (Flate) image             Q: What is 3/4 of 24?             A: 18
 *   scan-jpeg.pdf          one page that is a JPEG (DCT) image              same question                     A: 18
 *   outlined-text.pdf      Chromium PDF with its text maps removed: no extractable text, but the page renders clearly
 *                                                                           Q: Calculate 15% of 80            A: 12
 *   worksheet.png / .jpg   a photographed-style worksheet                    Q: Work out 7 x 8                 A: 56
 *   worksheet-rotated.jpg  the same page stored sideways with EXIF orientation 6 (how phones save portrait photos)
 *   permissions-only.pdf   encrypted with an EMPTY open password (print/copy restrictions only), as many exam-board PDFs are: must be read
 *   password-locked.pdf    needs a password to open: must be refused with a clear reason
 *   (the two above are made with pypdf: uv run --no-project --with pypdf==5.1.0 --with cryptography, see the note at the end)
 *   malformed.pdf          starts like a PDF, then garbage
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
const out = (name, bytes) => writeFileSync(join(here, name), bytes);

const PAGE = `body{font-family:Arial,Helvetica,sans-serif;font-size:15pt;margin:48px;color:#111}h1{font-size:20pt}h2{font-size:16pt;margin-top:28px}.q{margin:18px 0}.box{border:1px solid #444;height:90px;margin-top:8px}.frac{display:inline-flex;flex-direction:column;text-align:center;vertical-align:middle;font-size:13pt}.frac span:first-child{border-bottom:1px solid #111}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });

async function pdf(html) {
  await page.setContent(`<!doctype html><html><head><style>${PAGE}</style></head><body>${html}</body></html>`);
  return page.pdf({ format: "A4", printBackground: true });
}
async function shot(html, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><head><style>${PAGE}</style></head><body>${html}</body></html>`);
  return page.screenshot({ type: "png", fullPage: false });
}

// 1. A text-native worksheet.
out("text-native.pdf", await pdf(`<h1>Algebra worksheet</h1><div class="q"><b>Question 1.</b> Solve 2x + 7 = 19. Give the value of x.</div><div class="box"></div><div class="q"><b>Question 2.</b> Expand 3(x + 4).</div><div class="box"></div>`));

// 2. A multipage GCSE-style paper.
out(
  "gcse-multipage.pdf",
  await pdf(`<h1>GCSE Mathematics practice paper</h1><p>Answer all questions. Show your working.</p>
  <h2>Question 1 (2 marks)</h2><p>Simplify x<sup>5</sup> &times; x<sup>3</sup>.</p><div class="box"></div>
  <h2>Question 2 (3 marks)</h2><p>Solve the simultaneous equations 2x + y = 11 and x &minus; y = 1.</p><div class="box"></div>
  <div style="page-break-before:always"></div>
  <h2>Question 3 (2 marks)</h2><p>Work out <span class="frac"><span>3</span><span>4</span></span> + <span class="frac"><span>1</span><span>8</span></span>. Give your answer as a fraction.</p><div class="box"></div>
  <h2>Question 4 (3 marks)</h2><p>A coat costs &pound;80. In a sale the price is reduced by 15%. Work out the sale price.</p><div class="box"></div>
  <div style="page-break-before:always"></div>
  <h2>Question 5 (2 marks)</h2><p>Write 0.000 52 in standard form.</p><div class="box"></div>`),
);

// 3. Mixed: the numbers needed are only in pictures (a vector triangle and a raster label image).
const label = await shot(`<div style="font-size:40pt;font-weight:bold;padding:20px">AB = 6 cm &nbsp; BC = 8 cm</div>`, 700, 140);
const labelUrl = `data:image/png;base64,${label.toString("base64")}`;
out(
  "mixed.pdf",
  await pdf(`<h1>Pythagoras</h1><div class="q"><b>Question 1.</b> The diagram shows a right-angled triangle ABC with the right angle at B. Use the lengths in the picture to work out the length of AC.</div>
  <svg width="360" height="260" viewBox="0 0 360 260"><polygon points="40,220 40,40 320,220" fill="none" stroke="#111" stroke-width="3"/><rect x="40" y="200" width="20" height="20" fill="none" stroke="#111" stroke-width="2"/></svg>
  <div><img src="${labelUrl}" width="420"></div><div class="box"></div>`),
);

// 4 and 5. Scans: a page that is only a picture.
await page.setViewportSize({ width: 1240, height: 1754 });
const scanPng = await shot(`<div style="font-size:30pt;padding:60px"><h1 style="font-size:40pt">Homework</h1><p><b>Question 1.</b> What is 3/4 of 24?</p><p style="margin-top:400px">Name: ________</p></div>`, 1240, 1754);
await page.setContent(`<img id="i" src="data:image/png;base64,${scanPng.toString("base64")}">`);
const scanJpeg = await page.locator("#i").screenshot({ type: "jpeg", quality: 80 });
for (const [name, embed] of [["scan-flate.pdf", (d) => d.embedPng(scanPng)], ["scan-jpeg.pdf", (d) => d.embedJpg(scanJpeg)]]) {
  const doc = await PDFDocument.create();
  const image = await embed(doc);
  const p = doc.addPage([595, 842]);
  p.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  out(name, await doc.save());
}

// 6. Clear on the page, but no extractable text: Chromium PDF with every font's ToUnicode map removed (glyph ids only).
{
  const source = await pdf(`<h1>Percentages</h1><div class="q"><b>Question 1.</b> Calculate 15% of 80.</div><div class="box"></div>`);
  const doc = await PDFDocument.load(source);
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict && object.lookup(PDFName.of("Type")) === PDFName.of("Font")) object.delete(PDFName.of("ToUnicode"));
  }
  out("outlined-text.pdf", await doc.save());
}

// 7. Photos of a worksheet, upright and sideways.
const sheet = `<div style="font-size:28pt;padding:40px;background:#fdfcf6;height:600px"><h1>Times tables</h1><p><b>Question 1.</b> Work out 7 x 8.</p><p>Answer: ________</p></div>`;
const sheetPng = await shot(sheet, 900, 700);
out("worksheet.png", sheetPng);
await page.setContent(`<img id="i" src="data:image/png;base64,${sheetPng.toString("base64")}">`);
out("worksheet.jpg", await page.locator("#i").screenshot({ type: "jpeg", quality: 85 }));
// Stored rotated 90 degrees anticlockwise (pixels), with EXIF orientation 6 telling viewers to turn it clockwise: a phone's portrait photo.
await page.setViewportSize({ width: 700, height: 900 });
await page.setContent(`<div style="width:700px;height:900px;position:relative;overflow:hidden"><img src="data:image/png;base64,${sheetPng.toString("base64")}" style="position:absolute;left:-100px;top:100px;width:900px;height:700px;transform:rotate(-90deg)"></div>`);
const sideways = await page.screenshot({ type: "jpeg", quality: 85 });
const exif = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
out("worksheet-rotated.jpg", Buffer.concat([sideways.subarray(0, 2), exif, sideways.subarray(2)]));

// 8. Broken. (The two encrypted fixtures are made from text-native.pdf with pypdf:
//   w = PdfWriter(clone_from=PdfReader("text-native.pdf")); w.encrypt(user_password="" or "secret123", owner_password="owner-pass-xyz", algorithm="AES-128").)
out("malformed.pdf", Buffer.from("%PDF-1.7\n\u0000\u0001garbage that is not a PDF at all ÿþ\n"));

await browser.close();
console.log("fixtures written to", here);
