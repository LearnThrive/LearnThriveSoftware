/**
 * Turns what the microphone gives the browser into what the speech service wants (plan19 section 5.4): 16 kHz, mono, 16-bit PCM in a
 * WAV file. Done in the browser so the server needs no ffmpeg. Pure functions, so the tests can pin them; the Web Audio parts that
 * call them are in src/components/study-buddy/useVoice.ts.
 */
export const TARGET_RATE = 16000;

/** Joins the captured blocks, then resamples to 16 kHz by averaging each output sample's span of input (a box filter: no aliasing hiss). */
export function resampleTo16k(blocks: readonly Float32Array[], inputRate: number): Float32Array {
  const total = blocks.reduce((sum, b) => sum + b.length, 0);
  const input = new Float32Array(total);
  let at = 0;
  for (const b of blocks) {
    input.set(b, at);
    at += b.length;
  }
  if (inputRate === TARGET_RATE) return input;
  const ratio = inputRate / TARGET_RATE;
  const length = Math.floor(total / ratio);
  const out = new Float32Array(length);
  if (ratio > 1) {
    for (let i = 0; i < length; i += 1) {
      const from = Math.floor(i * ratio);
      const to = Math.min(total, Math.max(from + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = from; j < to; j += 1) sum += input[j]!;
      out[i] = sum / (to - from);
    }
  } else {
    // Upsampling (a device below 16 kHz is rare): linear interpolation.
    for (let i = 0; i < length; i += 1) {
      const pos = i * ratio;
      const lo = Math.floor(pos);
      const hi = Math.min(total - 1, lo + 1);
      out[i] = input[lo]! + (input[hi]! - input[lo]!) * (pos - lo);
    }
  }
  return out;
}

/** The loudest sample, 0 to 1: a recording that never rises above a whisper is a muted or missing microphone. */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]!);
    if (v > max) max = v;
  }
  return max;
}

/** A mono 16-bit PCM WAV file at 16 kHz. */
export function encodeWav16k(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(out.buffer);
  const put = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** The loudness of a block of samples (root mean square, 0 to 1). */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export interface EndpointerOptions {
  /** Silence after speech that ends an utterance. */
  endSilenceMs?: number;
  /** Speech needed before an utterance counts (a cough or a click is not a question). */
  minSpeechMs?: number;
  /** No speech at all for this long: give up listening. */
  noSpeechMs?: number;
  /** The longest utterance. */
  maxMs?: number;
}

export type EndpointEvent = "none" | "speech_started" | "utterance_end" | "no_speech" | "too_long";

/**
 * End-of-turn detection from loudness alone (a voice-activity detector): no model, no network, runs on each ~43 ms block the
 * microphone gives. The noise floor adapts to the room (it follows the quietest recent blocks), and speech is loudness well above
 * it, with a fixed minimum so near-silence never counts. An utterance ends after `endSilenceMs` of quiet following at least
 * `minSpeechMs` of speech; a short pause between words (under the silence window) does not end it.
 *
 * ponytail: energy VAD, misled by steady loud noise (a fan next to the microphone) or very quiet speakers; tap-to-stop still sends.
 * A model VAD (Silero, WebRTC VAD) is the upgrade if real rooms show either problem.
 */
export function createEndpointer(options: EndpointerOptions = {}) {
  const endSilenceMs = options.endSilenceMs ?? 900;
  const minSpeechMs = options.minSpeechMs ?? 300;
  const noSpeechMs = options.noSpeechMs ?? 8000;
  const maxMs = options.maxMs ?? 30_000;
  let floor = 0.01;
  let elapsed = 0;
  let speechMs = 0;
  let quietMs = 0;
  let started = false;
  let done = false;
  return {
    /** Feeds one block (its loudness and length); returns what, if anything, just happened. */
    push(level: number, blockMs: number): EndpointEvent {
      if (done) return "none";
      elapsed += blockMs;
      // The floor falls quickly to quiet (about 0.1 s) and rises slowly (about 8 s), so speech itself does not drag it up. Both are
      // set in time, not per block: a 2048-sample block is 43 ms at 48 kHz but 128 ms at 16 kHz.
      const rate = 1 - Math.exp(-blockMs / (level < floor ? 120 : 8000));
      floor += (level - floor) * rate;
      const threshold = Math.max(0.02, floor * 3);
      const speaking = level > threshold;
      if (speaking) {
        speechMs += blockMs;
        quietMs = 0;
      } else quietMs += blockMs;
      if (!started && speechMs >= minSpeechMs) {
        started = true;
        return "speech_started";
      }
      if (started && quietMs >= endSilenceMs) {
        done = true;
        return "utterance_end";
      }
      if (!started && elapsed >= noSpeechMs) {
        done = true;
        return "no_speech";
      }
      if (elapsed >= maxMs) {
        done = true;
        return "too_long";
      }
      return "none";
    },
    get heardSpeech() {
      return started;
    },
  };
}
