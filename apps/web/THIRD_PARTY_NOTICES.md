# Third-party notices

LearnThrive's interface includes original, substantially adapted CSS ideas informed by components published on [Uiverse](https://uiverse.io/). No external Uiverse package, script, font, or runtime asset is shipped with the site.

The following references are retained for attribution and licence traceability:

- CTA arrow and pressed-state treatment: [Lunar / reshades](https://uiverse.io/reshades/dull-snake-38) — Copyright (c) 2026 reshades (Lunar).
- Subject-card icon halo: [Pradeep Saran](https://uiverse.io/Pradeepsaranbishnoi/quick-horse-75) — Copyright (c) 2026 Pradeepsaranbishnoi (Pradeep Saran).
- Feature-card lift and base-shadow idea: [Astronaut](https://uiverse.io/uiverse-astronaut/serious-badger-44) — credited to uiverse-astronaut. The LearnThrive implementation uses the interaction idea only.
- Testimonial quote hierarchy: [Alex Maracinaru](https://uiverse.io/alexmaracinaru/tender-fly-40) — Copyright (c) 2026 alexmaracinaru (Alex Maracinaru).
- Persistent outlined form labels: [kameHame HA](https://uiverse.io/kamehame-ha/lovely-fly-87) — Copyright (c) 2026 kamehame-ha (kameHame HA).
- Static dotted surface: [kotsu](https://uiverse.io/kennyotsu/short-warthog-33) — credited to kennyotsu (kotsu).
- LearnThrive AI input and voice orb (`AiInput`, `VoiceOrb`): [Cobp](https://uiverse.io/Cobp) — rebuilt as React with CSS Modules from the Uiverse "Chat" component (plan19). Copyright (c) Cobp.
- Library menu (`HubNav`): [Admin12121](https://uiverse.io/Admin12121) — icon artwork and the expanding-label idea from the Uiverse "Radio" menu, with newly written CSS. Copyright (c) Admin12121.
- Sign-in card (`AuthCard`): [JohnnyCSilva](https://uiverse.io/JohnnyCSilva) — rebuilt from the Uiverse login card. Copyright (c) JohnnyCSilva.
- Pricing card (`PricingCard`): [emmanuelh-dev](https://uiverse.io/emmanuelh-dev) — rebuilt from the Uiverse subscription card without Tailwind. Copyright (c) emmanuelh-dev.
- Loading pencil (`PencilLoader`): [gustavofusco](https://uiverse.io/gustavofusco) — rebuilt from the Uiverse pencil loader as a compositor-only animation. Copyright (c) gustavofusco.

Each referenced Uiverse element is offered under the MIT License. The licence text follows.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notices and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Software added for the Library, LearnThrive AI and voice mode (plan19)

Runtime dependencies of the site (installed from npm, listed in `package.json`; each adds a few hundred kilobytes at most and none runs on a public marketing page):

| Package | Version | Licence | Why it was added instead of written |
| --- | --- | --- | --- |
| `pdf-lib` | 1.17.1 | MIT | Stamps the account holder's name and the time on a PDF download (and reads the pages of a PDF a student uploads). Writing a PDF writer is not a sensible use of time. |
| `postgres` | 3.4.9 | Unlicense | The database driver for the Library, billing and chat tables (Supabase's pooled connection), used only on the server. |
| `katex` and `@types/katex` | 0.19.0, 0.16.8 | MIT | Draws maths in LearnThrive AI answers. It is loaded only on the LearnThrive AI screen, only when an answer contains maths. |
| `pdfjs-dist` | 5.4.394 | Apache-2.0 | Reads the text of an uploaded PDF in reading order, with page numbers, and draws its pages as pictures for scans and diagrams (server only). |
| `@napi-rs/canvas` | 0.1.84 | MIT | The canvas pdf.js draws pages on, on the server, and the JPEG encoder for those pictures. Prebuilt native binary; no system libraries. |
| `jpeg-js`, `pngjs` (`@types/pngjs` 6.0.5, MIT) | 0.4.4, 7.0.0 | BSD-3-Clause, MIT | Decode uploaded photos in plain JavaScript, so a damaged file is a clear error rather than a crash of the native decoder; then turned upright and shrunk, with all metadata dropped. |
| `mathjax-full` | 3.2.2 | Apache-2.0 | The Paper Tutor: typesets the maths it writes on a paper as vector shapes (TeX to SVG paths, drawn by `pdf-lib`), so fractions and powers look right at any zoom. Server only. |
| `@pdf-lib/fontkit` | 1.1.1 | MIT | Lets `pdf-lib` embed the handwriting font below. |

Font: **Patrick Hand** (Copyright (c) 2010-2012 Patrick Wagesreiter), licensed under the SIL Open Font License 1.1, embedded in the Paper Tutor's annotated PDFs for the handwritten-style answers. The font file and its licence are in `apps/web/assets/fonts/` (`PatrickHand-Regular.ttf`, `PatrickHand-OFL.txt`). The OFL allows embedding in documents and bundling with software; the font is not sold on its own.

Development and test only (never shipped): `@electric-sql/pglite` 0.5.10 (Apache-2.0), an in-process Postgres used to run the real migrations in tests.

## Development tools that are NOT part of the site

Voice mode's speech sidecar (`services/voice`) and the benchmarks run on a developer's machine as a separate Python program. Nothing below is bundled with or linked into the website, and none of it is deployed. **Before any of it is considered for production, the owner needs a licence review**, because several parts are copyleft or carry their own model terms:

| Component | Licence (as declared by the package at the version used) | Note |
| --- | --- | --- |
| `faster-whisper` 1.2.1, `ctranslate2` 4.8.3, `onnxruntime` 1.31.0 | MIT | Speech recognition. The Whisper model weights it downloads (`base.en`, `small.en`, `small`, `medium.en`) are published by OpenAI under the MIT licence. |
| `piper-tts` 1.8.0 | **GPL-3.0-or-later** | Speech output. A copyleft licence: running it as a separate local program is one thing; shipping or hosting it as part of a product is another. Get advice before using it outside development. Each Piper voice (`en_GB-alba-medium`, `en_GB-jenny_dioco-medium`, `en_GB-northern_english_male-medium`) has its own licence on its model card in the `rhasspy/piper-voices` repository, which this repository did not check. |
| `kokoro-onnx` 0.6.1 and the Kokoro model | the package declares its licence in a LICENSE file; the model is published by its authors under Apache-2.0 (not independently confirmed here) | Used only in the benchmark. It depends on `phonemizer` (**GPL**) and `espeakng-loader` (espeak-ng is GPL-3.0). |
| `numpy`, `psutil` | BSD-3-Clause | Benchmark and audio handling. |
| Language models run through Ollama for development and benchmarking (`qwen3.5:9b`, `qwen3-vl:8b`, `qwen3.8:27b`, `gemma3:4b`, `llama-guard3:1b`) | Each model has its own terms (for example the Gemma terms of use and the Llama community licence). Not reviewed. | The production model is a separate choice under plan19 section 6, and its licence is part of that choice. |
