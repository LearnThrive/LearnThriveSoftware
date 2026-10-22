"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./learner.module.css";

type LinkStatus = "active" | "suspended" | "revoked";
interface Student {
  id: string;
  displayName: string;
  yearGroup: string | null;
  isMinor: boolean;
  accessMode: "none" | "supervised" | "direct";
  learnerStatus: LinkStatus | null;
  invitationOpen: boolean;
  openInvitationId: string | null;
  canHaveOwnLogin: boolean;
  consent: boolean;
}
interface Listing {
  students: Student[];
  consent: { version: string; text: string };
}

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  try {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: response.ok, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    return { ok: false, data: { error: "We could not reach the server. Check your connection and try again." } };
  }
}

const message = (data: Record<string, unknown> | null, fallback: string) => (typeof data?.error === "string" ? data.error : fallback);

/**
 * A guardian's view of their learners (docs/IDENTITY.md): add a student, choose how each gets in (their own login by invitation, or a
 * supervised view under the guardian's own session), say that Study Buddy may be used, suspend or remove a login, and delete (never
 * read) a learner's conversations. Every decision is made by the server for the signed-in guardian; this only asks.
 */
export function LearnersPanel() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [shown, setShown] = useState<{ studentId: string; link: string; expiresAt: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const result = await call("/api/learners", "GET");
    if (result.ok && result.data) setData(result.data as unknown as Listing);
    else setError(message(result.data, "We could not load your learners. Please try again."));
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await call("/api/learners", "GET");
      if (!live) return;
      if (result.ok && result.data) setData(result.data as unknown as Listing);
      else setError(message(result.data, "We could not load your learners. Please try again."));
    })();
    return () => {
      live = false;
    };
  }, []);

  async function act(path: string, method: string, body: unknown, done: string, after?: (data: Record<string, unknown> | null) => void) {
    if (busy.current) return;
    busy.current = true;
    setError("");
    setStatus("");
    const result = await call(path, method, body);
    busy.current = false;
    if (!result.ok) return setError(message(result.data, "That did not work. Please try again."));
    setStatus(done);
    after?.(result.data);
    await load();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await act("/api/learners", "POST", { displayName: String(form.get("displayName") ?? ""), yearGroup: String(form.get("yearGroup") ?? ""), isMinor: form.get("adult") !== "on" }, "Added.", () => setAdding(false));
  }

  if (!data) return error ? <p className={styles.error}>{error}</p> : <p className={styles.status}>Loading…</p>;

  return (
    <div className={styles.wrap}>
      <p className={styles.lead}>
        Add the students you look after. Young learners are used from your own sign-in (the supervised view); older students can be invited to sign in on their own. You decide who can use Study Buddy, and you can
        delete a learner&apos;s conversations but never read them.
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>

      {data.students.length === 0 ? <p className={styles.help}>No students yet.</p> : null}
      <ul className={styles.list}>
        {data.students.map((s) => (
          <li key={s.id} className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.name}>{s.displayName}</h2>
              <span className={styles.year}>{s.yearGroup ?? (s.isMinor ? "Year group not set" : "Adult learner")}</span>
            </div>
            <ul className={styles.badges} aria-label={`${s.displayName}: current state`}>
              {s.learnerStatus ? <li className={styles.badge} data-tone={s.learnerStatus === "active" ? "good" : "warn"}>Own login: {s.learnerStatus}</li> : null}
              {s.accessMode === "supervised" ? <li className={styles.badge} data-tone="good">Supervised view on</li> : null}
              {s.invitationOpen ? <li className={styles.badge}>Invitation waiting</li> : null}
              <li className={styles.badge} data-tone={s.consent ? "good" : "warn"}>{s.consent ? "Study Buddy agreed" : "Study Buddy not agreed"}</li>
            </ul>

            <div className={styles.section}>
              <h3>Study Buddy</h3>
              <label className={styles.check}>
                <input type="checkbox" checked={s.consent} onChange={(e) => void act(`/api/learners/${s.id}/consent`, "POST", { granted: e.target.checked }, e.target.checked ? "Agreed." : "Withdrawn. Study Buddy is closed for this learner.")} />
                <span>I agree that {s.displayName} may use Study Buddy.</span>
              </label>
              <details>
                <summary>What I am agreeing to</summary>
                <p className={styles.help}>{data.consent.text}</p>
              </details>
            </div>

            <div className={styles.section}>
              <h3>How {s.displayName} gets in</h3>
              {s.accessMode !== "direct" ? (
                <>
                  <label className={styles.check}>
                    <input type="checkbox" checked={s.accessMode === "supervised"} onChange={(e) => void act(`/api/learners/${s.id}/access`, "POST", { mode: e.target.checked ? "supervised" : "none" }, e.target.checked ? "Supervised view turned on." : "Supervised view turned off.")} />
                    <span>Allow the supervised view: you sign in, then choose {s.displayName}. No email address needed.</span>
                  </label>
                  {s.accessMode === "supervised" ? (
                    <div className={styles.row}>
                      <button type="button" className="button button--secondary" onClick={() => void act("/api/learner/view", "POST", { studentId: s.id }, "", (d) => { if (typeof d?.next === "string") window.location.assign(d.next); })}>
                        View as {s.displayName}
                      </button>
                      <span className={styles.help}>You will need your password to come back here.</span>
                    </div>
                  ) : null}
                </>
              ) : null}

              {s.learnerStatus === null || s.learnerStatus === "revoked" ? (
                s.canHaveOwnLogin ? (
                  <InviteForm student={s} onInvite={(email) => act(`/api/learners/${s.id}/invite`, "POST", email ? { email } : {}, "Invitation made.", (d) => d && setShown({ studentId: s.id, link: String(d.link), expiresAt: String(d.expiresAt) }))} />
                ) : (
                  <p className={styles.help}>{s.displayName} is too young for a sign-in of their own. Use the supervised view above.</p>
                )
              ) : (
                <div className={styles.row}>
                  {s.learnerStatus === "active" ? (
                    <button type="button" className="button button--secondary" onClick={() => void act(`/api/learners/${s.id}/status`, "POST", { status: "suspended" }, "Login suspended. It stops working at once.")}>
                      Suspend login
                    </button>
                  ) : (
                    <button type="button" className="button button--secondary" onClick={() => void act(`/api/learners/${s.id}/status`, "POST", { status: "active" }, "Login restored.")}>
                      Restore login
                    </button>
                  )}
                  <button type="button" className="button button--secondary" onClick={() => window.confirm(`Remove ${s.displayName}'s login for good? They will no longer be able to sign in.`) && void act(`/api/learners/${s.id}/status`, "POST", { status: "revoked" }, "Login removed.")}>
                    Remove login
                  </button>
                </div>
              )}
              {s.invitationOpen && s.openInvitationId ? (
                <div className={styles.row}>
                  <span className={styles.help}>An invitation is waiting to be used.</span>
                  <button type="button" className="button button--secondary" onClick={() => void act(`/api/learners/invitations/${s.openInvitationId}`, "DELETE", undefined, "Invitation cancelled.", () => setShown(null))}>
                    Cancel invitation
                  </button>
                </div>
              ) : null}
              {shown && shown.studentId === s.id ? (
                <div className={styles.link} role="status">
                  <strong>Give {s.displayName} this link.</strong>
                  <code>{shown.link}</code>
                  <span className={styles.help}>It can be used once and stops working on {new Date(shown.expiresAt).toLocaleString("en-GB")}. We do not email it and cannot show it again.</span>
                  <div className={styles.row}>
                    <button type="button" className="button button--secondary" onClick={() => void navigator.clipboard?.writeText(shown.link).then(() => setStatus("Link copied."))}>
                      Copy link
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className={styles.section}>
              <h3>Conversations</h3>
              <p className={styles.help}>{s.displayName}&apos;s conversations with Study Buddy are private to them. You can delete them all, but not read them.</p>
              <div className={styles.row}>
                <button type="button" className={`button button--secondary ${styles.danger}`} onClick={() => window.confirm(`Delete all of ${s.displayName}'s Study Buddy conversations? This cannot be undone.`) && void act(`/api/learners/${s.id}/chats/delete`, "POST", {}, "Conversations deleted.")}>
                  Delete conversations
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <form className={styles.form} onSubmit={add} aria-label="Add a student">
          <label className={styles.field}>
            <span>First name or nickname</span>
            <input name="displayName" required maxLength={80} autoComplete="off" />
          </label>
          <label className={styles.field}>
            <span>Year group (optional)</span>
            <input name="yearGroup" maxLength={40} placeholder="For example Year 9" autoComplete="off" />
          </label>
          <label className={styles.check}>
            <input type="checkbox" name="adult" />
            <span>This learner is 18 or over.</span>
          </label>
          <div className={styles.row}>
            <button type="submit" className="button button--primary">
              Add student
            </button>
            <button type="button" className="button button--secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.row}>
          <button type="button" className="button button--primary" onClick={() => setAdding(true)}>
            Add a student
          </button>
        </div>
      )}
    </div>
  );
}

function InviteForm({ student, onInvite }: { student: Student; onInvite: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  return (
    <div className={styles.row}>
      <label className={styles.field}>
        <span>{student.displayName}&apos;s email address (optional)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="So only that address can accept" />
      </label>
      <button type="button" className="button button--secondary" onClick={() => void onInvite(email.trim())}>
        Invite to sign in
      </button>
    </div>
  );
}
