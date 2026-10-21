"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiInput } from "@/components/ui/AiInput";
import { PencilLoader } from "@/components/ui/PencilLoader";
import { ADULT_ACKNOWLEDGEMENT, AI_LABEL } from "@/lib/assistant/prompt";
import { parseMarkdown, plainText } from "@/lib/assistant/markdown";
import { RenderedAnswer } from "./RenderedAnswer";
import { useVoice } from "./useVoice";
import styles from "./study-buddy.module.css";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
}
interface SessionItem {
  id: string;
  title: string;
}
interface Status {
  open: boolean;
  reason?: string | null;
  /** The speech service is there: the microphone button may appear. */
  voice?: boolean;
  minorsApproved?: boolean;
  limits?: { dailyMessages: number; perMinute: number; maxInputChars: number; files: number };
}

const ERROR_TEXT: Record<string, string> = {
  rate_limited_minute: "You are asking quickly. Please wait a moment.",
  rate_limited_day: "You have used today's questions. Study Buddy will be back tomorrow.",
  busy: "Study Buddy is busy right now. Please try again in a moment.",
  unavailable: "Study Buddy could not answer just now. Please try again shortly.",
  timeout: "That took too long. Please try a shorter question.",
  budget: "Study Buddy has reached its limit for today.",
  vision_unavailable: "Study Buddy cannot look at photos right now. You can type the question instead.",
  too_long: "That message is too long. Please shorten it.",
  empty: "Please type a question first.",
  no_chat: "That chat is no longer there. Please start a new one.",
};

let counter = 0;
const nextId = () => `local-${(counter += 1)}`;

/**
 * Study Buddy (plan19 phase F). One screen: your chats on the left, the conversation, and the box. The answer streams in as
 * newline-delimited JSON events; Stop ends it (what was shown is kept). Everything an answer shows goes through the safe Markdown
 * renderer (no raw HTML), maths is drawn by KaTeX loaded only when needed, and every answer carries "AI-generated, may be wrong".
 * Screen readers hear the answer a sentence at a time in a polite live region, not every word. The text is never stored in the
 * browser: nothing here uses localStorage or sessionStorage.
 */
