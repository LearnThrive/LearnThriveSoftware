"""Parakeet CTC 1.1B through NVIDIA's own runtime, NeMo-Speech.cpp (0.2.0, Windows x86_64 release archive, SHA-256 checked).

The runtime is one child process (`nemo-speech serve`) that keeps the model loaded for the life of the sidecar; each utterance is one
HTTP POST to its OpenAI-compatible `/v1/audio/transcriptions` on loopback, `response_format=verbose_json` because that is what
carries the per-word confidences. Started here by default; when `VOICE_PARAKEET_URL` is set (the sidecar runs in Docker and the
runtime on the host, which must be so on Windows where the binary is native), the address is used instead and nothing is spawned.

Two deliberate omissions, both so the health surface never lies:

- **No word boosting.** `speech_contexts`/`prompt` boosting is documented to work only with flashlight CTC decoding (or cache-aware
  RNNT) and to be ignored by greedy CTC without a language model. Sending it would look like vocabulary help and do nothing.
- **No punctuation restoration.** Parakeet CTC emits lower case without punctuation. Guessing question marks and commas could change
  what a maths question looks like, so the words are kept exactly as recognised and only the first letter is capitalised.
  (NVIDIA's PnC BERT is the documented upgrade; it needs another checkpoint downloaded and converted, and is noted in the
  migration report as deliberately not taken.)

The runtime exposes per-word confidences and a mean token posterior; either is real evidence, so one of them is reported. Nothing
about the audio or the words is ever written to a log by this module.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import numpy as np

from . import audio
from .base import Recognised, Recogniser

READY_TIMEOUT_S = 240.0
REQUEST_TIMEOUT_S = 60.0
POLL_S = 0.25


class ParakeetCtc(Recogniser):
    engine = "parakeet"

    def __init__(
        self,
        *,
        model: Path,
        executable: Path | None = None,
        url: str | None = None,
        host: str = "127.0.0.1",
        port: int = 8791,
        device: str = "auto",
        api_key: str | None = None,
        log=print,
        log_path: Path | None = None,
        ready_timeout: float = READY_TIMEOUT_S,
    ):
        self.model = Path(model)
        self._exe = Path(executable) if executable else None
        self._url = (url or f"http://{host}:{port}").rstrip("/")
        self._own = url is None
        self._host, self._port = host, port
        self._device = device
        self._api_key = api_key or os.environ.get("VOICE_PARAKEET_API_KEY") or None
        self._log = log
        self._log_path = log_path
        self._ready_timeout = ready_timeout
        self._child: subprocess.Popen | None = None
        self._log_file = None
        self._version = ""
        self.warm_ms: int | None = None
        self.device = "?"  # what the runtime itself reports, never what was merely asked for

    # ---- lifecycle -----------------------------------------------------------------------------------------------------------

    def start(self) -> None:
        """Spawn the runtime (or use the address given), wait until it is ready, and prove the whole path once on silence."""
        if self._own:
            if self._exe is None or not self._exe.is_file():
                raise RuntimeError("no nemo-speech executable to run (services/voice/vendor, or VOICE_PARAKEET_HOME)")
            self._spawn()
        self._await_ready(self._ready_timeout)
        started = time.perf_counter()
        # One silent clip through the whole path: the model, the HTTP route and the parser, before any student's question is the
        # first thing they go through. The answer says nothing and is neither kept nor logged.
        self._request(audio.wav_bytes(np.zeros(audio.SAMPLE_RATE, dtype=np.float32), audio.SAMPLE_RATE), timeout=REQUEST_TIMEOUT_S)
        self.warm_ms = int((time.perf_counter() - started) * 1000)
        self.loaded = True
        where = f"at {self._url}" if not self._own else f"as a child process on {self._host}:{self._port}"
        self.detail = f"nemo-speech {self._version or '?'} ({self.device}), model {self.model.name}, {where}"

    def _spawn(self) -> None:
        env = dict(os.environ)
        env["PATH"] = str(self._exe.parent) + os.pathsep + env.get("PATH", "")
        from .legacy import add_cuda_dll_dirs  # the CUDA libraries the pip wheels provide, if the runtime needs them

        add_cuda_dll_dirs(env)
        args = [str(self._exe), "serve", "--asr-model", str(self.model), "--host", self._host, "--port", str(self._port), "--no-ui", "--json", "--device", self._device]
        if self._api_key:
            args += ["--api-key", self._api_key]
        log_path = self._log_path or (self.model.parent.parent / "vendor" / "parakeet.log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        self._log_file = open(log_path, "a", encoding="utf-8", errors="replace")
        self._log_file.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} serving {self.model.name} on {self._host}:{self._port} (--device {self._device})\n")
        self._log_file.flush()
        self._child = subprocess.Popen(
            args,
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
            cwd=str(self._exe.parent),
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self._log(f"  parakeet: started nemo-speech (pid {self._child.pid}, device {self._device or 'auto'})")

    def _tail(self, lines: int = 6) -> str:
        try:
            text = (self._log_path or (self.model.parent.parent / "vendor" / "parakeet.log")).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return " | ".join(text.strip().splitlines()[-lines:])[:600]

    def _await_ready(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self._child is not None and self._child.poll() is not None:
                raise RuntimeError(f"nemo-speech exited with {self._child.returncode}: {self._tail()}")
            try:
                with urllib.request.urlopen(f"{self._url}/ready", timeout=3) as response:
                    payload = json.load(response)
                if isinstance(payload, dict):
                    device = payload.get("device")
                    if isinstance(device, str) and device.strip():
                        self.device = device.strip()
                self._version = self._get_text("/version")
                return
            except urllib.error.HTTPError as error:
                if error.code < 500:  # answering but not ready (503) is normal while the model loads
                    pass
            except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
                pass
            time.sleep(POLL_S)
        if self._child is not None:
            self.stop()
        raise RuntimeError(f"nemo-speech was not ready within {int(timeout)} s: {self._tail()}")

    def stop(self) -> None:
        child, self._child = self._child, None
        self.loaded = False
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
        if self._log_file is not None:
            try:
                self._log_file.close()
            except OSError:
                pass
            self._log_file = None

    # ---- work ----------------------------------------------------------------------------------------------------------------

    def transcribe(self, samples: np.ndarray) -> Recognised:
        started = time.perf_counter()
        payload = self._request(audio.wav_bytes(samples, audio.SAMPLE_RATE), timeout=REQUEST_TIMEOUT_S)
        took = int((time.perf_counter() - started) * 1000)
        text = _tidy(str(payload.get("text", "")))
        confidence, source = _confidence(payload)
        no_speech = 1.0 if (not text or audio.silence_probability(samples) >= 1.0) else 0.0
        return Recognised(text=text, confidence=confidence, confidence_source=source, no_speech=no_speech, processing_ms=took)

    def _request(self, wav: bytes, timeout: float) -> dict:
        body, content_type = _multipart(
            {"response_format": "verbose_json", "language": "en", "automatic_punctuation": "true"},
            wav,
        )
        headers = {"Content-Type": content_type, "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = urllib.request.Request(f"{self._url}/v1/audio/transcriptions", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"nemo-speech answered {error.code}") from error
        except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"nemo-speech is not answering: {type(error).__name__}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("nemo-speech sent something that is not a transcript")
        return payload

    def _get_text(self, path: str) -> str:
        """`/version` answers JSON (`{"version":"0.2.0"}`); anything unparseable is just its text."""
        try:
            with urllib.request.urlopen(f"{self._url}{path}", timeout=3) as response:
                text = str(response.read(200).decode("utf-8", errors="replace")).strip()
            try:
                payload = json.loads(text)
                if isinstance(payload, dict) and isinstance(payload.get("version"), str):
                    return payload["version"]
            except json.JSONDecodeError:
                pass
            return text
        except Exception:  # noqa: BLE001 - the version is a nicety; never fail startup over it
            return ""

    def health(self) -> dict:
        """The runtime is asked, not assumed: a request that fails means not loaded, whatever was true at startup."""
        ready = False
        try:
            with urllib.request.urlopen(f"{self._url}/ready", timeout=3) as response:
                ready = response.status == 200
        except Exception:  # noqa: BLE001
            ready = False
        self.loaded = ready
        return {"engine": self.engine, "device": self.device, "loaded": ready, "detail": self.detail, "model": self.model.name, "warmMs": self.warm_ms}


def _confidence(payload: dict) -> tuple[float | None, str]:
    """The runtime's own number when it gives one, else the mean of its per-word confidences, else None. Never a made-up value."""
    top = payload.get("confidence")
    if isinstance(top, (int, float)) and 0.0 <= float(top) <= 1.0:
        return round(float(top), 3), "tokens"
    words = payload.get("words")
    scores = [float(w["confidence"]) for w in words if isinstance(w, dict) and isinstance(w.get("confidence"), (int, float))] if isinstance(words, list) else []
    if scores:
        return round(sum(scores) / len(scores), 3), "words"
    return None, "none"


def _tidy(text: str) -> str:
    """Whitespace collapsed, the first letter capitalised, nothing else touched: no punctuation is invented."""
    t = " ".join(text.split())
    if t and t[0].isalpha() and t[0].islower():
        t = t[0].upper() + t[1:]
    return t


def _multipart(fields: dict[str, str], wav: bytes, filename: str = "voice.wav") -> tuple[bytes, str]:
    boundary = "----learnthrive" + uuid.uuid4().hex
    out = bytearray()
    for name, value in fields.items():
        out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode()
    out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: audio/wav\r\n\r\n".encode()
    out += wav
    out += f"\r\n--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"
