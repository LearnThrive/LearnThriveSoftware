"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createEndpointer, encodeWav16k, peak, resampleTo16k, rms } from "@/lib/assistant/audio";
import { settledPrefix, speechChunks, speechChunksPartial, toSpeech } from "@/lib/assistant/speech";
import { judgeTranscript } from "@/lib/assistant/voiceTrust";

/**
 * Voice chat in the browser: talk, and the question is sent when you stop. One turn is a small state machine:
 *
 *   off --open--> requesting (the microphone permission) --> listening --(speech)--> hearing --(a silence)--> finalising
 *     --(sure of the words)--> sending --> answering --> speaking --> listening again (hands-free) or ready
 *     --(unsure)--> confirm (Send / Try again / Edit)                       any state --close--> off
 *   plus denied (the microphone is blocked), error (the speech service failed) and ready (open, waiting for Talk).
 *
 * How the end of a turn is found: loudness, block by block (createEndpointer in lib/assistant/audio.ts): a pause between words
 * does not end it, a silence after speech does. Pressing the button while listening ends it too and sends straight away: the
 * fallback where silence detection is unreliable. The recogniser is a batch one (whole utterance), so there is no live transcript;
 * the panel shows a level meter while listening and the words as soon as they are known.
 *
 * Deliberate safeguards:
 * - the microphone is asked for only by a press, and every track is stopped when a turn ends, the panel closes, the page is hidden
 *   (no recording in a background tab) or the component goes away;
 * - each turn has a number: its words are sent at most once, and a late result from a cancelled turn is ignored;
 * - nothing empty, nothing that was mostly silence, and nothing the recogniser was unsure of is sent without asking;
 * - audio lives only in memory: never stored, never put in a Blob URL, file or log;
 * - talking over the answer, or pressing Stop speaking, silences it at once; reading aloud can be switched off;
 * - if the speech service is missing the browser's own speechSynthesis reads the answer (the text stays on the device that way).
 */
export type VoicePhase = "off" | "ready" | "requesting" | "listening" | "hearing" | "finalising" | "confirm" | "sending" | "answering" | "speaking" | "denied" | "error";

export interface Speaker {
  push: (markdownSoFar: string) => void;
  end: (markdown: string) => void;
  cancel: () => void;
}

const NO_SPEECH_ABOVE = 0.6;
const MIN_RECORDING_MS = 400;

export interface VoiceControls {
  phase: VoicePhase;
  /** The last thing heard (and sent, unless it is waiting for confirmation). */
  heard: string;
  /** A short status or problem line for the panel. */
  message: string;
  handsFree: boolean;
  setHandsFree: (on: boolean) => void;
  readAloud: boolean;
  setReadAloud: (on: boolean) => void;
  /** Attach to the level meter element: its --level custom property follows the microphone without re-rendering React. */
  attachMeter: (element: HTMLElement | null) => void;
  /** Opens voice chat and starts listening (the press that opens it is the gesture the browser needs for the microphone). */
  open: () => void;
  /** Starts listening again (from ready, confirm or after an answer). */
  listen: () => void;
  /** While listening: stop now and send what was said. */
  stopAndSend: () => void;
  /** Discards the turn in progress (and any speech); stays open and ready. */
  cancel: () => void;
  /** Closes voice chat: microphone off, speech off. */
  close: () => void;
  /** confirm: send the words as heard. */
  confirm: () => void;
  /** confirm: give the words to the page to edit in the text box, and close the turn. */
  takeForEditing: () => string;
  /** Silences the answer being read out. */
  stopSpeaking: () => void;
  /** Starts reading an answer aloud as it arrives (only when read-aloud is on). */
  beginSpeaking: () => Speaker | null;
  /** The page says the answer to a spoken question has finished (or failed): the turn moves on. */
  answerFinished: (ok: boolean) => void;
}

export interface VoiceOptions {
  /** Sends the words as a normal LearnThrive AI message. Called once per turn. */
  onUtterance: (text: string) => void;
}

