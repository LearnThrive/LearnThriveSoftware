"""Kokoro 82M v1.0 speech output (kokoro-onnx, CPU by default).

The checkpoint and the voice embeddings come from the kokoro-onnx release (paths in `models/`, downloaded by docs/VOICE.md, never
committed). British English voices are what this app wants: `bf_emma` has the highest grade in the official voice list. The voice is
configuration (`VOICE_TTS_VOICE`), never hardcoded through the application.

`kokoro-onnx` runs on the CPU out of the box; `VOICE_TTS_DEVICE=cuda` asks ONNX Runtime for the CUDA provider and is only honest if
an accelerated `onnxruntime` (or `onnxruntime-gpu`) is installed, which the health output then reports - it never claims a GPU that
was not used.
"""
from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from . import audio
from .base import Synthesiser


class Kokoro82M(Synthesiser):
    engine = "kokoro"

    def __init__(self, models: Path, voice: str = "bf_emma", device: str = "cpu", speed: float = 1.0, log=print):
        self.models = Path(models)
        self.voice = voice
        self.device = device
        self.speed = float(speed)
        self._log = log
        self._kokoro = None

    def load(self) -> None:
        model = self.models / "kokoro-v1.0.onnx"
        voices = self.models / "voices-v1.0.bin"
        for path in (model, voices):
            if not path.is_file():
                raise FileNotFoundError(f"{path.name} is not in {self.models} (docs/VOICE.md has the two download steps)")
        if self.device == "cuda":
            os.environ.setdefault("ONNX_PROVIDER", "CUDAExecutionProvider")
        import kokoro_onnx

        self._kokoro = kokoro_onnx.Kokoro(str(model), str(voices))
        names = self._available_voices()
        if names:
            wanted = self.voice.lower()
            match = next((n for n in names if str(n).lower() == wanted), None)
            if match is None:
                british = sorted(str(n) for n in names if str(n).lower().startswith("b"))
                raise ValueError(f"Kokoro has no voice named {self.voice!r}; British English voices are {', '.join(british)}")
            self.voice = str(match)
        samples, rate = self._kokoro.create("Ready.", voice=self.voice, speed=self.speed, lang=self._lang())
        self.sample_rate = int(rate)
        del samples
        try:
            from importlib.metadata import version as package_version

            version = package_version("kokoro-onnx")
        except Exception:  # noqa: BLE001 - the version is a nicety
            version = "?"
        self.detail = f"kokoro-onnx {version}, {self.voice} on {self.device}"
        self.loaded = True

    def _available_voices(self) -> list:
        try:
            return list(self._kokoro.get_voices())
        except Exception:  # noqa: BLE001 - an older API without it is not a reason to refuse to speak
            return []

    def _lang(self) -> str:
        return "en-gb" if self.voice[:1].lower() == "b" else "en-us"

    def synthesise(self, text: str) -> bytes:
        samples, rate = self._kokoro.create(text, voice=self.voice, speed=self.speed, lang=self._lang())
        self.sample_rate = int(rate)
        return audio.wav_bytes(np.asarray(samples, dtype=np.float32), int(rate))
