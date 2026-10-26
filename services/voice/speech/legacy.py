"""The engines the migration replaced, kept working for rollback: faster-whisper for recognition, Piper for speech output.

These are the exact engines and the exact behaviour of the sidecar before Parakeet + Kokoro, moved here unchanged so
`VOICE_STT_ENGINE=whisper` / `VOICE_TTS_ENGINE=piper` restores the old pipeline (and so the fallback has something real to fall
back to). They stay until the new engines have been stable in daily use; see docs/VOICE_PARAKEET_KOKORO_MIGRATION.md.
"""
from __future__ import annotations

import io
import os
import sys
import wave
from pathlib import Path

import numpy as np

from . import audio
from .base import Recognised, Recogniser, Synthesiser


def add_cuda_dll_dirs(env: dict | None = None) -> None:
    """On Windows the CUDA runtime libraries installed with `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` are not on the
    search path. Adds them to the process (for in-process engines) and to `env` when one is given (for a child process)."""
    base = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    target = env if env is not None else os.environ
    for sub in ("cublas", "cudnn", "cuda_nvrtc"):
        folder = base / sub / "bin"
        if folder.is_dir():
            try:
                os.add_dll_directory(str(folder))
            except (AttributeError, OSError):
                pass
            target["PATH"] = str(folder) + os.pathsep + target.get("PATH", "")


class WhisperRecogniser(Recogniser):
    engine = "whisper"

    def __init__(self, *, model: str = "", device: str = "auto", compute: str = "", vocab: str = "", log=print):
        self.requested_model = model
        self.device = "?"
        self.compute = compute
        self.model = ""
        self._vocab = vocab
        self._log = log
        self._whisper = None

    def load(self) -> None:
        from faster_whisper import WhisperModel

        def attempt(model: str, device: str, compute: str):
            if device == "cuda":
                add_cuda_dll_dirs()
            loaded = WhisperModel(model, device=device, compute_type=compute)
            loaded.transcribe(np.zeros(16000, dtype=np.float32), language="en")  # a missing CUDA library shows up here, not on the first real request
            return loaded

        device, model, compute = self.device, self.requested_model, self.compute
        if device == "auto":
            try:
                self._whisper = attempt(model or "small.en", "cuda", compute or "float16")
                device, model, compute = "cuda", model or "small.en", compute or "float16"
            except Exception:  # noqa: BLE001 - no GPU, or its libraries are not installed: the CPU does it
                device = "cpu"
        if self._whisper is None:
            device = device if device in ("cpu", "cuda") else "cpu"
            model = model or "base.en"
            compute = compute or ("float16" if device == "cuda" else "int8")
            self._whisper = attempt(model, device, compute)
        self.device, self.model, self.compute = device, model, compute
        self.detail = f"faster-whisper {model} on {device} ({compute})"
        self.loaded = True

    def transcribe(self, samples: np.ndarray) -> Recognised:
        import time

        started = time.perf_counter()
        segments, _info = self._whisper.transcribe(samples, language="en", beam_size=1, vad_filter=True, initial_prompt=self._vocab, condition_on_previous_text=False)
        segments = list(segments)
        text = " ".join(s.text.strip() for s in segments).strip()
        confidence = float(np.exp(np.mean([s.avg_logprob for s in segments]))) if segments else 0.0
        no_speech = float(max((s.no_speech_prob for s in segments), default=1.0))
        return Recognised(
            text=text,
            confidence=round(confidence, 3),
            confidence_source="tokens",
            no_speech=round(no_speech, 3),
            processing_ms=int((time.perf_counter() - started) * 1000),
        )

    def health(self) -> dict:
        payload = super().health()
        payload["model"] = self.model
        payload["compute"] = self.compute
        return payload


class PiperSynthesiser(Synthesiser):
    engine = "piper"

    def __init__(self, models: Path, voice: str = "en_GB-alba-medium", log=print):
        self.models = Path(models)
        self.voice = voice.removesuffix(".onnx")
        self.device = "cpu"
        self._log = log
        self._piper = None

    def load(self) -> None:
        from piper import PiperVoice

        model = self.models / f"{self.voice}.onnx"
        if not model.is_file():
            raise FileNotFoundError(f"{model.name} is not in {self.models} (docs/VOICE.md has the download step)")
        self._piper = PiperVoice.load(str(model))
        self.sample_rate = int(self._piper.config.sample_rate)
        self.detail = f"piper {self.voice} on cpu (GPL-3.0-or-later: development only)"
        self.loaded = True

    def synthesise(self, text: str) -> bytes:
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sample_rate)
            for chunk in self._piper.synthesize(text):
                w.writeframes(chunk.audio_int16_bytes)
        return out.getvalue()


__all__ = ["WhisperRecogniser", "PiperSynthesiser", "add_cuda_dll_dirs"]
