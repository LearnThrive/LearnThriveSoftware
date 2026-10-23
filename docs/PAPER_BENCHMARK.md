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
paper was run and are not to be changed after seeing a held-out result. Marking has its own thresholds, below.

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

## Marking a student's completed paper

Scoring is `src/lib/paper/benchMark.ts` (unit-tested in `tests/paperMarkingBench.test.mjs`); the harness section is the end of `npm run paper:bench`. It compares the marker with **work marked by a qualified person** and reports, apart from each other: transcription accuracy; exact mark agreement and the distribution of the mark error (on the questions the marker fully assessed); false positives and false negatives of the correct/incorrect decision, and so **the rate at which correct student work is marked wrong**; method-mark and follow-through agreement (follow-through should reach a person, not be guessed); blank, unreadable and answered told apart (a blank or unreadable answer called wrong is counted); and the **review rate**, the share sent to a person, which is also the coverage **excluded** from the agreement figures.

Thresholds (`MARKING_THRESHOLDS`, fixed before any held-out set is looked at): transcription at least 90%; exact agreement at least 85%; within one mark at least 97%; correct work marked wrong at most 2%; wrong work marked correct at most 2%; blank or unreadable called wrong: 0; sent to a person at most 35%. **No gate can be called met** on fewer than 300 human-marked questions from 10 students; a set with no wrong answers cannot measure the false-positive gate; synthetic responses never count towards a gate. The model's own confidence is not used anywhere as a measure of reliability. The sample sizes are the owner's to adjust, before the held-out run.

What the human-marked set must contain: a permissioned, anonymised set of **handwritten** responses independently marked by a qualified person, with valid alternative methods, partial credit, crossed-out working, poor scans and deliberately ambiguous handwriting. Describe it in `benchmarks/paper/marking-manifest.json` (same shape as the paper manifest: `file`, `sha256`, `split`, `provenance` saying who marked it and under what permission, `students`, and per question the `label`, `state`, the student's `answer` and `working`, `answerCorrect`, `marks`, `outOf`, `methodMarks`, `followThrough`, `conditions`). Run with `--provider ollama`.

**Status: UNVALIDATED.** No human-marked handwriting exists in this repository, so nothing here says how reliable automatic marking is on real work. The synthetic typed case (8 questions: right, wrong with method credit, answer only, blank, unreadable, crossed-out, doubted, alternative method) shows the pipeline behaves as designed: blank is a real zero, unreadable and doubted answers are sent to a person and not called wrong, 0 correct answers marked wrong, 3 of 8 sent to a person (which would exceed the 35% review threshold if it were real data). The release flag `PAPER_MARKS_RELEASED` keeps numeric marks off in production until the owner decides, informed by this validation.

## Status

- Harness, scoring, synthetic cases, manifest format and the held-out discipline: **implemented and tested**. Synthetic results: 4 cases run,
  extraction 100%, false "verified" 0 (see the generated results file).
- **Real papers: none have been run.** No external case is in the manifest, so the benchmark has measured nothing about real papers, and the
  release gate for the Paper Tutor on real papers is `unmeasured`. This needs the owner to supply and annotate papers.
- The real model (`qwen3.5:9b`) has not been run through the harness in this session.
- Marking: harness, thresholds and synthetic pipeline case implemented and tested; **validation on real human-marked handwriting: none**.
