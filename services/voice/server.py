"""Local speech sidecar for Study Buddy voice mode (plan19 section 5.4). DEVELOPMENT SERVICE: one process on one machine.

    POST /stt   body: a 16 kHz mono 16-bit WAV (at most 60 s, 4 MB)   ->  {"text", "audioMs", "processingMs"}
    POST /tts   body: {"text": "..."}  (one sentence or two)          ->  audio/wav
    GET  /health                                                     ->  what is loaded

The browser never talks to this: the Next route `/api/assistant/voice/*` does, after the same sign-in, access and rate checks as the chat,
so the Content Security Policy is unchanged. Audio and text are processed in memory and never written to disk or logged (only counters).
Start it with `npm run voice:dev` from apps/web, or `uv run python server.py` here.
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8765"))
# "auto" (the default): small.en on the GPU if CUDA works here (measured: 1.8% word error, ~120 ms a clip, ~0.6 GB of VRAM), otherwise base.en on the
# CPU (4.6% word error, ~550 ms a clip). docs/VOICE_BENCHMARK.md has the numbers. Any of the three can be set explicitly.
STT_DEVICE = os.environ.get("VOICE_STT_DEVICE", "auto")
STT_MODEL = os.environ.get("VOICE_STT_MODEL", "")
STT_COMPUTE = os.environ.get("VOICE_STT_COMPUTE", "")
TTS_VOICE = os.environ.get("VOICE_TTS_VOICE", "en_GB-alba-medium")
TOKEN = os.environ.get("VOICE_TOKEN", "")
MAX_BODY = 4 * 1024 * 1024
MAX_AUDIO_SECONDS = 60
MAX_TTS_CHARS = 600
# Words a maths and science tutor hears; a hint to the recogniser, not a vocabulary limit.
VOCAB_PROMPT = "Maths and science homework: x squared, quadratic, denominator, numerator, coefficient, factorise, hypotenuse, photosynthesis, mitochondria, equation."

_stt = None
_tts = None
_tts_rate = 22050
_lock = threading.Lock()
counters = {"stt": 0, "tts": 0, "errors": 0}


def add_cuda_dll_dirs() -> None:
    """On Windows the CUDA runtime libraries installed with `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` are not on the search path."""
    base = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    for sub in ("cublas", "cudnn", "cuda_nvrtc"):
        folder = base / sub / "bin"
        if folder.is_dir():
            os.add_dll_directory(str(folder))
            os.environ["PATH"] = str(folder) + os.pathsep + os.environ.get("PATH", "")


def load_stt():
    global _stt, STT_MODEL, STT_DEVICE, STT_COMPUTE
    from faster_whisper import WhisperModel

    def attempt(model: str, device: str, compute: str):
        if device == "cuda":
            add_cuda_dll_dirs()
        loaded = WhisperModel(model, device=device, compute_type=compute)
        loaded.transcribe(np.zeros(16000, dtype=np.float32), language="en")  # a missing CUDA library shows up here, not on the first real request
        return loaded

    if STT_DEVICE == "auto":
        try:
            _stt = attempt(STT_MODEL or "small.en", "cuda", STT_COMPUTE or "float16")
            STT_DEVICE, STT_MODEL, STT_COMPUTE = "cuda", STT_MODEL or "small.en", STT_COMPUTE or "float16"
            return
        except Exception:  # noqa: BLE001 - no GPU, or its libraries are not installed: the CPU does it
            STT_DEVICE = "cpu"
    STT_MODEL = STT_MODEL or "base.en"
    STT_COMPUTE = STT_COMPUTE or ("float16" if STT_DEVICE == "cuda" else "int8")
    _stt = attempt(STT_MODEL, STT_DEVICE, STT_COMPUTE)


def load_tts():
    global _tts, _tts_rate
    from piper import PiperVoice

    model = HERE / "models" / f"{TTS_VOICE}.onnx"
    _tts = PiperVoice.load(str(model))
    _tts_rate = _tts.config.sample_rate


def read_wav(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
            raise ValueError("expected 16 kHz mono 16-bit WAV")
        if w.getnframes() > 16000 * MAX_AUDIO_SECONDS:
            raise ValueError("audio too long")
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(samples: np.ndarray) -> tuple[str, int, float, float]:
    """The words, the time taken, a confidence (0 to 1: the average token probability) and the chance there was no speech at all."""
    started = time.perf_counter()
    with _lock:
        segments, _info = _stt.transcribe(samples, language="en", beam_size=1, vad_filter=True, initial_prompt=VOCAB_PROMPT, condition_on_previous_text=False)
        segments = list(segments)
    text = " ".join(s.text.strip() for s in segments).strip()
    confidence = float(np.exp(np.mean([s.avg_logprob for s in segments]))) if segments else 0.0
    no_speech = float(max((s.no_speech_prob for s in segments), default=1.0))
    return text, int((time.perf_counter() - started) * 1000), round(confidence, 3), round(no_speech, 3)


def synthesise(text: str) -> bytes:
    out = io.BytesIO()
    with _lock:
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(_tts_rate)
            for chunk in _tts.synthesize(text):
                w.writeframes(chunk.audio_int16_bytes)
    return out.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "learnthrive-voice"

    def log_message(self, *_args):  # never log paths with content; there is none, but stay quiet
        pass

    def _send(self, status: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload).encode())

    def _authorised(self) -> bool:
        return not TOKEN or self.headers.get("x-voice-token") == TOKEN

    def _body(self) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    def do_GET(self):
        if self.path != "/health":
            return self._json(404, {"error": "not_found"})
        self._json(200, {"ok": True, "stt": {"model": STT_MODEL, "device": STT_DEVICE, "compute": STT_COMPUTE, "loaded": _stt is not None}, "tts": {"voice": TTS_VOICE, "sampleRate": _tts_rate, "loaded": _tts is not None}, "counters": counters})

    def do_POST(self):
        if not self._authorised():
            return self._json(401, {"error": "unauthorised"})
        body = self._body()
        if body is None:
            return self._json(413, {"error": "bad_size"})
        try:
            if self.path == "/stt":
                samples = read_wav(body)
                text, ms, confidence, no_speech = transcribe(samples)
                counters["stt"] += 1
                return self._json(200, {"text": text, "audioMs": int(len(samples) / 16), "processingMs": ms, "confidence": confidence, "noSpeech": no_speech})
            if self.path == "/tts":
                text = str(json.loads(body).get("text", "")).strip()[:MAX_TTS_CHARS]
                if not text:
                    return self._json(400, {"error": "empty"})
                started = time.perf_counter()
                wav = synthesise(text)
                counters["tts"] += 1
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(wav)))
                self.send_header("X-Processing-Ms", str(int((time.perf_counter() - started) * 1000)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(wav)
                return
            return self._json(404, {"error": "not_found"})
        except (ValueError, wave.Error, json.JSONDecodeError):
            counters["errors"] += 1
            return self._json(400, {"error": "bad_request"})
        except Exception:  # noqa: BLE001 - never echo the audio or the text back in an error
            counters["errors"] += 1
            return self._json(500, {"error": "failed"})


def main() -> None:
    started = time.perf_counter()
    load_stt()
    load_tts()
    # Warm both once so the first real request is not the slow one.
    transcribe(np.zeros(16000, dtype=np.float32))
    synthesise("Ready.")
    print(f"voice sidecar ready on http://{HOST}:{PORT} (stt {STT_MODEL}/{STT_DEVICE}/{STT_COMPUTE}, tts {TTS_VOICE}) in {time.perf_counter() - started:.1f}s", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
