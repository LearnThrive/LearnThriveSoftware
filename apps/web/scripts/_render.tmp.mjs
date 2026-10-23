import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { renderPdfPages, readPdfDocument } from "../src/lib/assistant/documents.ts";
const [, , file, out, scale = "1", pages = ""] = process.argv;
const bytes = new Uint8Array(readFileSync(file));
const wanted = pages ? pages.split(",").map(Number) : undefined;
const info = await readPdfDocument(bytes, { render: false, maxPages: 60 });
console.log(file.split("/").pop(), "pages:", info.ok ? info.pageCount : info.problem.message, info.ok ? info.pages.map((p) => `${p.number}:${p.textQuality}${p.hasPictures ? "+pic" : ""}`).join(" ") : "");
mkdirSync(out, { recursive: true });
for (const r of await renderPdfPages(bytes, { scale: Number(scale), pages: wanted })) writeFileSync(`${out}/p${r.number}.jpg`, r.jpeg());
