# Benchmark protocol: GCSE English Literature essays at 23/30 or better

**Status: NOT TESTED.** Nothing here has been run. This is the protocol for testing the goal that LearnThrive AI's GCSE English Literature essays reach at least
23/30 under independent AQA-style assessment. The model's own marks, and this repository's automated tests, are not evidence for that goal.

## Design

1. **Tasks.** At least 30 previously unseen AQA-style questions (Shakespeare, the modern text, the 19th-century novel), written or chosen by teachers who have not seen
   LearnThrive AI's output. Keep a held-out set that is never used to tune prompts or code. Include extract-based and whole-text questions, and "how far" questions
   that need development across the text.
2. **Generation.** For each task, generate the essay through the real application path (a real student request, the real model, research on), three times from a cold
   start. Record the build, the model, the settings, the search engines available, and the gate's report (first-draft problems, repairs, removed statements).
3. **Marking.** At least two qualified teachers or examiners mark each essay independently, blind to whether it is AI-written or which version produced it, using the
   AQA mark scheme for the task. Mix in human exemplar essays of known marks to calibrate. Resolve disagreements of more than 3 marks by a third marker.
4. **Accuracy audit (separate from marks).** For every essay, a checker lists each quotation (words, speaker, act and scene) and each factual claim about plot and
   character against the published text, and records errors. Report: quotation errors per essay, factual errors per essay, statements the gate removed.
5. **Metrics.** Median and mean agreed mark; share of essays at 23 or above; the lower bound of a 95% confidence interval for that share; inter-marker agreement;
   quotation and factual errors per essay; latency per essay.
6. **Pass criteria (proposed, for the owners to confirm).** At least 90% of essays at 23 or above with a lower confidence bound of at least 80%, and zero essays
   containing a quotation or event shown to be false.
7. **Reporting.** Publish the results as they are, including failures, with the marking scripts removed of any student data. Anything not measured stays NOT TESTED.
