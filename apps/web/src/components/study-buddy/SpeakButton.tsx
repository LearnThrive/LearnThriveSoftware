"use client";

import { Volume2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { speechChunksWhole, toSpeech } from "@/lib/assistant/speech";

/**
 * The one message being read out, across every button on the page. Pressing Read aloud on another message stops this one first:
 * two voices at once are never useful, and on a phone they are impossible to follow.
 */
let stopActive: (() => void) | null = null;

interface SpeakButtonProps {
  /** The message as it is on screen: Markdown for an answer, plain words for a question. */
  text: string;
  /** Whether the site's speech service is available. When it is not, the device's own voice reads the message. */
  serverVoice?: boolean;
  className?: string;
}

/**
 * Reads one message aloud. Each piece is fetched from `/api/assistant/voice/speak` and played as it arrives; if the service is
 * missing, rate limited or returns a clip that cannot be decoded, the browser's `speechSynthesis` reads the rest on the device, so
 * the button still works with no speech service at all. Nothing is stored: the words go out with the request, the clip lives in
 * memory and dies with the AudioContext.
 */
export function SpeakButton({ text, serverVoice = false, className }: SpeakButtonProps) {
  const [speaking, setSpeaking] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // Leaving the page (or the chat) silences it: an answer must not keep talking from a component that is gone.
  useEffect(
    () => () => {
      stopRef.current?.();
    },
    [],
  );

  const toggle = useCallback(() => {
    if (stopRef.current) {
      stopRef.current();
      return;
    }
    const pieces = speechChunksWhole(toSpeech(text));
    if (pieces.length === 0) return;
    stopActive?.();

    const controller = new AbortController();
    let stopped = false;
    let context: AudioContext | null = null;
    let source: AudioBufferSourceNode | null = null;
    let wake: (() => void) | null = null;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
      try {
        source?.stop();
      } catch {
        // already ended
      }
      source = null;
      wake?.();
      wake = null;
      void context?.close().catch(() => undefined);
      context = null;
      if (stopActive === finish) stopActive = null;
      if (stopRef.current === finish) stopRef.current = null;
      setSpeaking(false);
    };
    stopActive = finish;
    stopRef.current = finish;
    setSpeaking(true);

    const playClip = async (data: ArrayBuffer) => {
      context ??= new AudioContext();
      if (context.state === "suspended") await context.resume().catch(() => undefined);
      const buffer = await context.decodeAudioData(data);
      if (stopped) return;
      await new Promise<void>((resolve) => {
        const clip = context!.createBufferSource();
        clip.buffer = buffer;
        clip.connect(context!.destination);
        wake = resolve;
        clip.onended = () => {
          if (source === clip) source = null;
          if (wake === resolve) wake = null;
          resolve();
        };
        source = clip;
        clip.start();
      });
    };

    /** The browser's own voice, from piece `from` onwards. Used when the speech service is absent or a clip failed. */
    const speakOnDevice = async (from: number) => {
      if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return;
      for (const piece of pieces.slice(from)) {
        if (stopped) return;
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(piece);
          utterance.lang = "en-GB";
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          wake = resolve;
          speechSynthesis.speak(utterance);
        });
        wake = null;
      }
    };

    void (async () => {
      try {
        if (!serverVoice) {
          await speakOnDevice(0);
        } else {
          for (let at = 0; at < pieces.length; at += 1) {
            if (stopped) return;
            try {
              const response = await fetch("/api/assistant/voice/speak", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: pieces[at] }),
                signal: controller.signal,
              });
              if (!response.ok) throw new Error(`speak ${response.status}`);
              await playClip(await response.arrayBuffer());
            } catch {
              if (stopped) return;
              // The speech service is not there (or this clip failed): the device finishes the message.
              await speakOnDevice(at);
              break;
            }
          }
        }
      } finally {
        finish();
      }
    })();
  }, [serverVoice, text]);

  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-pressed={speaking}
      aria-label={speaking ? "Stop reading this message" : "Read this message aloud"}
      title={speaking ? "Stop reading" : "Read aloud"}
    >
      {speaking ? <Square size={13} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
      {speaking ? "Stop" : "Read aloud"}
    </button>
  );
}
