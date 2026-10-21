import { assistantAvailability, assistantConfig } from "./config";

/**
 * Voice mode's speech providers (plan19 section 5.4), behind the same configuration style as the language model. The browser never
 * talks to a speech service: `/api/assistant/voice/*` does, after the same sign-in, access and rate checks as the chat, so the
 * Content Security Policy is unchanged and no audio leaves this server except to the configured service.
 *
 *   VOICE_ENABLED   development: on unless "false". PRODUCTION: always closed here. A hosted speech provider (a processor for a child's
 *                   voice) is a plan19 section 6 decision that has not been made, so there is no production speech provider in the code.
 *   VOICE_PROVIDER  sidecar (default: services/voice on this machine) or mock (tests)
 *   VOICE_URL       the sidecar's address (default http://127.0.0.1:8765)        VOICE_TOKEN   its shared secret, if it has one
 *
 * Audio is processed in memory and never stored or logged: this file keeps no copy of any request.
 */
type Env = Record<string, string | undefined>;

export interface Transcript {
  text: string;
  audioMs: number;
  processingMs: number;
}

export interface SpeechToText {
  transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<Transcript>;
}

export interface TextToSpeech {
  /** One sentence or two, spoken; returns a WAV file. */
  speak(text: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export type VoiceErrorCode = "unavailable" | "timeout" | "bad_audio" | "aborted";

export class VoiceError extends Error {
  constructor(readonly code: VoiceErrorCode) {
    super(`voice: ${code}`);
  }
}

export const VOICE_LIMITS = { maxSeconds: 60, maxBytes: 4 * 1024 * 1024, maxSpeakChars: 600, sampleRate: 16000, sttPerHour: 120, speakPerHour: 600 } as const;

export interface VoiceConfig {
  enabled: boolean;
  provider: "sidecar" | "mock" | null;
  baseUrl: string;
  token: string | null;
}

const pick = (v: string | undefined) => v?.trim() || undefined;

export function voiceConfig(env: Env = process.env): VoiceConfig {
  const provider = (pick(env.VOICE_PROVIDER) ?? "sidecar").toLowerCase();
  return {
    enabled: env.NODE_ENV !== "production" && pick(env.VOICE_ENABLED) !== "false",
    provider: provider === "sidecar" || provider === "mock" ? provider : null,
    baseUrl: pick(env.VOICE_URL) ?? "http://127.0.0.1:8765",
    token: pick(env.VOICE_TOKEN) ?? null,
  };
}

export type VoiceClosed = "assistant_closed" | "disabled" | "production" | "no_provider";

/** Whether voice may run at all, and the first reason it may not. Voice needs the assistant open first. */
export function voiceClosed(env: Env = process.env, backend = true): VoiceClosed | null {
  if (env.NODE_ENV === "production") return "production";
  if (!assistantAvailability(assistantConfig(env), env, backend).open) return "assistant_closed";
  const config = voiceConfig(env);
  if (!config.enabled) return "disabled";
  return config.provider ? null : "no_provider";
}

/**
 * Checks the shape of the audio BEFORE it is sent anywhere: a RIFF/WAVE file, PCM, one channel, 16 kHz, 16 bits, no longer than
 * the limit. Returns the length in milliseconds, or null if it is not what the speech service expects. The browser makes exactly
 * this format (src/lib/assistant/audio.ts), so anything else is a bad request, not something to guess at.
 */
export function inspectWav(bytes: Uint8Array): { audioMs: number } | null {
  if (bytes.length < 44 || bytes.length > VOICE_LIMITS.maxBytes) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let at = 12;
  let formatOk = false;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") {
      if (size < 16 || at + 8 + 16 > bytes.length) return null;
      formatOk = view.getUint16(at + 8, true) === 1 && view.getUint16(at + 10, true) === 1 && view.getUint32(at + 12, true) === VOICE_LIMITS.sampleRate && view.getUint16(at + 22, true) === 16;
    } else if (id === "data") {
      if (!formatOk) return null;
      const length = Math.min(size, bytes.length - (at + 8));
      const audioMs = Math.round((length / 2 / VOICE_LIMITS.sampleRate) * 1000);
      return audioMs > 0 && audioMs <= VOICE_LIMITS.maxSeconds * 1000 ? { audioMs } : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The speech service in services/voice (faster-whisper for recognition, Piper for speech). */
export class SidecarSpeech implements SpeechToText, TextToSpeech {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private async call(path: string, body: BodyInit, contentType: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Response> {
    const joined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const response = await this.doFetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": contentType, ...(this.token ? { "x-voice-token": this.token } : {}) },
        body,
        signal: joined,
      });
      if (response.status === 400 || response.status === 413) throw new VoiceError("bad_audio");
      if (!response.ok) throw new VoiceError("unavailable");
      return response;
    } catch (error) {
      if (error instanceof VoiceError) throw error;
      if (signal?.aborted) throw new VoiceError("aborted");
      if (error instanceof DOMException && error.name === "TimeoutError") throw new VoiceError("timeout");
      throw new VoiceError("unavailable");
    }
  }

  async transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<Transcript> {
    const response = await this.call("/stt", new Blob([wav as BlobPart]), "audio/wav", signal, 30_000);
    const data = (await response.json().catch(() => null)) as Partial<Transcript> | null;
    if (!data || typeof data.text !== "string") throw new VoiceError("unavailable");
    return { text: data.text.trim(), audioMs: Number(data.audioMs) || 0, processingMs: Number(data.processingMs) || 0 };
  }

  async speak(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await this.call("/tts", JSON.stringify({ text }), "application/json", signal, 20_000);
    return new Uint8Array(await response.arrayBuffer());
  }

  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.doFetch(`${this.baseUrl.replace(/\/+$/, "")}/health`, { signal: signal ?? AbortSignal.timeout(2000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/** For tests and for development without a speech service: a fixed transcript and a short silent clip. */
export class MockSpeech implements SpeechToText, TextToSpeech {
  async transcribe(wav: Uint8Array): Promise<Transcript> {
    const info = inspectWav(wav);
    if (!info) throw new VoiceError("bad_audio");
    return { text: "Factorise x squared plus five x plus six", audioMs: info.audioMs, processingMs: 5 };
  }

  async speak(): Promise<Uint8Array> {
    return silentWav(0.2, 22050);
  }

  async health(): Promise<boolean> {
    return true;
  }
}

/** A mono 16-bit WAV of silence. */
export function silentWav(seconds: number, sampleRate: number): Uint8Array {
  const samples = Math.round(seconds * sampleRate);
  const out = new Uint8Array(44 + samples * 2);
  const view = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, samples * 2, true);
  return out;
}

export interface VoiceRuntime {
  stt: SpeechToText;
  tts: TextToSpeech;
  health(): Promise<boolean>;
}

export function buildVoice(config: VoiceConfig): VoiceRuntime | null {
  if (config.provider === "mock") {
    const mock = new MockSpeech();
    return { stt: mock, tts: mock, health: () => mock.health() };
  }
  if (config.provider === "sidecar") {
    const sidecar = new SidecarSpeech(config.baseUrl, config.token);
    return { stt: sidecar, tts: sidecar, health: () => sidecar.health() };
  }
  return null;
}

const g = globalThis as unknown as { __learnthriveVoice?: VoiceRuntime | null };

export function voiceRuntime(env: Env = process.env): VoiceRuntime | null {
  if (g.__learnthriveVoice !== undefined) return g.__learnthriveVoice;
  if (voiceClosed(env)) return null;
  g.__learnthriveVoice = buildVoice(voiceConfig(env));
  return g.__learnthriveVoice;
}

/** For tests. */
export function resetVoiceRuntime(): void {
  delete g.__learnthriveVoice;
}
