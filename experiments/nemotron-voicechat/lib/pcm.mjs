/**
 * Audio helpers for the experiment: mono PCM16 in and out, base64 for JSON frames, WAV for files on disk.
 *
 * IMPORTANT: the signals produced here are SYNTHETIC TONES, not speech. They exercise the transport, the client's
 * timers and the level meters — nothing here is a test of recognition or of answer quality. Any claim about what a
 * model heard or understood needs a person speaking; see docs/DEMO_TEST_PLAN.md.
 */

export function speechLike({ seconds, rate, seed = 1 }) {
  // A tone that rises and falls in syllable-length bursts, so a level meter and a barge-in detector see "speech cadence".
  const total = Math.round(seconds * rate);
  const out = new Float32Array(total);
  let random = seed * 2654435761 % 4294967296;
  const next = () => {
    random = (random * 1103515245 + 12345) % 2147483648;
    return random / 2147483648;
  };
  for (let i = 0; i < total; i += 1) {
    const t = i / rate;
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t); // about four syllables a second
    const voiced = syllable > 0.25 ? 1 : 0.05;
    const formant = 220 + 160 * Math.sin(2 * Math.PI * 0.7 * t);
    const carrier = Math.sin(2 * Math.PI * formant * t) + 0.4 * Math.sin(2 * Math.PI * (formant * 2.02) * t);
    out[i] = 0.28 * voiced * carrier * (0.85 + 0.15 * next());
  }
  return out;
}

export function tone({ seconds, rate, frequency = 440, amplitude = 0.25 }) {
  const total = Math.round(seconds * rate);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const fade = Math.min(1, Math.min(i, total - i) / (rate * 0.02));
    out[i] = amplitude * fade * Math.sin((2 * Math.PI * frequency * i) / rate);
  }
  return out;
}

export function toPcm16(samples) {
  const buffer = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), i * 2);
  }
  return buffer;
}

export function pcm16ToFloat32(buffer) {
  const out = new Float32Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = buffer.readInt16LE(i * 2) / 32768;
  return out;
}

/** Root-mean-square of a PCM16 buffer, 0 to 1: what the meters and the barge-in detector use. */
export function rmsOfPcm16(buffer) {
  const samples = Math.floor(buffer.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const v = buffer.readInt16LE(i * 2) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

export function writeWav(samples, rate) {
  const pcm = toPcm16(samples);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