export function useVoice({ onUtterance }: VoiceOptions): VoiceControls {
  const [phase, setPhaseState] = useState<VoicePhase>("off");
  const [heard, setHeard] = useState("");
  const [message, setMessage] = useState("");
  const [handsFree, setHandsFreeState] = useState(true);
  const [readAloud, setReadAloudState] = useState(true);
  const phaseRef = useRef<VoicePhase>("off");
  const handsFreeRef = useRef(true);
  const readAloudRef = useRef(true);
  const turn = useRef(0);
  // The audio graph (a context and the capture worklet) is built once when voice chat opens and kept until it closes, so a turn
  // starts capturing the moment the microphone is granted: nothing said straight after the press is lost to loading the worklet.
  // Each turn has its own microphone stream, stopped when the turn ends.
  const graph = useRef<{ context: AudioContext; node: Promise<AudioWorkletNode> } | null>(null);
  const onBlock = useRef<((data: Float32Array) => void) | null>(null);
  const capture = useRef<{ stream: MediaStream; source: MediaStreamAudioSourceNode; blocks: Float32Array[]; rate: number; startedAt: number; turn: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const playback = useRef<{ context: AudioContext | null; source: AudioBufferSourceNode | null; generation: number }>({ context: null, source: null, generation: 0 });
  const meter = useRef<HTMLElement | null>(null);
  const pending = useRef("");
  const misses = useRef(0);
  // Set below once begin() exists: lets the end of one turn start the next without a dependency cycle between the callbacks.
  const beginRef = useRef<() => Promise<void>>(async () => {});
  const send = useRef(onUtterance);
  useEffect(() => {
    send.current = onUtterance;
  });

  const setPhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const showLevel = (level: number) => meter.current?.style.setProperty("--level", Math.min(1, level * 6).toFixed(3));

  const ensureGraph = useCallback(() => {
    if (!graph.current) {
      const context = new AudioContext();
      const node = context.audioWorklet.addModule("/audio/capture-worklet.js").then(() => {
        const worklet = new AudioWorkletNode(context, "learnthrive-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
        worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onBlock.current?.(event.data);
        return worklet;
      });
      graph.current = { context, node };
    }
    return graph.current;
  }, []);

  /** Ends this turn's recording: the stream's tracks are stopped (the microphone light goes off). */
  const release = useCallback(() => {
    const c = capture.current;
    onBlock.current = null;
    if (!c) return;
    c.source.disconnect();
    for (const track of c.stream.getTracks()) track.stop();
    capture.current = null;
    showLevel(0);
  }, []);

  const closeGraph = useCallback(() => {
    const g = graph.current;
    graph.current = null;
    if (g) void g.context.close().catch(() => undefined);
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

  /** Moves on after a turn: listen again (hands-free) or wait for a press. */
  const nextTurn = useCallback(() => {
    if (phaseRef.current === "off") return;
    if (handsFreeRef.current && typeof document !== "undefined" && !document.hidden) void beginRef.current();
    else setPhase("ready");
  }, [setPhase]);

  /** The recording of this turn is complete: turn it into words, then send, ask, or listen again. */
  const finish = useCallback(async (which: number, reason: "silence" | "button" | "too_long") => {
    const c = capture.current;
    if (!c || c.turn !== which || turn.current !== which) return;
    const elapsed = Date.now() - c.startedAt;
    const samples = resampleTo16k(c.blocks, c.rate);
    release();
    if (elapsed < MIN_RECORDING_MS || peak(samples) < 0.01) {
      setMessage(reason === "button" ? "I did not hear anything. Hold the phone a little closer, or check the microphone is not muted." : "");
      if (reason === "button") return setPhase("ready");
      return nextTurn();
    }
    setPhase("finalising");
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/assistant/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: encodeWav16k(samples) as BodyInit, signal: controller.signal });
      const data = (await response.json().catch(() => null)) as { text?: string; confidence?: number | null; confidenceSource?: string; noSpeech?: number; error?: string } | null;
      if (turn.current !== which || phaseRef.current !== "finalising") return; // cancelled or closed meanwhile
      if (!response.ok) {
        setMessage(data?.error ?? "Voice is not available right now. You can still type your question.");
        return setPhase("error");
      }
      const text = data?.text?.trim() ?? "";
      if (!text || (data?.noSpeech ?? 0) > NO_SPEECH_ABOVE) {
        misses.current += 1;
        setMessage("I did not catch any words. Try again, a little closer to the microphone.");
        // Two misses in a row in hands-free mode: stop listening rather than keep the microphone on in an empty room.
        if (misses.current >= 2) {
          misses.current = 0;
          return setPhase("ready");
        }
        return nextTurn();
      }
      misses.current = 0;
      setHeard(text);
      // Confidence as measured (a number, or null when the recogniser cannot say), and the maths check on top of it: a question
      // with a confusable power, sign or number is shown before it is sent. See voiceTrust.ts.
      const confidence = typeof data?.confidence === "number" ? data.confidence : null;
      const verdict = judgeTranscript({ text, confidence });
      if (verdict.ask) {
        pending.current = text;
        setMessage(verdict.why === "ambiguous" ? "That is easy to mishear. Please check it, especially any signs or powers." : "");
        return setPhase("confirm");
      }
      setPhase("sending");
      send.current(text);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setMessage("We lost the connection. Please try again, or type your question.");
      setPhase("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [nextTurn, release, setPhase]);

  /** Starts a turn: the microphone, the worklet, the end-of-speech detector. */
  const begin = useCallback(async () => {
    if (capture.current) return;
    stopSpeaking();
    const which = (turn.current += 1);
    setPhase("requesting");
    setMessage("");
    try {
      // The graph is started inside the press (browsers only allow audio to start from a gesture), alongside the permission request.
      const g = ensureGraph();
      const [stream, node] = await Promise.all([navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), g.node]);
      if (turn.current !== which || phaseRef.current === "off") {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      await g.context.resume();
      const source = g.context.createMediaStreamSource(stream);
      const blocks: Float32Array[] = [];
      const endpoint = createEndpointer();
      const rate = g.context.sampleRate;
      capture.current = { stream, source, blocks, rate, startedAt: Date.now(), turn: which };
      onBlock.current = (data) => {
        if (capture.current?.turn !== which) return;
        blocks.push(data);
        const level = rms(data);
        showLevel(level);
        const happened = endpoint.push(level, (data.length / rate) * 1000);
        if (happened === "speech_started") setPhase("hearing");
        else if (happened === "utterance_end") void finish(which, "silence");
        else if (happened === "too_long") void finish(which, "too_long");
        else if (happened === "no_speech") {
          release();
          setMessage("I stopped listening because I did not hear anything.");
          setPhase("ready");
        }
      };
      source.connect(node);
      setPhase("listening");
    } catch (error) {
      release();
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setMessage(denied ? "The microphone is blocked. Allow it for this site in your browser's settings, or type your question instead." : "I could not use the microphone. You can type your question instead.");
      setPhase(denied ? "denied" : "error");
    }
  }, [ensureGraph, finish, release, setPhase, stopSpeaking]);

  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const cancelTurn = useCallback(() => {
    turn.current += 1;
    request.current?.abort();
    request.current = null;
    release();
    stopSpeaking();
    pending.current = "";
  }, [release, stopSpeaking]);

  const close = useCallback(() => {
    cancelTurn();
    closeGraph();
    setMessage("");
    setPhase("off");
  }, [cancelTurn, closeGraph, setPhase]);

  // Never record in a hidden tab, and never leave the microphone on after the page goes away.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden && capture.current) {
        cancelTurn();
        setMessage("I stopped listening because you left the page.");
        setPhase("ready");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [cancelTurn, setPhase]);
  useEffect(() => close, [close]);

  const beginSpeaking = useCallback((): Speaker | null => {
    if (!readAloudRef.current || phaseRef.current === "off") return null;
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
    setPhase("answering");

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
          if (phaseRef.current !== "off") setPhase("speaking");
          if (!clip) {
            // The speech service is not there: the device's own voice reads the rest.
            await speakOnDevice(texts.slice(at), live);
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
          at += 1;
        } else if (finished) {
          break;
        } else {
          await new Promise<void>((resolve) => (wake = resolve));
          wake = null;
        }
      }
      if (live()) nextTurn();
    })();

    return {
      push: (markdownSoFar) => {
        if (!live() || finished) return;
        const { ready } = speechChunksPartial(toSpeech(settledPrefix(markdownSoFar)));
        for (const chunk of ready.slice(texts.length)) enqueue(chunk);
      },
      end: (markdown) => {
        if (!live() || finished) return;
        for (const chunk of speechChunks(toSpeech(markdown)).slice(texts.length)) enqueue(chunk);
        finished = true;
        wake?.();
      },
      cancel: () => {
        if (live()) stopSpeaking();
        controller.abort();
      },
    };
  }, [nextTurn, setPhase, stopSpeaking]);

  return {
    phase,
    heard,
    message,
    handsFree,
    setHandsFree: (on) => {
      handsFreeRef.current = on;
      setHandsFreeState(on);
    },
    readAloud,
    setReadAloud: (on) => {
      readAloudRef.current = on;
      setReadAloudState(on);
      if (!on) stopSpeaking();
    },
    attachMeter: (element) => {
      meter.current = element;
    },
    open: () => {
      if (phaseRef.current !== "off" && phaseRef.current !== "ready" && phaseRef.current !== "denied" && phaseRef.current !== "error") return;
      void begin();
    },
    listen: () => {
      cancelTurn();
      void begin();
    },
    stopAndSend: () => {
      if (capture.current) void finish(capture.current.turn, "button");
    },
    cancel: () => {
      cancelTurn();
      setMessage("");
      setPhase("ready");
    },
    close,
    confirm: () => {
      if (phaseRef.current !== "confirm" || !pending.current) return;
      const text = pending.current;
      pending.current = "";
      setPhase("sending");
      send.current(text);
    },
    takeForEditing: () => {
      const text = pending.current || heard;
      pending.current = "";
      setPhase("ready");
      return text;
    },
    stopSpeaking: () => {
      stopSpeaking();
      if (phaseRef.current === "speaking" || phaseRef.current === "answering") nextTurn();
    },
    beginSpeaking,
    answerFinished: (ok) => {
      // Only the turn that sent the question moves on: if the student has already started talking again, leave that turn alone.
      if (phaseRef.current !== "sending" && phaseRef.current !== "answering" && phaseRef.current !== "speaking") return;
      if (!ok) {
        stopSpeaking();
        setPhase("ready");
        return;
      }
      // When the answer is read aloud, the speaker moves the turn on as it finishes; otherwise the turn moves on now.
      if (!readAloudRef.current) nextTurn();
    },
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
