"""Which engines this sidecar runs, decided from the environment, with an honest fallback.

| variable | default | meaning |
| --- | --- | --- |
| `VOICE_STT_ENGINE` | `parakeet` | `parakeet` (NVIDIA NeMo-Speech.cpp) or `whisper` (faster-whisper, the pre-migration engine) |
| `VOICE_STT_MODEL` | `parakeet-ctc-1.1b.q8_0.gguf` | a GGUF path or name in `models/` for parakeet; a Whisper model name for whisper |
| `VOICE_STT_DEVICE` | `auto` | `auto` tries the GPU then the CPU for parakeet; for whisper it is the old behaviour (cuda, else cpu) |
| `VOICE_STT_COMPUTE` | engine default | whisper only: `float16` on the GPU, `int8` on the CPU |
| `VOICE_PARAKEET_URL` | none | an already-running `nemo-speech serve` (the Docker sidecar uses one on the host); when set, nothing is spawned |
| `VOICE_PARAKEET_HOME` | `vendor/nemo-speech*` | the extracted runtime directory, if it is somewhere else |
| `VOICE_PARAKEET_PORT` | `8791` | the port a spawned runtime listens on (loopback only) |
| `VOICE_TTS_ENGINE` | `kokoro` | `kokoro` (82M, British English) or `piper` (the pre-migration engine) |
| `VOICE_TTS_VOICE` | `bf_emma` | a Kokoro voice, or a Piper voice when the engine is piper |
| `VOICE_TTS_DEVICE` | `cpu` | kokoro: `cpu` or `cuda` (cuda needs an accelerated onnxruntime) |
| `VOICE_FALLBACK_ENABLED` | `true` | when the preferred engine cannot start, use the old one **and say so** in `/health` |

The fallback is never silent: the engine that actually answered is what `/health` reports, and a `fallback` field names what was
tried and why it failed. Nothing here ever claims a GPU it did not use: for Parakeet the device comes from the runtime's own
`/ready` answer.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from .base import Recogniser, Synthesiser
from .kokoro import Kokoro82M
from .legacy import PiperSynthesiser, WhisperRecogniser
from .parakeet import ParakeetCtc

HERE = Path(__file__).resolve().parent.parent  # services/voice
MODELS = HERE / "models"
VENDOR = HERE / "vendor"

# Words a maths and science tutor hears; a hint to a recogniser that takes one, not a vocabulary limit.
VOCAB = "Maths and science homework: x squared, quadratic, denominator, numerator, coefficient, factorise, hypotenuse, photosynthesis, mitochondria, equation."
PARAKEET_MODEL = "parakeet-ctc-1.1b.q8_0.gguf"
PARAKEET_PORT = 8791


def _truthy(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() not in ("0", "false", "off", "no")


def parakeet_model_path(value: str | None) -> Path | None:
    """The GGUF, as an explicit path, a name in `models/`, or a bare model stem."""
    candidates: list[Path] = []
    if value:
        candidates += [Path(value), MODELS / value, MODELS / f"{value}.gguf", MODELS / f"{value}.q8_0.gguf"]
    else:
        candidates += [MODELS / PARAKEET_MODEL]
    return next((c for c in candidates if c.is_file()), None)


def runtime_candidates() -> list[Path]:
    """Every `nemo-speech` executable under `vendor/`, best first (a CUDA build before Vulkan before CPU)."""
    explicit = os.environ.get("VOICE_PARAKEET_HOME", "").strip()
    if explicit:
        home = Path(explicit)
        for candidate in (home / "bin" / "nemo-speech.exe", home / "nemo-speech.exe", home / "bin" / "nemo-speech"):
            if candidate.is_file():
                return [candidate]
        return []
    if not VENDOR.is_dir():
        return []
    found = [p for p in VENDOR.glob("**/bin/nemo-speech*") if p.is_file() and p.suffix.lower() in ("", ".exe")]

    def rank(path: Path) -> int:
        text = str(path).lower()
        return 3 if "cuda" in text else 2 if "vulkan" in text else 1

    return sorted(found, key=rank, reverse=True)


def _parakeet(env: dict, log) -> Recogniser:
    device = (env.get("VOICE_STT_DEVICE") or "auto").strip().lower()
    if device not in ("auto", "cpu", "cuda"):
        raise ValueError(f"VOICE_STT_DEVICE must be auto, cpu or cuda, not {device!r}")
    url = (env.get("VOICE_PARAKEET_URL") or "").strip() or None
    attempts = ["cuda:0", "cpu"] if device == "auto" else [f"{device}:0" if device == "cuda" else "cpu"]
    if url:
        # Somebody else runs the runtime (the Docker sidecar uses the host's): its device is whatever it chose.
        engine = ParakeetCtc(model=parakeet_model_path(env.get("VOICE_STT_MODEL")) or MODELS / PARAKEET_MODEL, url=url, log=log)
        engine.start()
        return engine
    model = parakeet_model_path(env.get("VOICE_STT_MODEL"))
    if model is None:
        raise RuntimeError(f"no Parakeet model found ({PARAKEET_MODEL} in {MODELS}; VOICE_STT_MODEL may name it)")
    runtimes = runtime_candidates()
    if not runtimes:
        raise RuntimeError("no NeMo-Speech.cpp runtime under services/voice/vendor (docs/VOICE.md has the verified download)")
    port = int(env.get("VOICE_PARAKEET_PORT") or PARAKEET_PORT)
    problems: list[str] = []
    for device_flag in attempts:
        for executable in runtimes:
            engine = ParakeetCtc(model=model, executable=executable, device=device_flag, port=port, log=log)
            try:
                engine.start()
                return engine
            except Exception as error:  # noqa: BLE001 - the next attempt (another device, another build) is the point
                problems.append(f"{executable.parent.parent.name}/{device_flag}: {str(error).splitlines()[0][:200]}")
                engine.stop()
    raise RuntimeError("; ".join(problems))


def engine_names(env: dict) -> tuple[str, str]:
    """Both engine names, validated before anything expensive is constructed.

    A typo in either name must fail at startup, not half-way: building the recogniser first and only then rejecting a bad
    `VOICE_TTS_ENGINE` used to spawn a runtime and load models for a configuration that was never going to run.
    """
    stt = (env.get("VOICE_STT_ENGINE") or "parakeet").strip().lower()
    tts = (env.get("VOICE_TTS_ENGINE") or "kokoro").strip().lower()
    if stt not in ("parakeet", "whisper"):
        raise ValueError(f"VOICE_STT_ENGINE must be parakeet or whisper, not {stt!r}")
    if tts not in ("kokoro", "piper"):
        raise ValueError(f"VOICE_TTS_ENGINE must be kokoro or piper, not {tts!r}")
    return stt, tts


def _build_recogniser(env: dict, preferred: str, fallback_enabled: bool, log) -> Recogniser:
    if preferred == "whisper":
        whisper = WhisperRecogniser(model=(env.get("VOICE_STT_MODEL") or "").strip(), device=(env.get("VOICE_STT_DEVICE") or "auto").strip().lower(), compute=(env.get("VOICE_STT_COMPUTE") or "").strip(), vocab=VOCAB, log=log)
        whisper.load()
        return whisper
    try:
        return _parakeet(env, log)
    except Exception as error:  # noqa: BLE001
        if not fallback_enabled:
            raise
        reason = str(error).splitlines()[0][:300] or type(error).__name__
        log(f"  parakeet is not usable ({reason}); falling back to faster-whisper for this run")
        whisper = WhisperRecogniser(model="", device="auto", compute="", vocab=VOCAB, log=log)
        whisper.load()
        whisper.note = f"parakeet unavailable: {reason}"
        return whisper


def _build_synthesiser(env: dict, preferred: str, fallback_enabled: bool, log) -> Synthesiser:
    voice = (env.get("VOICE_TTS_VOICE") or "").strip()
    if preferred == "piper":
        piper = PiperSynthesiser(MODELS, voice or "en_GB-alba-medium", log=log)
        piper.load()
        return piper
    device = (env.get("VOICE_TTS_DEVICE") or "cpu").strip().lower()
    try:
        kokoro = Kokoro82M(MODELS, voice or "bf_emma", device=device, log=log)
        kokoro.load()
        return kokoro
    except Exception as error:  # noqa: BLE001
        if not fallback_enabled:
            raise
        reason = str(error).splitlines()[0][:300] or type(error).__name__
        log(f"  kokoro is not usable ({reason}); falling back to Piper for this run")
        piper_voice = voice if (MODELS / f"{voice}.onnx").is_file() else "en_GB-alba-medium"
        piper = PiperSynthesiser(MODELS, piper_voice, log=log)
        piper.load()
        piper.note = f"kokoro unavailable: {reason}"
        return piper


@dataclass
class SpeechService:
    """What the HTTP shell talks to: the two engines and one counters dictionary."""

    stt: Recogniser
    tts: Synthesiser
    counters: dict = field(default_factory=lambda: {"stt": 0, "tts": 0, "errors": 0})

    def health(self) -> dict:
        stt = self.stt.health()
        tts = self.tts.health()
        if self.stt.note:
            stt["fallback"] = {"from": "parakeet", "reason": self.stt.note}
        if self.tts.note:
            tts["fallback"] = {"from": "kokoro", "reason": self.tts.note}
        return {"ok": True, "stt": stt, "tts": tts, "counters": self.counters}

    def summary(self) -> str:
        stt, tts = self.stt, self.tts
        line = f"stt {stt.engine} {getattr(stt, 'model', '?')} on {stt.device}, tts {tts.engine} {tts.voice} on {tts.device}"
        if self.stt.note:
            line += f" [fallback: {self.stt.note}]"
        if self.tts.note:
            line += f" [fallback: {self.tts.note}]"
        return line

    def stop(self) -> None:
        self.stt.stop()
        self.tts.stop()


def build_speech(env: dict | None = None, log=print) -> SpeechService:
    env = dict(os.environ if env is None else env)
    stt_engine, tts_engine = engine_names(env)  # both names first: a typo must not half-start a sidecar
    fallback_enabled = _truthy(env.get("VOICE_FALLBACK_ENABLED"), True)
    return SpeechService(stt=_build_recogniser(env, stt_engine, fallback_enabled, log), tts=_build_synthesiser(env, tts_engine, fallback_enabled, log))
