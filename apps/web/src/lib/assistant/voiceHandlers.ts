import { jsonResponse, logOutcome, readBodyLimited } from "@/lib/request-guards";
import { gate, refuse, type AssistantDeps } from "./handlers";
import { VOICE_LIMITS, VoiceError, inspectWav, voiceClosed, type VoiceRuntime } from "./voice";

/**
 * The voice routes' logic (plan19 phase G). Both sit behind the SAME gate as the chat (Origin, assistant open, signed-in adult, Library
 * access) plus voice being open at all, and a per-hour cap per family. Audio and text are held in memory for the length of the request:
 * nothing is stored, and only counters are logged.
 *
 *   POST /api/assistant/voice/transcribe   a 16 kHz mono 16-bit WAV (at most 60 s)  ->  { text }   (shown to the student to correct before sending)
 *   POST /api/assistant/voice/speak        { text }  (one sentence or two)          ->  audio/wav
 */
export interface VoiceDeps extends AssistantDeps {
  voice: VoiceRuntime | null;
}

const NO_STORE = { "Cache-Control": "no-store" };

async function voiceGate(request: Request, deps: VoiceDeps, event: string, counter: string, perHour: number) {
  const g = await gate(request, deps, event);
  if (!g.ok) return g;
  const env = deps.env ?? process.env;
  const closed = voiceClosed(env, Boolean(deps.rt));
  if (closed || !deps.voice) {
    logOutcome(event, "closed", { reason: closed ?? "no-runtime" });
    return { ok: false as const, response: refuse("voice_unavailable") };
  }
  const now = (deps.now ?? (() => new Date()))();
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  if ((await g.rt.store.chat.usageCount(g.owner.clientId, counter, hour)) >= perHour) return { ok: false as const, response: refuse("rate_limited", { "Retry-After": "600" }) };
  await g.rt.store.chat.incrementUsage(g.owner.clientId, counter, hour, 1);
  return { ok: true as const, g, voice: deps.voice };
}

export async function handleTranscribe(request: Request, deps: VoiceDeps): Promise<Response> {
  const checked = await voiceGate(request, deps, "assistant-transcribe", "assistant_stt_hour", VOICE_LIMITS.sttPerHour);
  if (!checked.ok) return checked.response;
  const body = await readBodyLimited(request, VOICE_LIMITS.maxBytes);
  if (!body.ok) return refuse("too_large");
  if (!inspectWav(body.bytes)) {
    logOutcome("assistant-transcribe", "bad_audio");
    return refuse("bad_audio");
  }
  try {
    const result = await checked.voice.stt.transcribe(body.bytes, request.signal);
    logOutcome("assistant-transcribe", "ok", { audioMs: result.audioMs, processingMs: result.processingMs, empty: result.text === "" });
    // The confidence goes through as measured: a number, or null when the recogniser cannot measure one (never a made-up 1.0).
    // What to do with it is decided by the page (voiceTrust.ts): low means ask, and an ambiguous maths question is never sent unseen.
    return jsonResponse(200, { text: result.text.slice(0, 4000), confidence: result.confidence, confidenceSource: result.confidenceSource, noSpeech: result.noSpeech }, NO_STORE);
  } catch (error) {
    const code = error instanceof VoiceError ? error.code : "unavailable";
    logOutcome("assistant-transcribe", "failed", { code });
    return refuse(code === "bad_audio" ? "bad_audio" : "voice_unavailable");
  }
}

export async function handleSpeak(request: Request, deps: VoiceDeps): Promise<Response> {
  const checked = await voiceGate(request, deps, "assistant-speak", "assistant_tts_hour", VOICE_LIMITS.speakPerHour);
  if (!checked.ok) return checked.response;
  const body = await readBodyLimited(request, 8 * 1024);
  let text = "";
  if (body.ok) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body.bytes)) as { text?: unknown };
      text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    } catch {
      text = "";
    }
  }
  if (!text || text.length > VOICE_LIMITS.maxSpeakChars) return refuse(body.ok ? "bad_request" : "too_large");
  try {
    const wav = await checked.voice.tts.speak(text, request.signal);
    logOutcome("assistant-speak", "ok", { chars: text.length, bytes: wav.length });
    return new Response(wav as BodyInit, { status: 200, headers: { "Content-Type": "audio/wav", "Content-Length": String(wav.length), ...NO_STORE, "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    logOutcome("assistant-speak", "failed", { code: error instanceof VoiceError ? error.code : "unavailable" });
    return refuse("voice_unavailable");
  }
}
