"""Unit tests for the sidecar's engine layer (stdlib unittest: `uv run python -m unittest discover -s tests`).

Nothing here loads a real model: the engine *selection*, the fallback, the transcript parsing and the HTTP shape are what a unit test
can pin. The real engines are exercised by docs/VOICE_BENCHMARK.md's benchmark and by the browser live check, which are separate
commands and say so in the docs.
"""
from __future__ import annotations

import io
import json
import sys
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from speech import audio, select  # noqa: E402
from speech.base import Recognised, Recogniser, Synthesiser  # noqa: E402
from speech.parakeet import ParakeetCtc, _confidence, _multipart, _tidy  # noqa: E402


_GUARDS: list[mock._patch] = []


def setUpModule():
    """A test that reaches a real engine fails here instead of spawning or loading one.

    The first version of this file had one selection test that forgot its fake: the real adapter started nemo-speech, left the child
    running and only then fell back to Whisper, which spent four minutes loading models inside the test runner. These guards make that
    mistake loud and instant.
    """
    for name in ("ParakeetCtc", "WhisperRecogniser"):
        guard = mock.patch.object(select, name, mock.Mock(side_effect=AssertionError(f"a test built the real {name}: fake it")))
        guard.start()
        _GUARDS.append(guard)


def tearDownModule():
    for guard in _GUARDS:
        guard.stop()


