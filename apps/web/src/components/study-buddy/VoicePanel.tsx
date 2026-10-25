"use client";

import { Mic, MicOff, Square, Volume2, VolumeX, X } from "lucide-react";
import type { VoiceControls, VoicePhase } from "./useVoice";
import styles from "./VoicePanel.module.css";

/**
 * The voice chat panel: a compact strip above the box (not a modal), so the conversation stays in view and typing is one tap away.
 * Its big button does the obvious thing for the moment (talk, send now, talk over the answer); the state is always written out, and
 * announced politely; the level ring follows the microphone (a still ring when motion is reduced).
 */
const TEXT: Record<VoicePhase, { title: string; hint: string }> = {
  off: { title: "", hint: "" },
  ready: { title: "Tap to talk", hint: "Ask your question out loud. It is sent when you stop talking." },
  requesting: { title: "Allow the microphone", hint: "Your browser will ask. The microphone is only used while this panel is open." },
  listening: { title: "Listening…", hint: "Ask your question. Tap the button to send straight away." },
  hearing: { title: "Listening…", hint: "Keep going. A short pause is fine; it sends when you stop." },
  finalising: { title: "Getting your words…", hint: "One moment." },
  confirm: { title: "Did I hear that right?", hint: "" },
  sending: { title: "LearnThrive AI is answering…", hint: "" },
  answering: { title: "LearnThrive AI is answering…", hint: "Tap the button to talk over it." },
  speaking: { title: "Speaking", hint: "Tap the button to talk over it." },
  denied: { title: "Microphone blocked", hint: "" },
  error: { title: "Voice stopped", hint: "" },
};

export function VoicePanel({ voice, onEdit, onTalkOver }: { voice: VoiceControls; onEdit: (text: string) => void; onTalkOver: () => void }) {
  // Taken apart here: the meter callback goes to a ref, and reading the rest from the same object afterwards confuses the compiler.
  const { phase, heard, message, readAloud, handsFree, attachMeter, stopAndSend, listen, confirm, takeForEditing, stopSpeaking, setReadAloud, setHandsFree, close } = voice;
  if (phase === "off") return null;
  const text = TEXT[phase];
  const recording = phase === "listening" || phase === "hearing";
  const talkingOver = phase === "answering" || phase === "speaking";
  const busy = phase === "requesting" || phase === "finalising" || phase === "sending";

  const primary = () => {
    if (recording) stopAndSend();
    else if (talkingOver) onTalkOver();
    else listen();
  };
  const primaryLabel = recording ? "Stop and send" : talkingOver ? "Talk over the answer" : phase === "confirm" ? "Say it again" : "Start talking";

  return (
    <section className={styles.panel} aria-label="Voice chat" data-phase={phase}>
      <button type="button" className={styles.talk} data-recording={recording || undefined} onClick={primary} disabled={busy} aria-label={primaryLabel}>
        <span className={styles.ring} ref={attachMeter} aria-hidden="true" />
        {recording ? <Square size={18} aria-hidden="true" /> : phase === "denied" ? <MicOff size={20} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
      </button>

      <div className={styles.body}>
        <p className={styles.title} role="status" aria-live="polite">
          {text.title}
        </p>
        {phase === "confirm" ? (
          <div className={styles.confirm}>
            <p className={styles.heard}>“{heard}”</p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.primaryAction} onClick={confirm}>
                Send
              </button>
              <button type="button" className={styles.secondaryAction} onClick={listen}>
                Try again
              </button>
              <button type="button" className={styles.secondaryAction} onClick={() => onEdit(takeForEditing())}>
                Edit
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.hint}>{message || (heard && (phase === "sending" || talkingOver) ? `You said: “${heard}”` : text.hint)}</p>
        )}
        <p className={styles.privacy}>Your voice is turned into text and not kept.</p>
      </div>

      <div className={styles.tools}>
        {talkingOver ? (
          <button type="button" className={styles.tool} onClick={stopSpeaking}>
            <Square size={14} aria-hidden="true" />
            <span>Stop speaking</span>
          </button>
        ) : null}
        <button type="button" className={styles.tool} aria-pressed={readAloud} onClick={() => setReadAloud(!readAloud)}>
          {readAloud ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
          <span>{readAloud ? "Read aloud on" : "Read aloud off"}</span>
        </button>
        <label className={styles.toggle}>
          <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
          <span>Keep listening</span>
        </label>
        <button type="button" className={styles.close} onClick={close} aria-label="Close voice chat">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
