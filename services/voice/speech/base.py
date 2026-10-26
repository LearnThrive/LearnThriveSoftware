"""What every speech engine provides, so the sidecar, the benchmark and the routes never learn which one is loaded.

A recogniser turns one utterance into words plus an honest account of what it knows: `confidence` is 0..1 when the engine can
measure it (`confidence_source` says how: "tokens" for a mean token posterior, "words" for per-word confidences), and **None** when
it cannot - occupied by "none", never by a fabricated 1.0. `no_speech` is the independent silence check (see audio.py).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Recognised:
    text: str
    confidence: float | None
    confidence_source: str  # "tokens" | "words" | "none"
    no_speech: float
    processing_ms: int


class Recogniser:
    """One utterance in, words out. `loaded` is the truth at the moment it is asked, not a hope."""

    engine = "?"
    device = "?"
    detail = ""
    loaded = False
    note: str | None = None  # set when a fallback engine took over, with the reason

    def transcribe(self, samples: np.ndarray) -> Recognised:
        raise NotImplementedError

    def health(self) -> dict:
        return {"engine": self.engine, "device": self.device, "loaded": self.loaded, "detail": self.detail}

    def stop(self) -> None:
        """Release anything long-lived: a child process, a model, a session."""


class Synthesiser:
    """One sentence or two in, a WAV out. Same honesty rules as above."""

    engine = "?"
    device = "?"
    voice = "?"
    sample_rate = 0
    detail = ""
    loaded = False
    note: str | None = None

    def synthesise(self, text: str) -> bytes:
        raise NotImplementedError

    def health(self) -> dict:
        return {"engine": self.engine, "device": self.device, "voice": self.voice, "sampleRate": self.sample_rate, "loaded": self.loaded, "detail": self.detail}

    def stop(self) -> None:
        """Release anything long-lived."""
