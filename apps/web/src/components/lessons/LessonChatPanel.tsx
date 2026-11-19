"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Paperclip, Send } from "lucide-react";
import styles from "./LessonChatPanel.module.css";

interface MessageView {
  id: string;
  senderParty: "tutor" | "student";
  senderName: string;
  text: string;
  file: { id: string; displayName: string; contentType: string; size: number; url: string } | null;
  createdAt: string;
  removed: null | { at: string; by?: string; reason?: string };
}
interface Listing {
  messages: MessageView[];
  canSend: boolean;
  sendBlockedReason: string | null;
  readerKind: string;
}

const POLL_MS = 5000;
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit" });
const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Chat and file sharing for ONE lesson (docs/LESSON_CHAT.md). It only asks and shows: who may send, and when, is decided by the server on every
 * message, and the box below is offered only when the server says this person may send right now. Parents see it read-only, afterwards. Text is shown as
 * text (React escapes it); a file is a short-lived link the server makes for this person.
 */
export function LessonChatPanel({ lessonId, isAdmin = false }: { lessonId: string; isAdmin?: boolean }) {
  const [data, setData] = useState<Listing | null>(null);
  const [problem, setProblem] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLLIElement>(null);

  /** Asks the server for the lesson's messages. Sets no state itself: the caller applies the answer. */
  const fetchListing = useCallback(async (): Promise<{ ok: true; listing: Listing } | { ok: false; error: string }> => {
    try {
      const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/messages`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as (Listing & { error?: string }) | null;
      if (response.ok && body) return { ok: true, listing: body };
      return { ok: false, error: body?.error ?? "The chat could not be loaded." };
    } catch {
      return { ok: false, error: "We could not reach the server. Check your connection." };
    }
  }, [lessonId]);

  const apply = useCallback((result: Awaited<ReturnType<typeof fetchListing>>) => {
    if (result.ok) {
      setData(result.listing);
      setProblem("");
    } else {
      setData(null);
      setProblem(result.error);
    }
  }, []);

  const load = useCallback(async () => apply(await fetchListing()), [apply, fetchListing]);

  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const result = await fetchListing();
      if (live) apply(result);
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [apply, fetchListing]);

  const count = data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [count]);

  async function post(init: RequestInit): Promise<boolean> {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/messages`, { method: "POST", ...init });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) setProblem(body?.error ?? "That could not be sent.");
      else await load();
      return response.ok;
    } catch {
      setProblem("We could not reach the server. Check your connection.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (file) {
      const form = new FormData();
      form.set("file", file);
      if (text.trim()) form.set("caption", text.trim());
      if (await post({ body: form })) {
        setText("");
        if (fileInput.current) fileInput.current.value = "";
      }
    } else if (text.trim()) {
      if (await post({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim() }) })) setText("");
    }
  }

  async function remove(message: MessageView) {
    const reason = window.prompt("Why is this being removed? (This is recorded.)");
    if (!reason?.trim()) return;
    const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/messages/${encodeURIComponent(message.id)}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!response.ok) setProblem(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? "That could not be removed.");
    else await load();
  }

  return (
    <div className={styles.wrap}>
      {problem && !data ? <p className={styles.notice} role="status">{problem}</p> : null}
      {!problem && !data ? <p className={styles.notice} role="status">Loading messages…</p> : null}
      {data ? (
        <ul className={styles.log} aria-label="Lesson messages" aria-live="polite">
          {data.messages.length === 0 ? <li className={styles.notice}>No messages yet.</li> : null}
          {data.messages.map((m) => (
            <li key={m.id} className={`${styles.message} ${m.senderParty === "tutor" ? "" : styles.mine}`}>
              {m.removed && !m.text && !m.file ? (
                <span className={styles.removed}>Removed by an administrator.</span>
              ) : (
                <>
                  <span className={styles.meta}>{m.senderName} · {m.senderParty === "tutor" ? "tutor" : "student"} · {time(m.createdAt)}</span>
                  {m.text ? <p className={styles.text}>{m.text}</p> : null}
                  {m.file ? (
                    <a className={styles.file} href={m.file.url} target="_blank" rel="noopener noreferrer">
                      <Paperclip size={14} aria-hidden="true" />{m.file.displayName} <span className={styles.meta}>({size(m.file.size)})</span>
                    </a>
                  ) : null}
                  {m.removed ? <span className={styles.removed}>Removed{m.removed.reason ? `: ${m.removed.reason}` : ""}</span> : null}
                </>
              )}
              {isAdmin && !m.removed ? <button type="button" className="btn btn--secondary btn--sm" onClick={() => void remove(m)}>Remove</button> : null}
            </li>
          ))}
          <li ref={endRef} aria-hidden="true" />
        </ul>
      ) : null}

      {data?.canSend ? (
        <form className={styles.composer} onSubmit={(e) => void send(e)}>
          <label className="sr-only" htmlFor={`chat-${lessonId}`}>Message</label>
          <textarea id={`chat-${lessonId}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Write a message" />
          <div className={styles.row}>
            <label className="btn btn--secondary btn--sm">
              <Paperclip size={14} aria-hidden="true" /> Attach a photo or PDF
              <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" hidden />
            </label>
            <button type="submit" className="btn btn--primary btn--sm" disabled={busy}><Send size={14} aria-hidden="true" /> Send</button>
          </div>
        </form>
      ) : data ? (
        <p className={styles.notice}>{data.sendBlockedReason ?? "You can read this chat."}</p>
      ) : null}
      {problem && data ? <p className={styles.error} role="alert">{problem}</p> : null}
    </div>
  );
}