def tone(seconds: float = 1.0, rate: int = 16000, level: float = 0.3) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (level * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


class FakeParakeet(Recogniser):
    engine = "parakeet"
    device = "cuda:0"
    loaded = True
    detail = "fake"

    def start(self):
        self.loaded = True

    def transcribe(self, samples):  # noqa: ANN001
        return Recognised("fake", 0.9, "words", 0.0, 1)


class FakeWhisper(Recogniser):
    engine = "whisper"
    device = "cpu"
    loaded = False
    detail = "fake"

    def load(self):
        self.loaded = True

    def transcribe(self, samples):  # noqa: ANN001
        return Recognised("fake", 0.6, "tokens", 0.0, 1)


class FakeKokoro(Synthesiser):
    engine = "kokoro"
    voice = "bf_emma"
    device = "cpu"
    sample_rate = 24000
    loaded = False
    detail = "fake"

    def load(self):
        self.loaded = True

    def synthesise(self, text: str) -> bytes:
        return audio.wav_bytes(tone(0.1, 24000), 24000)


class FakePiper(Synthesiser):
    engine = "piper"
    voice = "en_GB-alba-medium"
    device = "cpu"
    sample_rate = 22050
    loaded = False
    detail = "fake"

    def load(self):
        self.loaded = True


class AudioTests(unittest.TestCase):
    def test_read_wav_accepts_what_the_browser_makes_and_refuses_the_rest(self):
        good = audio.wav_bytes(tone(), 16000)
        samples = audio.read_wav(good)
        self.assertEqual(samples.shape[0], 16000)
        self.assertAlmostEqual(float(np.max(np.abs(samples))), 0.3, places=2)

        def make(rate: int = 16000, channels: int = 1, seconds: float = 0.2) -> bytes:
            out = io.BytesIO()
            with wave.open(out, "wb") as w:
                w.setnchannels(channels)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(b"\x00\x00" * int(rate * seconds) * channels)
            return out.getvalue()

        for wrong in (make(rate=48000), make(channels=2), make(seconds=61)):
            with self.assertRaises(ValueError):
                audio.read_wav(wrong)

    def test_silence_probability_is_one_for_quiet_and_zero_for_sound(self):
        self.assertEqual(audio.silence_probability(np.zeros(16000, dtype=np.float32)), 1.0)
        self.assertEqual(audio.silence_probability(np.full(16000, 0.005, dtype=np.float32)), 1.0)
        self.assertEqual(audio.silence_probability(tone(1.0)), 0.0)

    def test_wav_bytes_round_trips_and_clips(self):
        clipped = audio.wav_bytes(np.array([2.0, -2.0], dtype=np.float32), 16000)
        view = memoryview(clipped)
        self.assertEqual(int.from_bytes(view[44:46], "little", signed=True), 32767)
        self.assertEqual(int.from_bytes(view[46:48], "little", signed=True), -32767)


class TranscriptTests(unittest.TestCase):
    def test_confidence_comes_from_the_runtime_then_the_words_then_nowhere(self):
        self.assertEqual(_confidence({"confidence": 0.98, "words": [{"confidence": 0.1}]}), (0.98, "tokens"))
        self.assertEqual(_confidence({"words": [{"confidence": 0.9}, {"confidence": 0.7}]}), (0.8, "words"))
        self.assertEqual(_confidence({}), (None, "none"))
        self.assertEqual(_confidence({"confidence": 7}), (None, "none"), "a number out of range is not a confidence")

    def test_tidy_capitalises_only_the_first_letter(self):
        self.assertEqual(_tidy("  what   is x cubed "), "What is x cubed")
        self.assertEqual(_tidy(""), "")
        self.assertEqual(_tidy("3 x plus 4"), "3 x plus 4")

    def test_multipart_body_carries_the_wav_and_the_fields(self):
        body, content_type = _multipart({"response_format": "verbose_json"}, b"RIFFdata")
        self.assertIn("multipart/form-data; boundary=", content_type)
        self.assertIn(b'name="file"; filename="voice.wav"', body)
        self.assertIn(b"audio/wav", body)
        self.assertIn(b"RIFFdata", body)
        self.assertIn(b"verbose_json", body)


class FakeRuntimeHandler(BaseHTTPRequestHandler):
    """A stand-in for `nemo-speech serve`: the endpoints the adapter uses, with a scripted answer."""

    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/ready":
            self._json(200, {"ready": True, "device": "Fake CUDA 0"})
        elif self.path == "/version":
            self._json(200, {"version": "9.9.9-test"})
        elif self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if self.path != "/v1/audio/transcriptions" or b"voice.wav" not in body:
            return self._json(400, {"error": {"message": "no file"}})
        if self.server.silent:  # a recogniser answering silence with silence is fine (the warm-up call)
            return self._json(200, {"text": "", "words": []})
        self._json(200, {"text": "what is x cubed", "words": [{"word": "what", "confidence": 0.99}, {"word": "is", "confidence": 0.8}, {"word": "x", "confidence": 0.9}, {"word": "cubed", "confidence": 0.95}]})

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ParakeetAdapterTests(unittest.TestCase):
    """The whole HTTP path, against a stand-in server: spawn nothing, but speak the real protocol."""

    @classmethod
    def setUpClass(cls):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeRuntimeHandler)
        server.silent = True
        cls.server = server
        cls.port = server.server_address[1]
        cls.thread = threading.Thread(target=server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def client(self) -> ParakeetCtc:
        engine = ParakeetCtc(model=Path("parakeet-ctc-1.1b.q8_0.gguf"), url=f"http://127.0.0.1:{self.port}", log=lambda _m: None)
        engine.start()
        return engine

    def test_start_reports_the_runtime_and_transcribe_reads_the_words(self):
        engine = self.client()
        self.assertTrue(engine.loaded)
        self.assertEqual(engine.device, "Fake CUDA 0", "the device is whatever the runtime reported, not what was asked")
        self.assertIn("9.9.9-test", engine.detail)

        self.server.silent = False
        result = engine.transcribe(tone(1.0))
        self.assertEqual(result.text, "What is x cubed")
        self.assertEqual(result.confidence_source, "words")
        self.assertAlmostEqual(result.confidence, 0.91, places=2)
        self.assertEqual(result.no_speech, 0.0)
        self.assertGreaterEqual(result.processing_ms, 0)

    def test_silence_gets_no_words_and_says_so(self):
        engine = self.client()  # the warm-up call is silent, then this one
        result = engine.transcribe(np.zeros(16000, dtype=np.float32))
        self.assertEqual(result.text, "")
        self.assertEqual(result.no_speech, 1.0)

    def test_health_asks_the_runtime(self):
        engine = self.client()
        self.assertTrue(engine.health()["loaded"])

    def test_a_runtime_that_is_not_there_fails_with_a_reason(self):
        engine = ParakeetCtc(model=Path("m.gguf"), url="http://127.0.0.1:9", log=lambda _m: None, ready_timeout=2)
        with self.assertRaises(RuntimeError) as caught:
            engine.start()
        self.assertIn("not ready", str(caught.exception))


class SelectionTests(unittest.TestCase):
    """Which engine is built, and that a fallback is recorded rather than hidden."""

    def env(self, **over):
        base = {"VOICE_STT_ENGINE": "parakeet", "VOICE_TTS_ENGINE": "kokoro", "VOICE_FALLBACK_ENABLED": "true"}
        base.update(over)
        return base

    def test_the_defaults_are_parakeet_and_kokoro_when_they_load(self):
        with mock.patch.object(select, "ParakeetCtc", lambda **kw: FakeParakeet()), mock.patch.object(select, "Kokoro82M", lambda *a, **kw: FakeKokoro()):
            service = select.build_speech(self.env(), log=lambda _m: None)
        self.assertEqual(service.stt.engine, "parakeet")
        self.assertEqual(service.tts.engine, "kokoro")
        self.assertNotIn("fallback", service.health()["stt"])

    def test_a_parakeet_that_cannot_start_falls_back_to_whisper_and_says_why(self):
        def broken(**kwargs):
            raise RuntimeError("no runtime found")

        with mock.patch.object(select, "ParakeetCtc", broken), mock.patch.object(select, "WhisperRecogniser", lambda **kw: FakeWhisper()), mock.patch.object(select, "Kokoro82M", lambda *a, **kw: FakeKokoro()):
            service = select.build_speech(self.env(), log=lambda _m: None)
        health = service.health()
        self.assertEqual(health["stt"]["engine"], "whisper")
        self.assertEqual(health["stt"]["fallback"], {"from": "parakeet", "reason": "parakeet unavailable: no runtime found"})
        self.assertIn("fallback", service.summary())

    def test_with_the_fallback_switched_off_a_broken_engine_is_a_hard_failure(self):
        with mock.patch.object(select, "ParakeetCtc", mock.Mock(side_effect=RuntimeError("no runtime found"))), mock.patch.object(select, "Kokoro82M", lambda *a, **kw: FakeKokoro()):
            with self.assertRaises(RuntimeError):
                select.build_speech(self.env(VOICE_FALLBACK_ENABLED="false"), log=lambda _m: None)

    def test_a_broken_kokoro_falls_back_to_piper(self):
        def broken(*args, **kwargs):
            raise FileNotFoundError("kokoro-v1.0.onnx is not in models (docs/VOICE.md)")

        with mock.patch.object(select, "ParakeetCtc", lambda **kw: FakeParakeet()), mock.patch.object(select, "Kokoro82M", broken), mock.patch.object(select, "PiperSynthesiser", lambda *a, **kw: FakePiper()):
            service = select.build_speech(self.env(), log=lambda _m: None)
        health = service.health()
        self.assertEqual(health["tts"]["engine"], "piper")
        self.assertIn("kokoro unavailable", health["tts"]["fallback"]["reason"])

    def test_an_unknown_engine_is_refused_rather_than_guessed(self):
        # Both names are validated before anything is built: the guards in setUpModule make sure a typo in either one never
        # reaches an engine (a bad VOICE_TTS_ENGINE used to spawn the runtime and load Whisper first).
        with self.assertRaises(ValueError):
            select.build_speech(self.env(VOICE_STT_ENGINE="carrier-pigeon"), log=lambda _m: None)
        with self.assertRaises(ValueError):
            select.build_speech(self.env(VOICE_TTS_ENGINE="carrier-pigeon"), log=lambda _m: None)

    def test_whisper_can_be_chosen_explicitly_for_rollback(self):
        with mock.patch.object(select, "WhisperRecogniser", lambda **kw: FakeWhisper()):
            service = select.build_speech(self.env(VOICE_STT_ENGINE="whisper"), log=lambda _m: None)
        self.assertEqual(service.stt.engine, "whisper")

    def test_the_model_is_found_by_name_or_path(self):
        self.assertIsNone(select.parakeet_model_path("no-such-model"))
        default = select.parakeet_model_path(None)
        self.assertTrue(default is None or default.name == "parakeet-ctc-1.1b.q8_0.gguf")


if __name__ == "__main__":
    unittest.main()
