"""Engine benchmark for LearnThrive AI voice mode (plan19 section 5.4). Run through `npm run voice:bench` (apps/web), which also measures the
whole pipeline and writes docs/VOICE_BENCHMARK.md; this file compares the speech engines on their own and writes JSON.

Speech recognition: faster-whisper configurations over a labelled SYNTHETIC set (the phrases in apps/web/tests/fixtures/assistant/voice-phrases.json
spoken by text-to-speech voices, clean and with noise added). Word error rate, the maths and science terms found, real-time factor, memory.
Speech output: Piper and Kokoro voices, time to first audio for a first chunk and for a longer one.

Synthetic speech is cleaner than a child's, so recognition scores are OPTIMISTIC; nothing here hears a real person. Nothing is stored except numbers.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import wave
import zlib
from pathlib import Path

import numpy as np
import psutil

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
PROC = psutil.Process()

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def number_words(n: int) -> str:
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        rest = n % 100
        return ONES[n // 100] + " hundred" + ("" if rest == 0 else " and " + number_words(rest))
    return str(n)


def normalise(text: str) -> list[str]:
    """Lower case, digits to words, spelling variants folded, punctuation gone: so '5x' and 'five x' are the same, and so are 'x2' and 'x squared' (no)."""
    t = text.lower().replace("-", " ").replace("’", "'")
    t = re.sub(r"(\d)([a-z])", r"\1 \2", t)
    t = re.sub(r"([a-z])(\d)", r"\1 \2", t)
    t = re.sub(r"(\d+)\.(\d+)", lambda m: number_words(int(m.group(1))) + " point " + " ".join(number_words(int(d)) for d in m.group(2)), t)
    t = re.sub(r"\d+", lambda m: number_words(int(m.group(0))), t)
    t = t.replace("factorize", "factorise").replace("centimeters", "centimetres").replace("’", "'")
    t = re.sub(r"[^a-z' ]", " ", t)
    words = [w for w in t.split() if w]
    return ["and" if w == "&" else w for w in words]


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    """Word errors and reference length (edit distance over words)."""
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1], len(ref)


def rss_mb() -> float:
    return PROC.memory_info().rss / 2**20


def vram_mb() -> float | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10).stdout.strip()
        return float(out.splitlines()[0])
    except Exception:
        return None


def read_pcm(path: Path) -> np.ndarray:
    """A mono 16-bit WAV as 16 kHz float32 (windowed-sinc low-pass, then linear interpolation, when the file is at another rate)."""
    with wave.open(str(path), "rb") as w:
        rate, channels = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        x = x.reshape(-1, channels).mean(axis=1)
    if rate == 16000:
        return x
    if rate > 16000:
        cutoff = 0.45 * 16000 / rate
        n = np.arange(-32, 33)
        kernel = np.sinc(2 * cutoff * n) * np.hamming(65)
        x = np.convolve(x, kernel / kernel.sum(), mode="same")
    positions = np.arange(0, len(x) - 1, rate / 16000)
    return np.interp(positions, np.arange(len(x)), x).astype(np.float32)


def add_noise(samples: np.ndarray, snr_db: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    signal = float(np.sqrt(np.mean(samples**2))) or 1e-6
    noise = rng.normal(0, 1, samples.shape).astype(np.float32)
    noise *= signal / (10 ** (snr_db / 20)) / (float(np.sqrt(np.mean(noise**2))) or 1)
    return np.clip(samples + noise, -1, 1)


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())


# ---- the synthetic set ----------------------------------------------------------------------------------------------------


def synth_piper(voice: str, phrases, out: Path):
    from piper import PiperVoice

    v = PiperVoice.load(str(MODELS / f"{voice}.onnx"))
    rate = v.config.sample_rate
    for p in phrases:
        chunks = [c.audio_int16_array for c in v.synthesize(p["text"] + ".")]
        write_wav(out / f"piper-{voice}__{p['id']}.wav", np.concatenate(chunks).astype(np.float32) / 32768, rate)


def synth_kokoro(voice: str, phrases, out: Path):
    from kokoro_onnx import Kokoro

    k = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    for p in phrases:
        samples, rate = k.create(p["text"] + ".", voice=voice, speed=1.0, lang="en-gb")
        write_wav(out / f"kokoro-{voice}__{p['id']}.wav", samples, rate)


def synth_sapi(voice: str, phrases, out: Path) -> bool:
    script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('%s'); " % voice
    for p in phrases:
        script += "$s.SetOutputToWaveFile('%s'); $s.Speak('%s'); $s.SetOutputToNull(); " % ((out / f"sapi-{voice.split()[1].lower()}__{p['id']}.wav").as_posix().replace("/", "\\"), p["text"].replace("'", "''"))
    try:
        return subprocess.run(["powershell", "-NoProfile", "-Command", script], capture_output=True, timeout=300).returncode == 0
    except Exception:
        return False


def build_set(phrases, work: Path, log):
    """Returns {voice: {phrase_id: 16 kHz float32}} for every synthetic voice that could be made."""
    engines = [
        ("piper-en_GB-alba-medium", lambda: synth_piper("en_GB-alba-medium", phrases, work)),
        ("piper-en_GB-jenny_dioco-medium", lambda: synth_piper("en_GB-jenny_dioco-medium", phrases, work)),
        ("piper-en_GB-northern_english_male-medium", lambda: synth_piper("en_GB-northern_english_male-medium", phrases, work)),
        ("kokoro-bf_emma", lambda: synth_kokoro("bf_emma", phrases, work)),
        ("kokoro-bm_george", lambda: synth_kokoro("bm_george", phrases, work)),
        ("sapi-hazel", lambda: synth_sapi("Microsoft Hazel Desktop", phrases, work)),
        ("sapi-zira", lambda: synth_sapi("Microsoft Zira Desktop", phrases, work)),
    ]
    made = {}
    for name, run in engines:
        try:
            run()
        except Exception as error:  # noqa: BLE001
            log(f"  could not make {name}: {type(error).__name__}")
            continue
        files = {p["id"]: work / f"{name}__{p['id']}.wav" for p in phrases}
        if all(f.exists() for f in files.values()):
            made[name] = {pid: read_pcm(f) for pid, f in files.items()}
            log(f"  made {name}")
    return made


# ---- recognition ----------------------------------------------------------------------------------------------------------

STT_CONFIGS = [
    {"engine": "whisper", "model": "base.en", "device": "cpu", "compute": "int8", "voices": "all"},
    {"engine": "whisper", "model": "small.en", "device": "cpu", "compute": "int8", "voices": "all"},
    {"engine": "whisper", "model": "small", "device": "cpu", "compute": "int8", "voices": "all"},
    {"engine": "whisper", "model": "medium.en", "device": "cpu", "compute": "int8", "voices": "one"},
    {"engine": "whisper", "model": "base.en", "device": "cuda", "compute": "float16", "voices": "all"},
    {"engine": "whisper", "model": "small.en", "device": "cuda", "compute": "float16", "voices": "all"},
    # The migration's target: the shipped Parakeet adapter (services/voice/speech/parakeet.py) against a real NeMo-Speech.cpp
    # runtime, so these numbers are the code path the sidecar uses, not a separate script.
    {"engine": "parakeet", "model": "parakeet-ctc-1.1b.q8_0.gguf", "device": "cuda", "compute": "q8_0", "voices": "all"},
    {"engine": "parakeet", "model": "parakeet-ctc-1.1b.q8_0.gguf", "device": "cpu", "compute": "q8_0", "voices": "one"},
]


def run_stt(cfg, clips, phrases, terms, log):
    if cfg.get("engine") == "parakeet":
        return run_stt_parakeet(cfg, clips, phrases, terms, log)
    from faster_whisper import WhisperModel

    if cfg["device"] == "cuda":
        from server import add_cuda_dll_dirs

        add_cuda_dll_dirs()
    refs = {p["id"]: normalise(p["text"]) for p in phrases}
    result = {**cfg}
    before_rss, before_vram = rss_mb(), vram_mb()
    t = time.perf_counter()
    try:
        model = WhisperModel(cfg["model"], device=cfg["device"], compute_type=cfg["compute"])
        model.transcribe(np.zeros(16000, dtype=np.float32), language="en")  # warm
    except Exception as error:  # noqa: BLE001
        result["error"] = f"{type(error).__name__}: {str(error)[:160]}"
        log(f"  {cfg['model']} {cfg['device']}: not run ({result['error']})")
        return result
    result["loadSeconds"] = round(time.perf_counter() - t, 2)
    result["rssMb"] = round(rss_mb() - before_rss)
    after_vram = vram_mb()
    result["vramMb"] = round(after_vram - before_vram) if after_vram is not None and before_vram is not None else None
    stats = {"clean": [0, 0], "noisy": [0, 0]}
    per_voice: dict[str, list[int]] = {}
    term_hits = [0, 0]
    rtfs, times, samples_out = [], [], []
    for voice, by_phrase in clips.items():
        for pid, audio in by_phrase.items():
            for cond in ("clean", "noisy"):
                x = audio if cond == "clean" else add_noise(audio, 15, zlib.crc32(f"{voice}{pid}".encode()))
                started = time.perf_counter()
                segments, _ = model.transcribe(x, language="en", beam_size=1, vad_filter=True, initial_prompt="Maths and science homework: x squared, quadratic, denominator, numerator, coefficient, factorise, hypotenuse, photosynthesis, mitochondria, equation.", condition_on_previous_text=False)
                text = " ".join(s.text.strip() for s in segments)
                took = time.perf_counter() - started
                errors, total = wer(refs[pid], normalise(text))
                stats[cond][0] += errors
                stats[cond][1] += total
                pv = per_voice.setdefault(voice, [0, 0])
                pv[0] += errors
                pv[1] += total
                hyp = set(normalise(text))
                for term in terms:
                    if term in refs[pid]:
                        term_hits[1] += 1
                        term_hits[0] += term in hyp
                rtfs.append(took / (len(audio) / 16000))
                times.append(took * 1000)
                if len(samples_out) < 3 and cond == "clean" and errors:
                    samples_out.append({"voice": voice, "said": " ".join(refs[pid]), "heard": " ".join(normalise(text))})
    result["wer"] = {c: round(100 * e / max(1, n), 1) for c, (e, n) in stats.items()}
    result["werByVoice"] = {v: round(100 * e / max(1, n), 1) for v, (e, n) in per_voice.items()}
    result["termsFoundPercent"] = round(100 * term_hits[0] / max(1, term_hits[1]), 1)
    result["rtfMedian"] = round(statistics.median(rtfs), 3)
    result["msMedian"] = round(statistics.median(times))
    result["msP95"] = round(float(np.percentile(times, 95)))
    result["clips"] = len(times)
    result["errorExamples"] = samples_out
    log(f"  {cfg['model']} {cfg['device']} {cfg['compute']}: WER clean {result['wer']['clean']}% noisy {result['wer']['noisy']}%, median {result['msMedian']} ms, RTF {result['rtfMedian']}")
    del model
    return result


def run_stt_parakeet(cfg, clips, phrases, terms, log):
    """Parakeet CTC 1.1B through the sidecar's own adapter task: it spawns the runtime, keeps it loaded and reports its device."""
    from speech import select as speech_select

    refs = {p["id"]: normalise(p["text"]) for p in phrases}
    result = {**cfg}
    before_rss, before_vram = rss_mb(), vram_mb()
    t = time.perf_counter()
    try:
        engine = speech_select._parakeet({"VOICE_STT_DEVICE": cfg["device"], "VOICE_STT_MODEL": cfg["model"]}, log)
    except Exception as error:  # noqa: BLE001
        result["error"] = f"{type(error).__name__}: {str(error)[:160]}"
        log(f"  parakeet {cfg['device']}: not run ({result['error']})")
        return result
    result["loadSeconds"] = round(time.perf_counter() - t, 2)
    result["deviceReported"] = engine.device  # what the runtime said, never what was asked for
    result["detail"] = engine.detail
    result["rssMb"] = round(rss_mb() - before_rss)
    after_vram = vram_mb()
    result["vramMb"] = round(after_vram - before_vram) if after_vram is not None and before_vram is not None else None
    stats = {"clean": [0, 0], "noisy": [0, 0]}
    per_voice: dict[str, list[int]] = {}
    term_hits = [0, 0]
    rtfs, times, confidences = [], [], []
    samples_out = []
    seen_source = "none"
    for voice, by_phrase in clips.items():
        for pid, audio in by_phrase.items():
            for cond in ("clean", "noisy"):
                x = audio if cond == "clean" else add_noise(audio, 15, zlib.crc32(f"{voice}{pid}".encode()))
                started = time.perf_counter()
                heard = engine.transcribe(x)
                took = time.perf_counter() - started
                errors, total = wer(refs[pid], normalise(heard.text))
                stats[cond][0] += errors
                stats[cond][1] += total
                pv = per_voice.setdefault(voice, [0, 0])
                pv[0] += errors
                pv[1] += total
                hyp = set(normalise(heard.text))
                for term in terms:
                    if term in refs[pid]:
                        term_hits[1] += 1
                        term_hits[0] += term in hyp
                rtfs.append(took / (len(audio) / 16000))
                times.append(took * 1000)
                seen_source = heard.confidence_source
                if heard.confidence is not None:
                    confidences.append(heard.confidence)
                if len(samples_out) < 3 and cond == "clean" and errors:
                    samples_out.append({"voice": voice, "said": " ".join(refs[pid]), "heard": " ".join(normalise(heard.text))})
    result["wer"] = {c: round(100 * e / max(1, n), 1) for c, (e, n) in stats.items()}
    result["werByVoice"] = {v: round(100 * e / max(1, n), 1) for v, (e, n) in per_voice.items()}
    result["termsFoundPercent"] = round(100 * term_hits[0] / max(1, term_hits[1]), 1)
    result["rtfMedian"] = round(statistics.median(rtfs), 3)
    result["msMedian"] = round(statistics.median(times))
    result["msP95"] = round(float(np.percentile(times, 95)))
    result["clips"] = len(times)
    # Whether the runtime handed over confidence scores at all: the frontend's confirmation rule must not invent them.
    result["confidenceSource"] = seen_source
    result["confidenceMedian"] = round(statistics.median(confidences), 3) if confidences else None
    result["errorExamples"] = samples_out
    log(f"  parakeet {cfg['device']} ({result['deviceReported']}): WER clean {result['wer']['clean']}% noisy {result['wer']['noisy']}%, median {result['msMedian']} ms, RTF {result['rtfMedian']}, confidence {seen_source}")
    engine.stop()
    return result


