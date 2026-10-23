"use client";

import { ArrowUp, AudioLines, Camera, CircleAlert, ExternalLink, FileText, FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useMotionCapabilities } from "@/lib/motion/capabilities";
import { useInView, VoiceOrb, type VoiceState } from "./VoiceOrb";
import styles from "./AiInput.module.css";

// From Uiverse.io by Cobp (the "Chat" component: pill input, attachment buttons, send and voice orb).

export type { VoiceState };

export interface AiInputProps {
  /** Controlled text. Leave it out and use `defaultValue` for an uncontrolled field. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (text: string) => void;
  /** Enter or the send button. The text is trimmed; it is called with no text only when files are attached. */
  onSubmit?: (text: string, files: File[]) => void;
  /** Attached files (controlled). Leave it out and the component keeps the list itself. */
  files?: File[];
  /** The files that passed the type and count checks, in the order picked. */
  onFilesSelected?: (files: File[]) => void;
  onFileRemove?: (file: File, index: number) => void;
  disabled?: boolean;
  /** An answer is on its way: sending is paused and a visible "Thinking" line is shown. */
  busy?: boolean;
  maxLength?: number;
  /** Comma-separated types, as for `<input accept>`. */
  accept?: string;
  maxFiles?: number;
  placeholder?: string;
  /** Accessible name of the text box. */
  label?: string;
  /** Always-visible guidance above the box. */
  hint?: string;
  /** A message from the page (for example a failed upload). It is announced when it appears. */
  error?: string;
  /** Push-to-talk. The microphone button only appears when `onVoiceStart` is given. */
  voiceState?: VoiceState;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  /** Escape or Close while voice mode is doing something: abandon it. */
  onVoiceCancel?: () => void;
  /** What the speech recogniser heard, shown in the overlay so it can be corrected before sending. */
  transcript?: string;
  /** Without it the transcript is read-only. */
  onTranscriptEdit?: (text: string) => void;
  /** Open the voice overlay on first render (stories and tests). */
  defaultVoiceOpen?: boolean;
  /** Fill the available width at all times (a page's main composer), instead of growing only when used. */
  fullWidth?: boolean;
  /** The page runs its own voice panel: the microphone button calls this (and shows it pressed while `voiceActive`), and the
   *  built-in voice overlay is not used. */
  onVoiceButton?: () => void;
  voiceActive?: boolean;
  id?: string;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png,application/pdf";
/** A press shorter than this is a tap (toggle); longer is push-to-talk (release stops). */
const HOLD_MS = 350;

const STATE_TEXT: Record<VoiceState, { label: string; help: string }> = {
  idle: { label: "Ready", help: "Hold the Talk button and speak." },
  listening: { label: "Listening", help: "Speak now. Let go of Talk, or press it again, when you have finished." },
  thinking: { label: "Thinking", help: "Working out an answer." },
  speaking: { label: "Speaking", help: "Press Talk to interrupt." },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isImage = (file: File): boolean => file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(file.name);

const previewUrlCache = new WeakMap<File, string>();
const subscribeNever = () => () => {};

/**
 * A blob: URL for each attached file, so the student can look at what they are about to send. Made on first use (the same file
 * always gets the same URL, so a re-render never changes it) and revoked as soon as the file leaves the list.
 */
function usePreviewUrls(files: readonly File[]): Map<File, string> {
  const urls = new Map<File, string>();
  // False while the server renders and while the browser hydrates, so the first markup is the same on both sides.
  const inBrowser = useSyncExternalStore(subscribeNever, () => true, () => false);
  for (const file of inBrowser ? files : []) {
    let url = previewUrlCache.get(file);
    if (!url) { url = URL.createObjectURL(file); previewUrlCache.set(file, url); }
    urls.set(file, url);
  }
  const known = useRef<Set<File>>(new Set());
  useEffect(() => {
    const now = new Set(files);
    for (const file of known.current) {
      if (now.has(file)) continue;
      const url = previewUrlCache.get(file);
      if (url) URL.revokeObjectURL(url);
      previewUrlCache.delete(file);
    }
    known.current = now;
  }, [files]);
  return urls;
}

/**
 * The larger look at one attachment: the picture itself, or, for a document, what it is and a way to open it. Escape, the close
 * button and a click outside all close it; focus is held inside while it is open.
 */
function FilePreview({ file, url, onClose }: { file: File; url: string | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const root = panel.current;
    root?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div ref={panel} className={styles.previewPanel} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className={styles.previewHead}>
          <div className={styles.previewTitle}>
            <strong id={titleId}>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
          <button type="button" className={styles.remove} aria-label="Close preview" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {isImage(file) && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.previewImage} src={url} alt={`Preview of ${file.name}, the file you are about to send`} />
        ) : (
          <div className={styles.previewDocument}>
            <FileText size={40} aria-hidden="true" />
            <p>{file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "A PDF document" : file.type || "A file"}</p>
            {url ? (
              <a className={styles.previewOpen} href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden="true" /> Open it to check it
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(",").map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (rules.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return rules.some((rule) =>
    rule.startsWith(".") ? name.endsWith(rule) : rule.endsWith("/*") ? type.startsWith(rule.slice(0, -1)) : type === rule,
  );
}

function describeAccept(accept: string): string {
  const names = accept.split(",").map((rule) => rule.trim()).filter(Boolean).map((rule) =>
    rule.startsWith(".") ? rule.slice(1).toUpperCase() : (rule.split("/")[1] ?? rule).replace("*", "image").toUpperCase(),
  );
  return names.join(", ");
}

export function AiInput({
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  files,
  onFilesSelected,
  onFileRemove,
  disabled = false,
  busy = false,
  maxLength,
  accept = DEFAULT_ACCEPT,
  maxFiles = 3,
  placeholder = "Ask for help with your work",
  label = "Your message",
  hint,
  error,
  voiceState = "idle",
  onVoiceStart,
  onVoiceStop,
  onVoiceCancel,
  transcript = "",
  onTranscriptEdit,
  defaultVoiceOpen = false,
  fullWidth = false,
  onVoiceButton,
  voiceActive = false,
  id,
}: AiInputProps) {
  const generatedId = useId();
  const base = id ?? generatedId;
  const hintId = `${base}-hint`;
  const errorId = `${base}-error`;
  const counterId = `${base}-count`;

  const [innerText, setInnerText] = useState(defaultValue);
  const text = value ?? innerText;
  const [innerFiles, setInnerFiles] = useState<File[]>([]);
  const attached = files ?? innerFiles;
  const previewUrls = usePreviewUrls(attached);
  const [previewOpen, setPreviewing] = useState<File | null>(null);
  // A file removed while its preview is open (or sent) closes the preview with it.
  const previewing = previewOpen && attached.includes(previewOpen) ? previewOpen : null;
  const [localError, setLocalError] = useState("");
  const shownError = error || localError;
  const [voiceOpen, setVoiceOpen] = useState(defaultVoiceOpen);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const micRef = useRef<HTMLButtonElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef<HTMLParagraphElement>(null);
  const wasVoiceOpen = useRef(false);

  const { tier } = useMotionCapabilities();
  // The Thinking dots loop forever, so (like the orb) only on the full tier and only while on screen.
  const dotsAnimated = busy && tier === "full";
  const busyInView = useInView(busyRef, dotsAnimated);
  const voiceEnabled = Boolean(onVoiceStart || onVoiceButton);
  const canSend = !disabled && !busy && (text.trim().length > 0 || attached.length > 0);

  // Back to the microphone button when the overlay closes (a removed <dialog> restores nothing itself).
  useEffect(() => {
    if (voiceOpen) wasVoiceOpen.current = true;
    else if (wasVoiceOpen.current) {
      wasVoiceOpen.current = false;
      micRef.current?.focus();
    }
  }, [voiceOpen]);

  function setText(next: string) {
    if (value === undefined) setInnerText(next);
    onValueChange?.(next);
  }

  function submit(sendText: string) {
    if (disabled || busy) return;
    const trimmed = sendText.trim();
    if (!trimmed && attached.length === 0) return;
    onSubmit?.(trimmed, attached);
    // Sending the voice transcript must not throw away what was typed in the box.
    if (value === undefined && sendText === text) setInnerText("");
    if (files === undefined) setInnerFiles([]);
    setLocalError("");
    textRef.current?.focus();
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    submit(text);
  }

  // The pill grows while the text box has focus. A press on one of its buttons must not change the layout (the
  // buttons at the right would slide away from under the pointer before the click lands), so it keeps the focus where it is.
  function keepFocus(event: MouseEvent<HTMLFormElement>) {
    if ((event.target as HTMLElement).closest("button")) event.preventDefault();
  }

  function onTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter is a newline; Enter while an IME is composing belongs to the IME.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(text);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = ""; // so the same file can be picked again after removing it
    if (picked.length === 0) return;
    const valid = picked.filter((file) => matchesAccept(file, accept));
    const room = Math.max(0, maxFiles - attached.length);
    const taken = valid.slice(0, room);
    if (valid.length < picked.length) setLocalError(`Only ${describeAccept(accept)} files can be attached.`);
    else if (taken.length < valid.length) setLocalError(`You can attach up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`);
    else setLocalError("");
    if (taken.length === 0) return;
    if (files === undefined) setInnerFiles([...attached, ...taken]);
    onFilesSelected?.(taken);
  }

  function remove(index: number) {
    const file = attached[index];
    if (files === undefined) setInnerFiles(attached.filter((_, i) => i !== index));
    setLocalError("");
    onFileRemove?.(file, index);
    textRef.current?.focus();
  }

  function closeVoice() {
    if (voiceState !== "idle") onVoiceCancel?.();
    setVoiceOpen(false);
  }

  const imageAccept = accept.split(",").map((rule) => rule.trim()).filter((rule) => rule.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic)$/i.test(rule)).join(",") || "image/*";
  const nearLimit = maxLength !== undefined && text.length >= maxLength * 0.8;
  const describedBy = [hint ? hintId : "", shownError ? errorId : "", nearLimit ? counterId : ""].filter(Boolean).join(" ") || undefined;
  const expanded = text.length > 0 || attached.length > 0 || busy || voiceOpen;

  return (
    <div className={styles.root} data-ai-input="" data-busy={busy} data-disabled={disabled} data-full-width={fullWidth || undefined}>
      {hint && <p id={hintId} className={styles.hint}>{hint}</p>}

      <form className={styles.pill} data-expanded={expanded} onSubmit={onFormSubmit} onMouseDown={keepFocus} aria-busy={busy}>
        <div className={styles.attach}>
          <button type="button" className={styles.iconButton} aria-label="Take a photo" disabled={disabled} onClick={() => cameraRef.current?.click()}>
            <Camera size={20} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Add an image" disabled={disabled} onClick={() => imageRef.current?.click()}>
            <ImageIcon size={20} aria-hidden="true" />
          </button>
          <button type="button" className={styles.iconButton} aria-label="Add a file" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <FolderOpen size={20} aria-hidden="true" />
          </button>
        </div>

        <textarea
          ref={textRef}
          className={styles.text}
          rows={1}
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={shownError ? true : undefined}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onTextKeyDown}
        />

        <div className={styles.actions}>
          {onVoiceButton ? (
            <button type="button" className={styles.iconButton} aria-label={voiceActive ? "Voice chat is on" : "Talk instead of typing"} aria-pressed={voiceActive} disabled={disabled} onClick={onVoiceButton}>
              <AudioLines size={20} aria-hidden="true" />
            </button>
          ) : voiceEnabled && (
            <button
              ref={micRef}
              type="button"
              className={styles.iconButton}
              aria-label="Talk instead"
              aria-haspopup="dialog"
              aria-expanded={voiceOpen}
              disabled={disabled}
              onClick={() => setVoiceOpen(true)}
            >
              <AudioLines size={20} aria-hidden="true" />
            </button>
          )}
          <button type="submit" className={styles.send} aria-label="Send" disabled={!canSend}>
            <ArrowUp size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Real file inputs, kept out of sight: the visible buttons above are what people reach and press. */}
        <input ref={cameraRef} type="file" hidden accept="image/*" capture="environment" data-testid="ai-input-camera" onChange={onPick} />
        <input ref={imageRef} type="file" hidden accept={imageAccept} multiple data-testid="ai-input-image" onChange={onPick} />
        <input ref={fileRef} type="file" hidden accept={accept} multiple data-testid="ai-input-file" onChange={onPick} />
      </form>

      {attached.length > 0 && (
        <ul className={styles.files} aria-label="Attached files">
          {attached.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`} className={styles.file}>
              <button type="button" className={styles.preview} aria-label={`Preview ${file.name}`} aria-haspopup="dialog" onClick={() => setPreviewing(file)}>
                {isImage(file) && previewUrls.get(file) ? (
                  // A blob: URL of the student's own file, shown only to them: next/image cannot optimise it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.thumb} src={previewUrls.get(file)} alt="" />
                ) : (
                  <span className={styles.thumb} data-kind="document"><FileText size={20} aria-hidden="true" /></span>
                )}
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              </button>
              <button type="button" className={styles.remove} aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => remove(index)}>
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {previewing && (
        <FilePreview file={previewing} url={previewUrls.get(previewing) ?? null} onClose={() => { setPreviewing(null); textRef.current?.focus(); }} />
      )}

      {nearLimit && <p id={counterId} className={styles.counter}>{text.length} of {maxLength} characters</p>}

      {shownError && (
        <p id={errorId} role="alert" className={styles.error}>
          <CircleAlert size={16} aria-hidden="true" />
          <span>{shownError}</span>
        </p>
      )}

      {/* Native maxLength stops typing without a word; this says so. Always in the page so the change is announced. */}
      {maxLength !== undefined && (
        <p role="status" className={styles.visuallyHidden}>{text.length >= maxLength ? "Character limit reached" : ""}</p>
      )}

      {/* Always in the page so the change of its text is announced. */}
      <p ref={busyRef} role="status" className={styles.busy} data-animated={dotsAnimated} data-paused={dotsAnimated && !busyInView}>
        {busy && (
          <>
            <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
            Thinking
          </>
        )}
      </p>

      {voiceOpen && (
        <VoiceOverlay
          state={voiceState}
          transcript={transcript}
          editable={Boolean(onTranscriptEdit)}
          onTranscriptEdit={onTranscriptEdit}
          onStart={() => onVoiceStart?.()}
          onStop={() => onVoiceStop?.()}
          onSend={() => submit(transcript)}
          canSend={!busy && !disabled && voiceState === "idle" && transcript.trim().length > 0}
          onClose={closeVoice}
        />
      )}
    </div>
  );
}

function VoiceOverlay({ state, transcript, editable, onTranscriptEdit, onStart, onStop, onSend, canSend, onClose }: {
  state: VoiceState;
  transcript: string;
  editable: boolean;
  onTranscriptEdit?: (text: string) => void;
  onStart: () => void;
  onStop: () => void;
  onSend: () => void;
  canSend: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const text = STATE_TEXT[state];
  const press = useRef<{ at: number; started: boolean } | null>(null);
  const lastEvent = useRef(0);

  // A native modal <dialog> gives the focus trap, Escape, an inert page behind it and the top layer
  // (so no z-index), instead of rebuilding all four.
  // Stable, or React would re-run it on every render and pull focus back to Talk while the student types.
  const mount = useCallback((dialog: HTMLDialogElement | null) => {
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  // The native modal already keeps focus off the page behind it; this keeps it from leaving for the browser's
  // own controls too, so Tab wraps from the last control to the first and Shift+Tab the other way.
  function wrapTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea:not(:disabled)"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function begin() {
    if (press.current) return;
    lastEvent.current = Date.now();
    if (state === "listening") {
      press.current = { at: Date.now(), started: false };
      onStop(); // pressing while listening stops it (the tap-to-toggle way)
    } else {
      press.current = { at: Date.now(), started: true };
      onStart();
    }
  }

  function end() {
    const current = press.current;
    press.current = null;
    lastEvent.current = Date.now();
    // Held long enough: push-to-talk, so letting go stops. A short press leaves it listening.
    if (current?.started && Date.now() - current.at >= HOLD_MS) onStop();
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    begin();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) begin();
  }

  function onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    end();
  }

  return (
    <dialog
      ref={mount}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      data-voice-overlay=""
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={wrapTab}
    >
      <div className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 id={`${id}-title`} className={styles.panelTitle}>Voice mode</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            <X size={18} aria-hidden="true" />
            Close
          </button>
        </header>

        <VoiceOrb state={state} />

        <div className={styles.state}>
          <p role="status" className={styles.stateLabel} data-voice-state={state}>{text.label}</p>
          <p className={styles.stateHelp}>{text.help}</p>
          {/* The transcript box is not a live region, so say when there is something in it to check. */}
          <p role="status" className={styles.visuallyHidden}>
            {state === "idle" && transcript.trim() ? "Your words are in the box below. Check them, then press Send." : ""}
          </p>
        </div>

        <div className={styles.transcript}>
          <label htmlFor={`${id}-transcript`} className={styles.transcriptLabel}>
            What I heard{editable ? " (you can correct it)" : ""}
          </label>
          <textarea
            id={`${id}-transcript`}
            className={styles.transcriptBox}
            rows={3}
            value={transcript}
            readOnly={!editable}
            placeholder="Your words will appear here"
            onChange={(event) => onTranscriptEdit?.(event.target.value)}
          />
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.talk}
            data-autofocus=""
            aria-pressed={state === "listening"}
            aria-describedby={`${id}-talk-help`}
            onPointerDown={onPointerDown}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={end}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => {
              // A click with no press just before it comes from assistive technology: treat it as a toggle.
              if (Date.now() - lastEvent.current < 800) return;
              if (state === "listening") onStop();
              else onStart();
            }}
          >
            <AudioLines size={22} aria-hidden="true" />
            Talk
          </button>
          <button type="button" className={styles.sendVoice} disabled={!canSend} onClick={onSend}>
            <ArrowUp size={20} aria-hidden="true" />
            Send
          </button>
        </div>
        <p id={`${id}-talk-help`} className={styles.talkHelp}>
          Hold Talk while you speak, or press it once to start and again to stop. Space and Enter work too.
        </p>
      </div>
    </dialog>
  );
}
