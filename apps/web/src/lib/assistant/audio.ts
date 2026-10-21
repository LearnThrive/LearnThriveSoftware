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