# ---- speech output ---------------------------------------------------------------------------------------------------------

FIRST = "Good question. Let us look at it."
LONGER = "To factorise that, we need two numbers that multiply to give six and add to give five."


def run_tts(log):
    out = []
    from piper import PiperVoice

    for voice in ("en_GB-alba-medium", "en_GB-jenny_dioco-medium", "en_GB-northern_english_male-medium"):
        row = {"engine": "piper", "voice": voice}
        try:
            before = rss_mb()
            t = time.perf_counter()
            v = PiperVoice.load(str(MODELS / f"{voice}.onnx"))
            row["loadSeconds"] = round(time.perf_counter() - t, 2)
            list(v.synthesize("Warm up."))
            row["rssMb"] = round(rss_mb() - before)
            for key, text in (("first", FIRST), ("longer", LONGER)):
                times, rtfs = [], []
                for _ in range(5):
                    t = time.perf_counter()
                    n = sum(len(c.audio_int16_array) for c in v.synthesize(text))
                    took = time.perf_counter() - t
                    times.append(took * 1000)
                    rtfs.append(took / (n / v.config.sample_rate))
                row[key] = {"msMedian": round(statistics.median(times)), "rtf": round(statistics.median(rtfs), 3)}
            row["sampleRate"] = v.config.sample_rate
        except Exception as error:  # noqa: BLE001
            row["error"] = f"{type(error).__name__}"
        out.append(row)
        log(f"  piper {voice}: first chunk {row.get('first', {}).get('msMedian')} ms")
    try:
        from kokoro_onnx import Kokoro

        before = rss_mb()
        t = time.perf_counter()
        k = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
        load = round(time.perf_counter() - t, 2)
        k.create("Warm up.", voice="bf_emma", lang="en-gb")
        for voice in ("bf_emma", "bm_george"):
            row = {"engine": "kokoro", "voice": voice, "loadSeconds": load, "rssMb": round(rss_mb() - before)}
            for key, text in (("first", FIRST), ("longer", LONGER)):
                times, rtfs = [], []
                for _ in range(5):
                    t = time.perf_counter()
                    s, rate = k.create(text, voice=voice, lang="en-gb")
                    took = time.perf_counter() - t
                    times.append(took * 1000)
                    rtfs.append(took / (len(s) / rate))
                row[key] = {"msMedian": round(statistics.median(times)), "rtf": round(statistics.median(rtfs), 3)}
            row["sampleRate"] = 24000
            out.append(row)
            log(f"  kokoro {voice}: first chunk {row['first']['msMedian']} ms")
    except Exception as error:  # noqa: BLE001
        out.append({"engine": "kokoro", "error": f"{type(error).__name__}: {str(error)[:120]}"})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phrases", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only", default="", help="comma list of 'model/device' to run, e.g. base.en/cpu")
    ap.add_argument("--merge", action="store_true", help="keep the other entries already in --out and replace only the ones run now (and skip speech output)")
    args = ap.parse_args()
    log = lambda m: print(m, flush=True)  # noqa: E731
    data = json.loads(Path(args.phrases).read_text(encoding="utf-8"))
    phrases = data["phrases"][: 4 if args.quick else None]
    terms = data["terms"]
    result = {"note": "SYNTHETIC speech from text-to-speech voices: cleaner than a child's voice, so recognition scores are optimistic.", "phrases": len(phrases)}
    with tempfile.TemporaryDirectory() as tmp:
        log("making the synthetic set")
        clips = build_set(phrases, Path(tmp), log)
        result["voices"] = sorted(clips)
        configs = [c for c in STT_CONFIGS if not args.only or f"{c['model']}/{c['device']}" in args.only.split(",")]
        stt = []
        for cfg in configs:
            use = clips if cfg["voices"] == "all" else {k: v for k, v in list(clips.items())[:1]}
            if args.quick:
                use = {k: v for k, v in list(use.items())[:2]}
            log(f"recognition: {cfg['model']} {cfg['device']} {cfg['compute']}")
            stt.append(run_stt(cfg, use, phrases, terms, log))
        result["stt"] = stt
    out_path = Path(args.out)
    if args.merge and out_path.exists():
        old = json.loads(out_path.read_text(encoding="utf-8"))
        key = lambda c: (c["model"], c["device"], c["compute"])  # noqa: E731
        fresh = {key(c): c for c in result["stt"]}
        result["stt"] = [fresh.pop(key(c), c) for c in old["stt"]] + list(fresh.values())
        result["tts"] = old["tts"]
        result["voices"] = old.get("voices", result["voices"])
        result["phrases"] = old.get("phrases", result["phrases"])
    else:
        log("speech output")
        result["tts"] = run_tts(log)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    log(f"wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
