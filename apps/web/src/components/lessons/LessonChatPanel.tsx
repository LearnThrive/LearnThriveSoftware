"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Paperclip, Send, X } from "lucide-react";
import styles from "./LessonChatPanel.module.css";

interface MessageView {
  id: string;
  senderParty: "tutor" | "student" | "admin";
  senderName: string;
  own: boolean;
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
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const day = (date: Date) => date.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const ROLE = { admin: "Admin", tutor: "Tutor", student: "Student" } as const;
/** Ready-made starts for the two things people most need to say before a lesson. They fill the box; nothing is sent until Send is pressed. */
const QUICK = [["Running late", "I'm running about 10 minutes late."], ["Can't make it", "Sorry, I can't make this lesson."]] as const;
const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Chat and file sharing for ONE lesson (docs/LESSON_CHAT.md). It only asks and shows: who may send is decided by the server on every
 * message, and the box below is offered only when the server says this person may send right now. Parents see it read-only, afterwards. Text is shown as
 * text (React escapes it); a file is a short-lived link the server makes for this person.
 */
export function LessonChatPanel({ lessonId, isAdmin = false, sendsAsAdmin = false }: { lessonId: string; isAdmin?: boolean; sendsAsAdmin?: boolean }) {
  const [data, setData] = useState<Listing | null>(null);
  const [problem, setProblem] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLUListElement>(null);

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
  // Only the log scrolls to the newest message: scrollIntoView would drag the whole page down to the chat as well.
  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; }, [count]);

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

  function clearFile() {
    if (fileInput.current) fileInput.current.value = "";
    setFileName("");
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
        clearFile();
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
        <ul ref={logRef} className={styles.log} aria-label="Lesson messages" aria-live="polite" tabIndex={0}>
          {data.messages.length === 0 ? (
            <li className={styles.empty}><MessageCircle size={22} aria-hidden="true" />No messages yet.</li>
          ) : null}
          {data.messages.map((m, index) => {
            const on = day(new Date(m.createdAt));
            const newDay = index === 0 || on !== day(new Date(data.messages[index - 1].createdAt));
            const hidden = Boolean(m.removed) && !m.text && !m.file;
            return (
              <Fragment key={m.id}>
                {newDay ? <li className={styles.day}>{on === day(new Date()) ? "Today" : on}</li> : null}
                <li className={`${styles.item} ${m.own ? styles.own : ""}`}>
                  <span className={styles.meta}>
                    {hidden ? null : <span className={styles.name}>{m.own ? "You" : m.senderName}</span>}
                    {hidden ? null : <span className={`${styles.role} ${m.senderParty === "admin" ? styles.roleAdmin : ""}`}>{ROLE[m.senderParty]}</span>}
                    <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
                  </span>
                  <div className={styles.bubble}>
                    {hidden ? <span className={styles.removed}>Removed by an administrator.</span> : null}
                    {m.text ? <p className={styles.text}>{m.text}</p> : null}
                    {m.file ? (
                      <a className={styles.file} href={m.file.url} target="_blank" rel="noopener noreferrer">
                        <Paperclip size={14} aria-hidden="true" />{m.file.displayName} <span className={styles.fileSize}>{size(m.file.size)}</span>
                      </a>
                    ) : null}
                    {m.removed && !hidden ? <span className={styles.removed}>Removed{m.removed.reason ? `: ${m.removed.reason}` : ""}</span> : null}
                  </div>
                  {isAdmin && !m.removed ? <button type="button" className={styles.remove} aria-label={`Remove the message from ${m.senderName} at ${time(m.createdAt)}`} onClick={() => void remove(m)}>Remove</button> : null}
                </li>
              </Fragment>
            );
          })}
        </ul>
      ) : null}

      {data?.canSend ? (
        <>
          {!sendsAsAdmin ? (
            <div className={styles.quick}>
              {QUICK.map(([label, message]) => <button key={label} type="button" className={styles.chip} onClick={() => { setText(message); document.getElementById(`chat-${lessonId}`)?.focus(); }}>{label}</button>)}
            </div>
          ) : null}
          <form className={styles.composer} onSubmit={(e) => void send(e)}>
            <label className="sr-only" htmlFor={`chat-${lessonId}`}>Message</label>
            <textarea id={`chat-${lessonId}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={sendsAsAdmin ? "Write a message as an administrator" : "Write a message"} />
            <div className={styles.row}>
              <div className={styles.attach}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => fileInput.current?.click()}><Paperclip size={14} aria-hidden="true" /> Photo or PDF</button>
                <input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" hidden onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
                {fileName ? <span className={styles.chosen}>{fileName}<button type="button" className={styles.clear} aria-label="Remove the chosen file" onClick={clearFile}><X size={14} aria-hidden="true" /></button></span> : null}
              </div>
              <button type="submit" className="btn btn--primary btn--sm" disabled={busy || (!text.trim() && !fileName)}><Send size={14} aria-hidden="true" /> Send</button>
            </div>
          </form>
        </>
      ) : data ? (
        <p className={styles.notice}>{data.sendBlockedReason ?? "You can read this chat."}</p>
      ) : null}
      {problem && data ? <p className={styles.error} role="alert">{problem}</p> : null}
    </div>
  );
}
