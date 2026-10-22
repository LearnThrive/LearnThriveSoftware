# Paper Tutor benchmark

What this is: a repeatable way to measure the Paper Tutor on whole papers, and a set of numbers a release is held to. Built 2026-10-22 on
`feature/production-completion`. The harness is `apps/web/scripts/paper-bench.mjs` (`npm run paper:bench`), the scoring is
`src/lib/paper/bench.ts` (unit-tested in `tests/paperBench.test.mjs`), the cases are in `src/lib/paper/benchRun.ts` and
`apps/web/benchmarks/paper/manifest.json`. Latest output: `docs/PAPER_BENCHMARK_RESULTS.md` (generated).

## What it measures, kept apart

| Measure | Question it answers |
| --- | --- |
| Extraction recall / precision | Were the right questions found, by printed label (`1(a)`, `2(b)(ii)`), and nothing invented? Order is checked too |
| Transcription | Are the printed words of each question in the text that was read? (Containment, so a stem added to a part is not held against it) |
| Answer accuracy | Is the final answer the annotator's answer? Compared by value and by algebra; a solution set in any order is the same set; a rounded decimal for an exact value is not |
| Verified coverage | Of the right answers, how many did the checker vouch for? |
| **False "verified"** | **Wrong answers the checker vouched for.** The one number that cannot be traded off: the release threshold is 0 |
| Placement | Is every written answer inside the paper, over no printing, at 11 pt or more? |
| Run time | Seconds per case |

A case that was **not run** (no file, a hash that does not match, a real model needed and not given) is reported as NOT RUN and never counted
as a pass. A threshold nobody measured is `unmeasured`, never `met`.

## Release thresholds (`RELEASE_THRESHOLDS` in `bench.ts`)

Extraction recall and precision at least 95%, transcription at least 90%, false "verified" 0, bad placements 0. They were set before any real
paper was run and are not to be changed after seeing a held-out result. Marking has its own thresholds (see `docs/ASSISTANT.md`, Paper marker).

## Two kinds of case

**Synthetic** (built by the harness; no copyrighted paper is committed or needed). Four cases: a worksheet of whole questions; a GCSE-shaped
paper (cover, formulae page, stems, parts, numerals, a blank page); a 120-question paper over many pages; and a set of **traps**: answers that
satisfy a substitution check but are not the answer (`x = 2` for `x² = 4`, `0.8333…` for `5/6`, `0.66` for `2/3` to 2 d.p., a wrong answer, a
half solution set). The traps use a stand-in model that says exactly what the case says, wrongly on purpose, so they test the pipeline and the
checker. **They are not evidence about real papers or about a real model.**

**External** (real papers; the owner supplies them). To add one:

1. Download the paper from the exam board's site yourself and check its terms of use. **Do not commit it**: `apps/web/benchmarks/paper/data/` is
   git-ignored. Put it there as `<id>.pdf`.
2. Compute its SHA-256 (`certutil -hashfile <file> SHA256` on Windows).
3. Add an entry to `manifest.json` (the `example` entry shows the shape): `id`, `title`, `split`, `source` (board, series, **URL**, licence),
   `file`, `sha256`, and `expected`: the page count, the pages that hold no questions, and **every question part** with its printed label, a
   distinctive piece of its printed text, its right final answer (the mark scheme's, as the annotator writes it) and its marks.
4. Run `npm run paper:bench -- --provider ollama --model qwen3.5:9b` (answers need a real model; `--no-solve` measures extraction alone).

Annotate by hand and have the expected answers checked by a second person: the benchmark is only as right as its annotation.

## Development and held-out

Each case is `dev` or `heldout`. **Tune on `dev` only.** Held-out cases are run to report, not to improve: the harness records every run of an
external held-out case in `benchmarks/paper/heldout-runs.json` and prints the count, and a held-out result must not drive a code change (the case
then stops being held out and a fresh one is needed). Keep at least a third of the external papers held out, from a different series than the
development ones.

## What the benchmark has found so far

Writing the synthetic cases found real defects in the checker, now fixed and covered by tests (`paperVerification.test.mjs`): marks printed after
a question (`(2)`) were read as part of the maths, so `Solve x² = 4 (2)` was checked as `x² = 4 × 2`; a part's stem (`Expand each expression`) hid
the part's own expression; `12 x 7` was not read as a multiplication; and a working line that listed the solutions (`x = 3 or x = 2`) was judged
as a chain of equal expressions.

## Status

- Harness, scoring, synthetic cases, manifest format and the held-out discipline: **implemented and tested**. Synthetic results: 4 cases run,
  extraction 100%, false "verified" 0 (see the generated results file).
- **Real papers: none have been run.** No external case is in the manifest, so the benchmark has measured nothing about real papers, and the
  release gate for the Paper Tutor on real papers is `unmeasured`. This needs the owner to supply and annotate papers.
- The real model (`qwen3.5:9b`) has not been run through the harness in this session.
