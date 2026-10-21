"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/components/ui/VoiceOrb";
import { TARGET_RATE, encodeWav16k, peak, resampleTo16k } from "@/lib/assistant/audio";
import { settledPrefix, speechChunks, speechChunksPartial, toSpeech } from "@/lib/assistant/speech";

/**
 * Voice mode in the browser (plan19 phase G): push-to-talk capture with an AudioWorklet, the recording sent to /api/assistant/voice/transcribe
 * as a 16 kHz mono WAV, and the answer spoken a sentence or two at a time AS IT STREAMS IN (first audio as soon as the first sentence has settled).
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

export interface Speaker {
  push: (markdownSoFar: string) => void;
  end: (markdown: string) => void;
  cancel: () => void;
}

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
  /** Starts reading an answer aloud as it arrives: push the text so far, then end it with the whole answer (or cancel). */
  beginSpeaking: () => Speaker;
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

  const beginSpeaking = useCallback((): Speaker => {
    stopSpeaking();
    const mine = playback.current.generation;
    const live = () => playback.current.generation === mine;
    const controller = new AbortController();
    const texts: string[] = [];
    const clips: Array<Promise<AudioBuffer | null>> = [];
    let finished = false;
    let wake: (() => void) | null = null;
    const context = (playback.current.context ??= new AudioContext());
    void context.resume().catch(() => undefined);
    setState("thinking");

    const fetchClip = async (text: string): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch("/api/assistant/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
        if (!response.ok) return null;
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        return null;
      }
    };
    const enqueue = (chunk: string) => {
      texts.push(chunk);
      clips.push(fetchClip(chunk)); // fetched at once, so the next clip is ready while this one plays
      wake?.();
    };

    void (async () => {
      let at = 0;
      for (;;) {
        if (!live()) return controller.abort();
        if (at < clips.length) {
          const clip = await clips[at]!;
          if (!live()) return controller.abort();
          if (!clip) {
            // The speech service is not there: the device's own voice reads the rest.
            setState("speaking");
            await speakOnDevice(texts.slice(at), live);
            break;
          }
          setState("speaking");
          await new Promise<void>((resolve) => {
            const source = context.createBufferSource();
            source.buffer = clip;
            source.connect(context.destination);
            source.onended = () => resolve();
            playback.current.source = source;
            source.start();
          });
          at += 1;
        } else if (finished) {
          break;
        } else {
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      }
      if (live()) setState("idle");
    })();

    return {
      // The answer so far: whole sentences are spoken as they settle, the rest waits.
      push: (markdownSoFar) => {
        if (!live() || finished) return;
        const { ready } = speechChunksPartial(toSpeech(settledPrefix(markdownSoFar)));
        for (const chunk of ready.slice(texts.length)) enqueue(chunk);
      },
      // The finished answer: whatever has not been spoken yet.
      end: (markdown) => {
        if (!live() || finished) return;
        for (const chunk of speechChunks(toSpeech(markdown)).slice(texts.length)) enqueue(chunk);
        finished = true;
        wake?.();
      },
      cancel: () => {
        if (live()) stopSpeaking();
        controller.abort();
        setState("idle");
      },
    };
  }, [stopSpeaking]);

  return {
    state,
    transcript,
    setTranscript,
    start,
    stop: () => void finish(),
    cancel,
    beginSpeaking,
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
