#!/usr/bin/env node
/**
 * Study Buddy document check against a REAL model (the Gate 1 check): every fixture in tests/fixtures/documents is uploaded through
 * the same code the site uses (inspectChatUpload, then the chat service's sendMessage), sent to Ollama, and the answer is checked for
 * the one known answer the document's question has. Prints what reached the model (pages, pictures) and the verdict.
 *
 *   npm run documents:check                  (Ollama on 127.0.0.1:11434 with the default model, or ASSISTANT_MODEL)
 *   npm run documents:check -- --only mixed  (one fixture)
 *
 * Synthetic documents only. Nothing is stored outside memory.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { sendMessage } from "../src/lib/assistant/service.ts";
import { inspectChatUpload } from "../src/lib/assistant/uploads.ts";
import { MemoryLibraryStorage } from "../src/lib/library/storage.ts";
import { InMemoryLibraryStore } from "../../../packages/data/src/library/memory.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "tests", "fixtures", "documents");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const CHECK = "I have finished and only want to check my answer, so please tell me the final answer.";

const CASES = [
  { file: "text-native.pdf", ask: `What is x in question 1? ${CHECK}`, expect: /x\s*=\s*6\b/, saw: /2x\s*\+\s*7\s*=\s*19/ },
  { file: "gcse-multipage.pdf", ask: `What is the answer to question 3? ${CHECK}`, expect: /7\s*\/\s*8|\\frac\{7\}\{8\}|seven.eighths/i, saw: /3\s*\/\s*4|\\frac\{3\}\{4\}|three.quarters/i },
  { file: "gcse-multipage.pdf", ask: `What is the sale price in question 4? ${CHECK}`, expect: /£\s*68\b|\b68\b/, saw: /£?\s*80\b[\s\S]*15|15[\s\S]*£?\s*80\b/ },
  { file: "gcse-multipage.pdf", ask: `Solve the simultaneous equations in question 2. ${CHECK}`, expect: /x\s*=\s*4\b[\s\S]*y\s*=\s*3\b|y\s*=\s*3\b[\s\S]*x\s*=\s*4\b/, saw: /2x\s*\+\s*y\s*=\s*11/ },
  { file: "mixed.pdf", ask: `How long is AC? ${CHECK}`, expect: /\b10\s*(cm)?\b/, saw: /\b6\b[\s\S]*\b8\b|\b8\b[\s\S]*\b6\b/ },
  { file: "scan-flate.pdf", ask: `What is the answer to the question on this homework? ${CHECK}`, expect: /\b18\b/, saw: /3\s*\/\s*4|\\frac\{3\}\{4\}/ },
  { file: "scan-jpeg.pdf", ask: `What is the answer to the question on this homework? ${CHECK}`, expect: /\b18\b/, saw: /3\s*\/\s*4|\\frac\{3\}\{4\}/ },
  { file: "outlined-text.pdf", ask: `What is the answer to question 1? ${CHECK}`, expect: /\b12\b/, saw: /15\s*\\?%[\s\S]*80|80[\s\S]*15\s*\\?%/ },
  { file: "permissions-only.pdf", ask: `What is x in question 1? ${CHECK}`, expect: /x\s*=\s*6\b/, saw: /2x\s*\+\s*7\s*=\s*19/ },
  { file: "worksheet.jpg", ask: `What is the answer to the question in this photo? ${CHECK}`, expect: /\b56\b/, saw: /7\s*(x|×|\\times)\s*8/ },
  { file: "worksheet.png", ask: `What is the answer to the question in this photo? ${CHECK}`, expect: /\b56\b/, saw: /7\s*(x|×|\\times)\s*8/ },
  { file: "worksheet-rotated.jpg", ask: `What is the answer to the question in this photo? ${CHECK}`, expect: /\b56\b/, saw: /7\s*(x|×|\\times)\s*8/ },
  // A locked file is refused at upload with the reason, never sent on.
  { file: "password-locked.pdf", ask: "What is question 1?", refused: /needs a password/ },
];

const env = { NODE_ENV: "development", ASSISTANT_PROVIDER: "ollama", ASSISTANT_MAX_OUTPUT_TOKENS: "500", ...process.env };
const config = assistantConfig(env);
const provider = new OllamaProvider({ baseUrl: env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434", model: config.model, visionModel: config.visionModel ?? undefined, contextSize: config.contextSize });
const health = await provider.health();
if (!health.ok) {
  console.error(`Ollama is not ready (${health.detail}). Start it and pull ${config.model}.`);
  process.exit(2);
}

let passed = 0;
let read = 0;
let ran = 0;
for (const c of CASES.filter((x) => !only || x.file.includes(only))) {
  ran += 1;
  const store = new InMemoryLibraryStore();
  const uploads = new MemoryLibraryStorage();
  const clientId = await store.accounts.ensureClient(store.seedProfile({ displayName: "Check" }));
  const upload = await inspectChatUpload(c.file, new Uint8Array(readFileSync(join(dir, c.file))));
  if (!upload.ok) {
    const fine = c.refused?.test(upload.problem.message) ?? false;
    if (fine) read += 1;
    if (fine) passed += 1;
    console.log(`${fine ? "REFUSED " : "FAIL    "}  ${c.file.padEnd(22)} at upload: ${upload.problem.message}`);
    continue;
  }
  const session = await store.chat.createSession(clientId, { title: "check" }, new Date());
  await uploads.put(`${session.id}/f`, upload.bytes, upload.contentType);
  const file = await store.chat.addFile(clientId, session.id, { storagePath: `${session.id}/f`, bytes: upload.bytes.length, contentType: upload.contentType }, new Date());
  const seen = { pictures: 0, pages: "" };
  const watching = { ...provider, id: provider.id, capabilities: (m) => provider.capabilities(m), health: (s) => provider.health(s), stream: (messages, options) => {
    const last = messages.at(-1);
    seen.pictures = last.images?.length ?? 0;
    seen.pages = [...last.content.matchAll(/<page number="(\d+)"( picture="\d+")?/g)].map((m) => `${m[1]}${m[2] ? "*" : ""}`).join(",");
    return provider.stream(messages, options);
  } };
  let answer = "";
  let error = null;
  const started = Date.now();
  for await (const event of sendMessage({ store, provider: watching, queue: new GenerationQueue(1, 4), uploads, config, hosted: false }, { clientId, sessionId: session.id, text: c.ask, fileIds: [file.id] })) {
    if (event.type === "delta") answer += event.text;
    if (event.type === "error") error = event.code;
  }
  // "Read" means the reply shows the document's own content (the question's numbers) even if it then guides instead of giving the
  // final answer: the tutor prompt is hints-first. "Answered" means it also gave the known answer.
  const answered = !error && c.expect.test(answer);
  const saw = !error && (answered || c.saw.test(answer));
  if (answered) passed += 1;
  if (saw) read += 1;
  console.log(`${answered ? "ANSWERED" : saw ? "READ    " : "FAIL    "}  ${c.file.padEnd(22)} kind=${upload.kind.padEnd(9)} pages=[${seen.pages || "-"}] pictures=${seen.pictures} ${((Date.now() - started) / 1000).toFixed(1)}s${error ? ` error=${error}` : ""}`);
  if (!answered || process.argv.includes("--verbose")) console.log(`      ${answer.replace(/\s+/g, " ").slice(0, 300)}`);
}
console.log(`\n${read}/${ran} replies show the document's content; ${passed}/${ran} also gave the final answer (model ${config.model}).`);
process.exit(read === ran ? 0 : 1);
