"""Local speech sidecar for LearnThrive AI voice mode (plan19 section 5.4). DEVELOPMENT SERVICE: one process on one machine.

    POST /stt   body: a 16 kHz mono 16-bit WAV (at most 60 s, 4 MB)   ->  {"text", "audioMs", "processingMs", "confidence",
                                                                            "confidenceSource", "noSpeech", "engine"}
    POST /tts   body: {"text": "..."}  (one sentence or two)          ->  audio/wav
    GET  /health                                                     ->  what is loaded, and any fallback that took over

The engines are pluggable (speech/select.py): Parakeet CTC 1.1B through NVIDIA's NeMo-Speech.cpp is the default recogniser (started
as a child process that keeps the model loaded, or reached at VOICE_PARAKEET_URL when the sidecar runs in Docker), and Kokoro 82M is
the default voice. faster-whisper and Piper remain as the documented rollback and as the fallback, and whenever a fallback is in use
/health says so instead of pretending.

The browser never talks to this: the Next route `/api/assistant/voice/*` does, after the same sign-in, access and rate checks as the
chat, so the Content Security Policy is unchanged. Audio and text are processed in memory and never written to disk or logged (only
counters). Everything binds to loopback; the NeMo-Speech runtime is asked to as well.
Start it with `npm run voice:dev` from apps/web, or `uv run python server.py` here.
"""
from __future__ import annotations

import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from speech import audio
from speech.select import build_speech

HOST = os.environ.get("VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VOICE_PORT", "8765"))
TOKEN = os.environ.get("VOICE_TOKEN", "")
MAX_BODY = 4 * 1024 * 1024
MAX_TTS_CHARS = 600

service = None
_lock = threading.Lock()


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
        self._json(200, service.health())

    def do_POST(self):
        if not self._authorised():
            return self._json(401, {"error": "unauthorised"})
        body = self._body()
        if body is None:
            return self._json(413, {"error": "bad_size"})
        try:
            if self.path == "/stt":
                samples = audio.read_wav(body)
                with _lock:
                    result = service.stt.transcribe(samples)
                service.counters["stt"] += 1
                return self._json(
                    200,
                    {
                        "text": result.text,
                        "audioMs": int(len(samples) / 16),
                        "processingMs": result.processing_ms,
                        "confidence": result.confidence,
                        "confidenceSource": result.confidence_source,
                        "noSpeech": result.no_speech,
                        "engine": service.stt.engine,
                    },
                )
            if self.path == "/tts":
                text = str(json.loads(body).get("text", "")).strip()[:MAX_TTS_CHARS]
                if not text:
                    return self._json(400, {"error": "empty"})
                started = time.perf_counter()
                with _lock:
                    wav = service.tts.synthesise(text)
                service.counters["tts"] += 1
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
            service.counters["errors"] += 1
            return self._json(400, {"error": "bad_request"})
        except Exception:  # noqa: BLE001 - never echo the audio or the text back in an error
            service.counters["errors"] += 1
            return self._json(500, {"error": "failed"})


def main() -> None:
    global service
    started = time.perf_counter()
    service = build_speech(log=print)
    # Warm both once so the first real question is not the slow one.
    with _lock:
        service.stt.transcribe(np.zeros(16000, dtype=np.float32))
        service.tts.synthesise("Ready.")
    print(f"voice sidecar ready on http://{HOST}:{PORT} ({service.summary()}) in {time.perf_counter() - started:.1f}s", flush=True)
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()


if __name__ == "__main__":
    main()
