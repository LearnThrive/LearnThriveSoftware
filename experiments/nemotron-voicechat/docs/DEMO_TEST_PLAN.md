# Testing the official demonstration (route B) — script and recording template

Route B is the only route reachable today. It is **manual**: a person speaks into NVIDIA's own demo. Do not report it as
an integration, and do not report its timings as measurements — you cannot time inside someone else's web page.

## Before you start

1. Read ACCESS_RESEARCH.md section 2. The Build page says *"Apply for Early Access"*; a demo may be open without it.
2. Open <https://build.nvidia.com/nvidia/nemotron-voicechat>. If it asks for an account or approval, that is the gate —
   note exactly what it says, because that wording is the evidence.
3. **Consent:** NVIDIA's public trial may record inputs and outputs. Speak the phrases yourself, as an adult. Never a
   child's voice, never a real student's record, never anything confidential.
4. Have the phrase list from `testcases/conversations.json` open, in order.

## What to do, and what to write down

Work through groups A → E in order. For each case, one line in the table below. Nothing else.

| Case | Said (exactly) | Was the transcript shown and was it right? | Answer correct? (yes/no/partly) | Did it wait through a pause? | Did talking over it stop it? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | | | | n/a | n/a | |
| A2 | | | | n/a | n/a | |
| A3 | | | | n/a | n/a | |
| A4 | | | | n/a | n/a | |
| B1 | | | | n/a | n/a | |
| B2 | | | | n/a | n/a | |
| B3 | | | | n/a | n/a | |
| B4 | | | | n/a | n/a | |
| C1 | | | | n/a | n/a | |
| C2 | | | | n/a | n/a | |
| C3 | | | | n/a | n/a | |
| C4 | | | | n/a | n/a | |
| D1 | | | | yes/no | n/a | two turns: does the second depend on the first? |
| D2 | | | | yes/no | n/a | pause four seconds mid-sentence |
| D3 | | | | yes/no | n/a | correct yourself mid-sentence |
| D4 | | | | yes/no | n/a | |
| E1 | | | | n/a | yes/no | interrupt mid-answer |
| E2 | | | | n/a | yes/no | |
| E3 | | | | n/a | yes/no | |
| E4 | | | | n/a | yes/no | did it restart the answer? |

Then answer these, honestly and briefly:

- **Voice quality, by ear:** how natural did it sound, compared with Piper `en_GB-alba-medium` (which you can hear
  through the existing sidecar)? Which would a tired 15-year-old rather be taught by?
- **Latency, by feel only:** did the turn-taking feel like a conversation, or like a walkie-talkie? Write "felt
  immediate", "noticeable gap", or similar. Do **not** write a millisecond figure you did not measure.
- **Maths:** did it hear `x squared` correctly? Did it say the right answer to B1 and C1 specifically? A voice model
  being smooth is not evidence that it can do A-level algebra.
- **Full duplex:** when you spoke over it, did it stop promptly? Did it carry on as if nothing had happened, or did it
  get confused? This is the headline claim, so be specific.
- **What blocked you:** the exact wording on any gate you hit, and whether it was an account, an approval or a payment.

## What this route cannot tell you

- Any latency number. The demo page owns the timers; you cannot see inside it. Write **Not measured**.
- Resource usage: CPU, RAM and VRAM are on NVIDIA's hardware, not yours. Write **Not measured**.
- Whether a hosted API can be called at all. A working demo is not an API.
- Anything about running it locally, on this laptop, at any speed.

If the demo cannot be reached at all, write that down with the exact page text. A blocked route with quoted evidence is
a better result than an invented one.
