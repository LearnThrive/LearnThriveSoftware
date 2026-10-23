import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { photoToPdf } from "../src/lib/paper/paper.ts";
import { ask } from "../src/lib/paper/solve.ts";
import { renderPdfPages } from "../src/lib/assistant/documents.ts";
const config = assistantConfig({ ...process.env, ASSISTANT_PROVIDER: "ollama" });
const provider = new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", model: config.model, visionModel: config.visionModel ?? undefined, contextSize: config.contextSize, keepAlive: config.keepAlive });
const deps = { provider, queue: new GenerationQueue(1, 4), model: config.model, visionModel: config.visionModel ?? config.model };
const pdf = await photoToPdf(new Uint8Array(readFileSync(process.argv[2])), "image/png");
const [r] = await renderPdfPages(pdf, { scale: 2.5 });
const crop = (l, t, rr, b) => { const w = Math.round((rr - l) * r.width), h = Math.round((b - t) * r.height); const c = createCanvas(w, h); const ctx = c.getContext("2d"); const src = createCanvas(r.width, r.height); src.getContext("2d").putImageData(new ImageData(r.data, r.width, r.height), 0, 0); ctx.drawImage(src, Math.round(l * r.width), Math.round(t * r.height), w, h, 0, 0, w, h); return c.toBuffer("image/jpeg", 90).toString("base64"); };
const PROMPT = 'This is a strip of an exam page. List the mark allocations printed in it: whole numbers inside round or square brackets, such as (4) or [2 marks], usually at the right-hand end of a line below a question. Reply with JSON only: {"marks": [4]} in top-to-bottom order, or {"marks": []} if there are none. Copy the digits exactly; do not guess.';
for (const [name, box] of [["right 35% full", [0.65, 0, 1, 1]], ["right 35% lower half", [0.65, 0.5, 1, 1]], ["full page", [0, 0, 1, 1]]]) {
  const out = await ask(deps, [{ role: "system", content: PROMPT }, { role: "user", content: "The strip:", images: [crop(...box)] }], true);
  console.log(name, out.trim().slice(0, 120));
}
