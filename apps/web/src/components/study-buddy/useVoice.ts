"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/components/ui/VoiceOrb";
import { TARGET_RATE, encodeWav16k, peak, resampleTo16k } from "@/lib/assistant/audio";
import { speechChunks, toSpeech } from "@/lib/assistant/speech";

/**
 * Voice mode in the browser (plan19 phase G): push-to-talk capture with an AudioWorklet, the recording sent to /api/assistant/voice/transcribe
 * as a 16 kHz mono WAV, and the answer spoken a sentence or two at a time (first audio as soon as the first chunk is ready).
 *
 * Privacy and behaviour, each deliberate:
 * - the microphone is asked for only when the student presses Talk, and every track is stopped the moment they finish or cancel;
 * - the audio exists only in memory: it is never put in storage, a Blob URL, a file or a log;
 * - starting to talk stops any speech at once (nobody should have to wait for the voice to finish);
 * - the words that were heard go back to the page to be corrected before they are sent, never straight to the model;
 * - if the speech service is not there the browser's own speechSynthesis reads the answer (the text never leaves the device that way);
 * - nothing here animates, so reduced motion is respected; the orb and the "Listening" text come from AiInput.
 */
const MAX_RECORDING_MS = 59_000;
const MIN_RECORDING_MS = 400;

type Say = (message: string) => void;

export interface VoiceControls {
  state: VoiceState;
  /** What was heard (or typed over it), shown in the voice panel. */
  transcript: string;
  setTranscript: (text: string) => void;
  /** Starts listening. Asks for the microphone now, not before. */
  start: () => Promise<void>;
  /** Stops listening and turns the recording into words. */
  stop: () => void;
  /** Abandons whatever voice mode is doing (listening, transcribing or speaking). */
  cancel: () => void;
  /** Reads an answer aloud. Resolves when it has finished or was interrupted. */
  speak: (markdown: string) => Promise<void>;
  /** The state while the model is working out an answer to a spoken question. */
  setThinking: (thinking: boolean) => void;
}

export function useVoice(onProblem: Say): VoiceControls {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const capture = useRef<{ context: AudioContext; stream: MediaStream; node: AudioWorkletNode; blocks: Float32Array[]; startedAt: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const request = useRef<AbortController | null>(null);
  const playback = useRef<{ context: AudioContext | null; source: AudioBufferSourceNode | null; generation: number }>({ context: null, source: null, generation: 0 });
  const problem = useRef(onProblem);
  useEffect(() => {
    problem.current = onProblem;
  });

  const release = useCallback(() => {
    const c = capture.current;
    if (!c) return;
    clearTimeout(c.timer);
    c.node.port.onmessage = null;
    c.node.disconnect();
    for (const track of c.stream.getTracks()) track.stop();
    void c.context.close().catch(() => undefined);
    capture.current = null;
  }, []);

  const stopSpeaking = useCallback(() => {
    playback.current.generation += 1;
    try {
      playback.current.source?.stop();
    } catch {
      // already ended
    }
    playback.current.source = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);

  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    release();
    stopSpeaking();
    setState("idle");
  }, [release, stopSpeaking]);

  useEffect(() => cancel, [cancel]);

  const finish = useCallback(async () => {
    const c = capture.current;
    if (!c) return;
    const elapsed = Date.now() - c.startedAt;
    const samples = resampleTo16k(c.blocks, c.context.sampleRate);
    release();
    if (elapsed < MIN_RECORDING_MS || samples.length < (TARGET_RATE * MIN_RECORDING_MS) / 1000) {
      setState("idle");
      return problem.current("That was too short. Hold the Talk button while you speak.");
    }
    if (peak(samples) < 0.01) {
      setState("idle");
      return problem.current("I could not hear anything. Check that your microphone is on and not muted.");
    }
    setState("thinking");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/assistant/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav16k(samples) as BodyInit, signal: controller.signal });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok) problem.current(data?.error ?? "Voice is not available right now. You can still type your question.");
      else if (!data?.text?.trim()) problem.current("I did not catch any words. Please try again, a little closer to the microphone.");
      else setTranscript(data.text.trim());
    } catch (error) {
      if ((error as Error).name !== "AbortError") problem.current("We lost the connection. Please try again, or type your question.");
    } finally {
      request.current = null;
      setState((s) => (s === "thinking" ? "idle" : s));
    }
  }, [release]);

  const start = useCallback(async () => {
    if (capture.current) return;
    stopSpeaking();
    try {
      // Asked now, at the press, never earlier.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const context = new AudioContext();
      await context.audioWorklet.addModule("/audio/capture-worklet.js");
      const node = new AudioWorkletNode(context, "learnthrive-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
      const blocks: Float32Array[] = [];
      node.port.onmessage = (event: MessageEvent<Float32Array>) => blocks.push(event.data);
      context.createMediaStreamSource(stream).connect(node);
      await context.resume();
      capture.current = { context, stream, node, blocks, startedAt: Date.now(), timer: setTimeout(() => void finish(), MAX_RECORDING_MS) };
      setState("listening");
    } catch (error) {
      release();
      setState("idle");
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      problem.current(denied ? "The microphone is blocked. Allow it for this site in your browser, or type your question." : "I could not use the microphone. You can type your question instead.");
    }
  }, [finish, release, stopSpeaking]);

  const speak = useCallback(
    async (markdown: string) => {
      const chunks = speechChunks(toSpeech(markdown));
      if (chunks.length === 0) return;
      stopSpeaking();
      const mine = playback.current.generation;
      const live = () => playback.current.generation === mine;
      setState("speaking");
      const context = (playback.current.context ??= new AudioContext());
      await context.resume().catch(() => undefined);
      const fetchClip = async (text: string): Promise<AudioBuffer | null> => {
        try {
          const response = await fetch("/api/assistant/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
          if (!response.ok) return null;
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch {
          return null;
        }
      };
      // The next clip is fetched while the current one plays.
      let next: Promise<AudioBuffer | null> = fetchClip(chunks[0]!);
      for (let i = 0; i < chunks.length && live(); i += 1) {
        const clip = await next;
        if (i + 1 < chunks.length) next = fetchClip(chunks[i + 1]!);
        if (!live()) break;
        if (!clip) {
          // The speech service is not there: the device's own voice reads the rest.
          await speakOnDevice(chunks.slice(i), live);
          break;
        }
        await new Promise<void>((resolve) => {
          const source = context.createBufferSource();
          source.buffer = clip;
          source.connect(context.destination);
          source.onended = () => resolve();
          playback.current.source = source;
          source.start();
        });
      }
      if (live()) setState("idle");
    },
    [stopSpeaking],
  );

  return {
    state,
    transcript,
    setTranscript,
    start,
    stop: () => void finish(),
    cancel,
    speak,
    setThinking: (thinking) => setState((s) => (thinking ? "thinking" : s === "thinking" ? "idle" : s)),
  };
}

function speakOnDevice(chunks: string[], live: () => boolean): Promise<void> {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let remaining = chunks.length;
    for (const text of chunks) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      const done = () => {
        remaining -= 1;
        if (remaining <= 0 || !live()) resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
    }
  });
}
