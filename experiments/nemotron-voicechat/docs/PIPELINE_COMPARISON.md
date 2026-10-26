# LearnThrive AI's voice pipeline compared with Nemotron VoiceChat

Two different architectures, and the comparison only means something if the boundaries are kept straight.

## The three things being compared

||1. LearnThrive AI (built, running)|2. Nemotron VoiceChat, hosted|3. NemotronLabs 11B, local|
| --- | --- | --- | --- |
| Shape | **Cascaded**: silence detector → faster-whisper → local LLM → Piper, one utterance at a time | **Full duplex**: continuous audio in, audio out as it is generated | Same model family, NVIDIA's local runtime |
| Where it runs | This laptop: recogniser and model on one 8 GB GPU | NVIDIA's hardware | Would need ≥16 GB GPU memory |
| Status | Working, development only | **Not reachable** — no documented endpoint | **Not feasible on this hardware** |
| Evidence | Measured, in `docs/VOICE.md` and `docs/VOICE_BENCHMARK.md` | Model-card figures only | Not run |

## The numbers, each labelled with what it actually measures

| Figure | Value | What it is, exactly | Comparable with what? |
| --- | --- | --- | --- |
| LearnThrive AI, pipeline-internal | **908 ms** median (p95 1191 ms) | End of speech → first synthesised clip. Excludes the browser hop and the deliberate 0.9 s silence wait | Nothing from NVIDIA — see below |
| LearnThrive AI, as a student experiences it | **2.55 s** median (5 questions, standalone) / 2.6–3.0 s through Docker | Last word → first audio in the ear. Includes the 0.9 s silence detector ("sure the student has finished") | The only honest basis for "how it feels" |
| Recogniser alone | 1.8% word error, 119 ms median, ~0.6 GB VRAM (`small.en`/cuda) | faster-whisper on one 2–6 s clip | — |
| Voice output | 72–98 ms to the first chunk | Piper, local | — |
| NVIDIA Nemotron VoiceChat 11B | **~450 ms** turn-taking; 448 ms smooth-turn-taking; 480 ms user-interruption | **Model-card benchmark on an H100**, published by NVIDIA. Not measured here, not on this hardware | Not comparable with either row above |
| This experiment's harness | 1018 ms median last packet → first audio; 317 ms from `speech_stopped` | **Inside the synthetic stand-in**, whose own configured delays are 700 + 60 + 120 + 120 ms. It validates the harness (the numbers reconcile to ~18 ms of overhead) and says nothing about any model | Nothing |

**Why the 450 ms and the 2.55 s cannot be subtracted from each other.** NVIDIA's figure is one model's turn-taking
latency — the delay between the user finishing and generated speech starting — measured on an H100, with no cascaded
recogniser, no separate language model, no browser capture and no network in the path. LearnThrive's 2.55 s is a
five-stage cascade on a laptop: 0.9 s of deliberate silence detection, ~0.4 s of recognition, a local 9B model producing
a full first sentence, ~0.1 s of synthesis, plus the HTTP hop. They are measurements of different things at different
boundaries on incomparable hardware. The useful statement is narrower: **a full-duplex model removes the cascade and the
deliberate silence wait, and NVIDIA's own figures suggest a turn boundary several times faster than this laptop's.**

## Which is more like a conversation, which hears maths better, which suits tutoring

**More like a conversation:** Nemotron, by architecture, not by measurement. LearnThrive AI is turn-based by design:
speak, stop, wait, listen. Interrupting is a *press* (or "Stop speaking"), and `docs/VOICE.md` lists full duplex and
voice-only barge-in as explicitly not built. Nemotron's model card claims barge-in and continuous audio. I could not test
that claim, and although this experiment's page did fire its own voice-driven interruption path nine times under a live
microphone (RESULTS.md §1.4), that was this client's detector on room noise — not a model yielding to a student.

**Hears maths better:** **unknown, and not knowable from what I measured.** LearnThrive AI has a number for this:
1.8% clean word error on synthetic speech, with a maths vocabulary prompt, and `docs/VOICE_BENCHMARK.md` carries the
honest warning that synthetic audio is optimistic. There is no equivalent measurement for Nemotron, and the phrases that
matter (`two x`, `x squared`, `three x cubed`) were never sent to it.

**Suits tutoring:** different strengths, and the answer is not "one wins".

- LearnThrive AI's cascade is **auditable and controllable**: the transcript is text before anything is generated, so a
  confidence check ("Did I hear that right?") sits between the student's voice and the model; the recogniser's vocabulary
  prompt is tuned to school maths; the model's system prompt is the project's own safeguarding prompt; the audio never
  leaves the machine; and voice mode is **closed in production** (`voiceClosed()` returns `production`) until a hosted
  speech processor is chosen. For a product used by children, that control is worth more than a few hundred milliseconds.
- A full-duplex model is **faster and more natural**, and would remove the recogniser, the Pipper voice and the cascade
  latency — but it also puts a **black box between the student and the answer**. Speech goes in, speech comes out; there
  may be a transcript event, but the safety gate can no longer inspect the question as text before it is answered, and
  there is no "did I hear that right?" step to insert. On a trial endpoint that may record inputs, that is a serious
  question for a service used by minors.

## If it were to be pursued: the architecture this experiment suggests

The prompt asked for an assessment, not an integration. On the evidence available:

**Plausible:** Nemotron (or a comparable full-duplex model) as the **voice layer only** — the thing that hears the student
and speaks — with the **reasoning left to a separate model** (LearnThrive AI's existing local model, or a hosted
specialist) behind it, and the project's own gates around the call. This is worth *investigating*, not building yet,
because it needs two things this experiment could not obtain: a documented endpoint, and a measured answer to whether
the voice model's own answers are good enough to expose to a student at all.

**Not plausible:** replacing the current pipeline now. It works, its numbers are measured and documented, and its
weaknesses (the 0.9 s silence wait, turn-based barge-in) are known and cheap to tune — `endSilenceMs` is one constant.

**The two questions to settle first**, in order:

1. Does an ordinary NVIDIA key (or an approval) actually unlock a VoiceChat endpoint, with a documented protocol?
   Today: **no** — 85 model ids reachable, none of them VoiceChat.
2. Does the model answer GCSE and A-level maths correctly, judged by a teacher, and does it hear the maths phrases
   correctly, judged on real recordings? A voice model being fluent is not evidence for either.

Until both are answered, this is an evaluation that stays an experiment.

## Licence note carried forward from the existing pipeline

Not part of the comparison, but relevant to any decision: the current cascade depends on **Piper, which is
GPL-3.0-or-later** (`docs/VOICE.md`), whereas the NeMo-Speech.cpp runtime is Apache-2.0 and the 11B weights are under
OpenMDW-1.1 — whose commercial terms were not verified here. Licence review is a separate task from latency, and it was
not done for this experiment.