export function StudyBuddy() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<Map<File, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState("");
  const [error, setError] = useState("");
  const [adultAck, setAdultAck] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const spoken = useRef(0);
  const voice = useVoice(setError);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/assistant/sessions", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setSessions(((await response.json()) as { sessions: SessionItem[] }).sessions);
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/assistant/status", { cache: "no-store" }).catch(() => null);
      setStatus(response?.ok ? ((await response.json()) as Status) : { open: false, reason: "unreachable" });
      void refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  async function open(id: string) {
    if (busy) return;
    const response = await fetch(`/api/assistant/sessions/${id}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return setError("We could not open that chat.");
    const data = (await response.json()) as { messages: Msg[] };
    setSessionId(id);
    setMessages(data.messages);
    setError("");
    setFiles([]);
  }

  function newChat() {
    if (busy) return;
    setSessionId(null);
    setMessages([]);
    setFiles([]);
    setFileIds(new Map());
    setError("");
  }

  async function removeChat(id: string) {
    if (!window.confirm("Delete this chat? It is removed for good.")) return;
    const response = await fetch(`/api/assistant/sessions/${id}`, { method: "DELETE" });
    if (response.ok) {
      if (id === sessionId) newChat();
      void refresh();
    } else setError("We could not delete that chat.");
  }

  async function removeAll() {
    if (!window.confirm("Delete all your Study Buddy chats? They are removed for good.")) return;
    const response = await fetch("/api/assistant/sessions", { method: "DELETE" });
    if (response.ok) {
      newChat();
      void refresh();
    } else setError("We could not delete your chats.");
  }

  async function upload(picked: File[]) {
    setError("");
    for (const file of picked) {
      const form = new FormData();
      form.set("file", file);
      if (sessionId) form.set("sessionId", sessionId);
      const response = await fetch("/api/assistant/files", { method: "POST", body: form }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as { fileId?: string; sessionId?: string; error?: string } | null;
      if (response?.ok && data?.fileId) {
        if (data.sessionId && !sessionId) setSessionId(data.sessionId);
        setFiles((current) => [...current, file]);
        setFileIds((current) => new Map(current).set(file, data.fileId!));
      } else setError(data?.error ?? "We could not add that file.");
    }
  }

  async function send(text: string) {
    if (busy) return;
    // A question that came from the microphone is answered in short, speakable wording and read aloud; a typed one is not.
    const viaVoice = Boolean(status?.voice) && text.trim() !== "" && text.trim() === voice.transcript.trim();
    const needsAck = !sessionId && !status?.minorsApproved;
    if (needsAck && !adultAck) return setError("Please tick the box to confirm you are 18 or over before you start.");
    setError("");
    setBusy(true);
    setWaiting("");
    const attached = files.map((f) => fileIds.get(f)).filter((id): id is string => Boolean(id));
    const mine: Msg = { id: nextId(), role: "user", content: text || "(attached a file)" };
    const reply: Msg = { id: nextId(), role: "assistant", content: "" };
    setMessages((m) => [...m, mine, reply]);
    setDraft("");
    if (viaVoice) {
      voice.setTranscript("");
      voice.setThinking(true);
    }
    setFiles([]);
    setFileIds(new Map());
    spoken.current = 0;
    const controller = new AbortController();
    abort.current = controller;
    let text_ = "";
    let failed = "";
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ text, sessionId, fileIds: attached, adultAck: needsAck ? true : undefined, voice: viaVoice || undefined }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        failed = data?.error ?? ERROR_TEXT.unavailable!;
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (!line) continue;
            const event = JSON.parse(line) as { type: string; sessionId?: string; text?: string; code?: string; position?: number };
            if (event.type === "session" && event.sessionId) setSessionId(event.sessionId);
            else if (event.type === "queued") setWaiting(`You are number ${event.position} in the queue.`);
            else if (event.type === "delta" && event.text) {
              setWaiting("");
              text_ += event.text;
              const now = text_;
              setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, content: now } : x)));
              // A polite announcement a sentence at a time, not every word.
              const end = Math.max(now.lastIndexOf(". "), now.lastIndexOf("? "), now.lastIndexOf("! "), now.lastIndexOf("\n"));
              if (end > spoken.current) {
                setAnnounce(plainText(parseMarkdown(now.slice(spoken.current, end + 1))));
                spoken.current = end + 1;
              }
            } else if (event.type === "error") failed = ERROR_TEXT[event.code ?? ""] ?? ERROR_TEXT.unavailable!;
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") failed = "We lost the connection. Please try again.";
    } finally {
      abort.current = null;
      setBusy(false);
      setWaiting("");
    }
    if (failed) setError(failed);
    if (!text_) setMessages((m) => m.filter((x) => x.id !== reply.id));
    setAnnounce(text_ ? "The answer is ready." : "");
    if (viaVoice) {
      if (text_ && !failed) void voice.speak(text_);
      else voice.setThinking(false);
    }
    void refresh();
  }

  async function copy(m: Msg) {
    try {
      await navigator.clipboard.writeText(plainText(parseMarkdown(m.content)));
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 2000);
    } catch {
      setError("We could not copy that. Please select the text and copy it yourself.");
    }
  }

  if (!status) {
    return (
      <div className={styles.center}>
        <PencilLoader size="md" label="Opening Study Buddy" />
      </div>
    );
  }
  if (!status.open) {
    return (
      <div className={styles.center} role="status">
        <p>Study Buddy is not available right now. Please try again later.</p>
      </div>
    );
  }

  const first = !sessionId && messages.length === 0;
  const thinking = busy && messages.at(-1)?.role === "assistant" && !messages.at(-1)?.content;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Your chats">
        <button type="button" className="button button--primary" onClick={newChat} disabled={busy}>
          <span>New chat</span>
        </button>
        {sessions.length === 0 ? <p className={styles.muted}>No chats yet.</p> : null}
        <ul className={styles.sessions}>
          {sessions.map((s) => (
            <li key={s.id} className={s.id === sessionId ? styles.current : undefined}>
              <button type="button" className={styles.sessionButton} onClick={() => void open(s.id)} aria-current={s.id === sessionId ? "true" : undefined}>
                {s.title || "New chat"}
              </button>
              <button type="button" className={styles.iconButton} onClick={() => void removeChat(s.id)} aria-label={`Delete chat: ${s.title || "New chat"}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div className={styles.privacy}>
          <p>Chats are kept for 30 days, uploads for 7, and you can delete them any time.</p>
          <p>
            <a href="/api/assistant/export">Download my chats</a>
          </p>
          {sessions.length > 0 ? (
            <button type="button" className={styles.linkButton} onClick={() => void removeAll()}>
              Delete all my chats
            </button>
          ) : null}
        </div>
      </aside>

      <section className={styles.main} aria-labelledby="sb-heading">
        <header className={styles.header}>
          <h1 id="sb-heading">Study Buddy</h1>
          <p className={styles.badge}>{AI_LABEL}</p>
        </header>
        <p className={styles.notice}>
          Study Buddy is an AI, not a tutor or a person. It can be wrong. Please do not type your full name, your school or your address.
        </p>

        <div className={styles.log} ref={log} role="log" aria-label="Conversation" aria-live="off" tabIndex={0}>
          {first ? <p className={styles.muted}>Ask about Maths, English, Science or 11+ practice. Study Buddy gives hints first.</p> : null}
          {messages.map((m) => (
            <article key={m.id} className={m.role === "user" ? styles.mine : styles.theirs} aria-label={m.role === "user" ? "You" : "Study Buddy"}>
              <h2 className={styles.who}>{m.role === "user" ? "You" : "Study Buddy"}</h2>
              {m.role === "user" ? <p className={styles.plain}>{m.content}</p> : m.content ? <RenderedAnswer text={m.content} /> : null}
              {m.role === "assistant" && m.content && !(busy && m.id === messages.at(-1)?.id) ? (
                <div className={styles.actions}>
                  <span className={styles.badge}>{AI_LABEL}</span>
                  <button type="button" className={styles.linkButton} onClick={() => void copy(m)}>
                    {copied === m.id ? "Copied" : "Copy"}
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {thinking ? (
            <div className={styles.thinking}>
              <PencilLoader size="sm" label="Study Buddy is thinking" />
              {waiting ? <span>{waiting}</span> : null}
            </div>
          ) : null}
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>

        {first && !status.minorsApproved ? (
          <label className={styles.ack}>
            <input type="checkbox" checked={adultAck} onChange={(e) => setAdultAck(e.target.checked)} />
            <span>{ADULT_ACKNOWLEDGEMENT}</span>
          </label>
        ) : null}

        <div className={styles.composer}>
          <AiInput
            value={draft}
            onValueChange={setDraft}
            files={files}
            onFilesSelected={(picked) => void upload(picked.filter((f) => !files.includes(f)))}
            onFileRemove={(file) => {
              setFiles((current) => current.filter((f) => f !== file));
              setFileIds((current) => {
                const next = new Map(current);
                next.delete(file);
                return next;
              });
            }}
            onSubmit={(text) => void send(text)}
            busy={busy}
            maxLength={status.limits?.maxInputChars}
            maxFiles={status.limits?.files ?? 3}
            error={error}
            voiceState={voice.state}
            onVoiceStart={status.voice ? () => void voice.start() : undefined}
            onVoiceStop={voice.stop}
            onVoiceCancel={voice.cancel}
            transcript={voice.transcript}
            onTranscriptEdit={voice.setTranscript}
            hint="Photos (JPEG or PNG) and PDFs, up to 3 files. Never share personal details."
          />
          {busy ? (
            <button type="button" className="button button--secondary" onClick={() => abort.current?.abort()}>
              <span>Stop</span>
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
