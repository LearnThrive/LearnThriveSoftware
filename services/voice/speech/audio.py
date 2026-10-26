"""Audio the sidecar shares between engines. Everything is in memory: a 16 kHz mono 16-bit WAV in, a 16 kHz mono 16-bit WAV out.

The browser makes exactly this shape (`apps/web/src/lib/assistant/audio.ts`, `encodeWav16k`), so anything else is a bad request, not
something to guess at. Nothing here writes a file, and nothing here logs.

The speech/silence check exists because Parakeet CTC provides no no-speech probability (NVIDIA's model card documents none, and the
runtime's `verbose_json` returns words and confidences, not a silence score). Whisper's own score is used when there is one; when
there is not, this is the independent check the brief asked for instead of a fabricated number.
"""
from __future__ import annotations

import io
import wave

import numpy as np

SAMPLE_RATE = 16000
MAX_AUDIO_SECONDS = 60


def read_wav(data: bytes) -> np.ndarray:
    """A 16 kHz mono 16-bit WAV as float32 in -1..1; anything else is a ValueError (the route turns it into a 400)."""
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != SAMPLE_RATE:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        if w.getnframes() > SAMPLE_RATE * MAX_AUDIO_SECONDS:
            raise ValueError("audio too long")
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    """A mono 16-bit WAV of `samples` (floats in -1..1), built in memory."""
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767.0).astype("<i2")
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return out.getvalue()


def silence_probability(samples: np.ndarray) -> float:
    """1.0 when the clip looks like it held no speech at all, else 0.0.

    Very quiet (peak under -36 dBFS, below anything the browser's own 0.01 gate would send), or almost none of the 20 ms frames
    carry sound above the floor of the clip: silence. Deliberately coarse - it is a guard against hallucinated words on silence, not
    a voice-activity detector.
    """
    if samples.size == 0:
        return 1.0
    peak = float(np.max(np.abs(samples)))
    if peak < 0.015:
        return 1.0
    frame = 320  # 20 ms at 16 kHz
    usable = samples[: (samples.size // frame) * frame]
    if usable.size == 0:
        return 0.0 if peak >= 0.05 else 1.0
    rms = np.sqrt(np.mean(usable.reshape(-1, frame) ** 2, axis=1))
    active = float(np.mean(rms > max(0.008, 0.05 * peak)))
    return 0.0 if active >= 0.02 else 1.0
