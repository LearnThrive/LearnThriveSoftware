"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  Camera,
  Check,
  FileCheck2,
  FileText,
  MessagesSquare,
  Mic,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { AiInput, FilePreview } from "@/components/ui/AiInput";
import { PencilLoader } from "@/components/ui/PencilLoader";
import {
  SidebarSection,
  useMemberSidebar,
} from "@/components/shell/SidebarSlot";
import { ADULT_ACKNOWLEDGEMENT } from "@/lib/assistant/prompt";
import { parseMarkdown, plainText } from "@/lib/assistant/markdown";
import { RenderedAnswer } from "./RenderedAnswer";
import { useVoice, type Speaker } from "./useVoice";
import { VoicePanel } from "./VoicePanel";
import { PaperTutor } from "./PaperTutor";
import { EffortPicker, ModelPicker, type ModelChoice } from "./ModelPicker";
import { ActivityPanel, hasNotableWork, type ActivityView, type PanelStep } from "./ActivityPanel";
import { settle, withStep, withoutWaiting } from "./activityView";
import type { ActivityStep } from "@/lib/assistant/activity";
import styles from "./study-buddy.module.css";

/** A photo or document that went with a message. It is fetched from /api/assistant/files/:id; a reopened chat does not know its name. */
interface MsgFile {
  id: string;
  name?: string;
  contentType: string;
  bytes?: number;
}
interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  files?: MsgFile[];
  /** Developer view only: the model the server says wrote this answer ("Step 5 Preview"). Never set from the picker's own state. */
  model?: string;
  /** What was done for this answer, from the server's own steps (live), or kept with it (a reopened chat). Never part of the answer's text. */
  activity?: ActivityView;
}

/** A message as the server sends a reopened chat: its activity is a plain list of finished steps, and how the turn ended if it did not complete. */
type ApiMsg = Omit<Msg, "activity"> & { activity?: ActivityStep[]; activityOutcome?: "failed" | "stopped" };
const fromApi = ({ activityOutcome, ...m }: ApiMsg): Msg => ({ ...m, activity: m.activity?.length ? { steps: m.activity, phase: activityOutcome ?? "done" } : undefined });

/** A short phrase for a screen reader when a new KIND of work begins (not every step: the panel itself is not a live region). */
const SAYS: Partial<Record<PanelStep["kind"], string>> = { document: "Reading what you sent.", search: "Searching the web for sources.", read: "Reading sources.", verify: "Checking the answer against the sources.", calculate: "Checking the working by calculation.", repair: "Correcting the draft." };

const fileUrl = (file: MsgFile) => `/api/assistant/files/${file.id}`;
const isPicture = (file: MsgFile) => file.contentType.startsWith("image/");
const fileLabel = (file: MsgFile) => file.name ?? (isPicture(file) ? "Photo" : "PDF document");
/** The words the server stores for a message with only files in it: not something the student wrote, so it is not shown. */
const FILE_ONLY_TEXT = /^\(attached (a file|\d+ files)\)$/;
interface SessionItem {
  id: string;
  title: string;
}
interface Status {
  open: boolean;
  reason?: string | null;
  /** The speech service is there: the microphone button may appear. */
  voice?: boolean;
  /** The Paper Tutor is switched on: an attached paper can be solved. */
  paperTutor?: boolean;
  paperMarker?: boolean;
  minorsApproved?: boolean;
  limits?: {
    dailyMessages: number;
    perMinute: number;
    maxInputChars: number;
    files: number;
  };
  /** The developer model picker: present only for an account the server lets choose. */
  models?: {
    choices: ModelChoice[];
    default: string | null;
    /** An opaque per-account key, so a shared browser never carries one person's choice to another. */
    scope: string;
    /** Whether uploads may be sent to the hosted models. */
    uploads: boolean;
  };
}

const PICKED_KEY = (scope: string) => `learnthrive:sb-model:${scope}`;
// The reasoning effort is remembered the same way, under its own key: a model's levels differ, so it is re-resolved whenever the model changes.
const EFFORT_KEY = (scope: string) => `learnthrive:sb-effort:${scope}`;

/** The reasoning efforts a model's picker offers (empty: that model takes no effort setting, so no effort picker is shown). */
const effortsFor = (choices: readonly ModelChoice[], id: string | null) => choices.find((c) => c.id === id)?.efforts ?? [];

/** A picked model's failure, said with its name and the cause the server reported, so the developer knows what to change. */
const DETAIL_TEXT: Record<string, string> = {
  unauthorised: "the NVIDIA key was refused",
  model_missing: "NVIDIA does not list this model for the key in use",
  rate_limited: "NVIDIA is limiting requests",
  unreachable: "NVIDIA could not be reached",
  timeout: "it took too long",
  stream_broken: "the connection broke while it was answering",
  stream_error: "NVIDIA reported an error part-way through",
  reasoning_exhausted: "it spent its whole allowance reasoning",
  reasoning_only: "it reasoned but wrote no answer",
  no_content: "it returned nothing",
  too_large: "the request was too large for it",
};

function pickedModelError(event: { code?: string; model?: string | null; detail?: string; retryAfterSeconds?: number }): string | null {
  const who = event.model || "The chosen model";
  const why = event.detail ? (DETAIL_TEXT[event.detail] ?? (event.detail.startsWith("http_") ? `NVIDIA answered with HTTP ${event.detail.slice(5)}` : event.detail.replace(/_/g, " "))) : null;
  switch (event.code) {
    case "model_rate_limited":
      return `${who} is being rate limited by NVIDIA. Wait ${event.retryAfterSeconds ? `${event.retryAfterSeconds} seconds` : "a moment"} and try again, or choose another model.`;
    case "model_unavailable":
      return `${who} could not answer${why ? ` (${why})` : ""}. No other model answered in its place. Try again, or choose another model.`;
    case "no_answer":
      return `${who} finished without an answer${why ? ` (${why})` : ""}. Try again, or ask a narrower question.`;
    case "model_budget":
      return "Today's allowance for the trial models has been used. The local model is still available if it is listed.";
    case "uploads_not_sent":
      return `Files are not sent to ${event.model || "the trial models"}. Remove the file, or switch to the local model to use it.`;
    default:
      return null;
  }
}

/** The connection closed before the answer's closing event: said the same way as a lost connection. */
const INTERRUPTED = "We lost the connection before the answer was finished. Please try again.";

const ERROR_TEXT: Record<string, string> = {
  rate_limited_minute: "You are asking quickly. Please wait a moment.",
  rate_limited_day:
    "You have used today's questions. LearnThrive AI will be back tomorrow.",
  busy: "LearnThrive AI is busy right now. Please try again in a moment.",
  unavailable:
    "LearnThrive AI could not answer just now. Please try again shortly.",
  timeout: "That took too long. LearnThrive AI may still have been warming up, so please try again. A photo can take a minute or two the first time.",
  budget: "LearnThrive AI has reached its limit for today.",
  vision_unavailable:
    "LearnThrive AI cannot look at photos right now. You can type the question instead.",
  too_long: "That message is too long. Please shorten it.",
  empty: "Please type a question first.",
  no_chat: "That chat is no longer there. Please start a new one.",
  no_answer: "LearnThrive AI finished without an answer. Please try again, or ask a narrower question.",
};

const SUGGESTIONS = [
  "Explain how to factorise a quadratic",
  "Check my working on this photo",
  "Help me revise photosynthesis",
  "Give me a practice question on fractions",
];

let counter = 0;
const nextId = () => `local-${(counter += 1)}`;

/**
 * LearnThrive AI. The chats live in the member sidebar (one navigation, not a second column); the page is the conversation: a short
 * header, ONE scrolling conversation, and the box, which stays on screen. Answers stream in as newline-delimited JSON events; Stop
 * ends one (what was shown is kept). Everything an answer shows goes through the safe Markdown renderer, maths is drawn by KaTeX
 * loaded only when needed, and the AI and privacy notice is said once, beside the box, not stamped on every answer. Screen readers
 * hear the answer a sentence at a time. Nothing is kept in the browser, except, for a developer who may choose the model, the last choice
 * (under an opaque per-account key).
 */
export function StudyBuddy() {
  const [status, setStatus] = useState<Status | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [files, setFilesState] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState("");
  const [error, setError] = useState("");
  const [adultAck, setAdultAck] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [reading, setReading] = useState("");
  // The photo or document being looked at, from a message already sent.
  const [lookingAt, setLookingAt] = useState<MsgFile | null>(null);
  // Files picked and still being added (uploaded and read), shown in the box as they go so nothing sent is ever unseen.
  const [adding, setAdding] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [offline, setOffline] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  // The developer's chosen model (only when the server offers a choice). It stays for every question until changed, and is kept in this
  // browser under the account's own opaque key.
  const [picked, setPicked] = useState<string | null>(null);
  // "Auto" until the developer chooses: the question then decides, exactly as it did before the picker existed.
  const [effort, setEffort] = useState<string>("auto");
  const [paper, setPaper] = useState<{
    file: File;
    fileId: string;
    sessionId: string;
    kind: "solve" | "mark";
    scheme?: { file: File; fileId: string };
    blank?: { file: File; fileId: string };
  } | null>(null);
  // Marking: what each other PDF in the box is (a mark scheme, or the blank question paper). Nothing is assumed: it is used only if the student says so.
  const [roles, setRoles] = useState<Record<string, "scheme" | "blank">>({});
  const abort = useRef<AbortController | null>(null);
  // Kept in refs as well as state: a question sent while a file is still uploading waits for it, and must then use the chat and the
  // files as they are NOW, not as they were when the button was pressed.
  const sessionRef = useRef<string | null>(null);
  const filesRef = useRef<File[]>([]);
  const fileIdsRef = useRef<Map<File, string>>(new Map());
  const uploading = useRef<Promise<void> | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const stickToLatest = useRef(true);
  const spoken = useRef(0);
  // A spoken question is sent the moment it is finished (useVoice decides when); sendRef reaches the send() defined below.
  const sendRef = useRef<
    (text: string, options?: { voice?: boolean }) => Promise<void>
  >(async () => {});
  const voice = useVoice({
    onUtterance: (text) => void sendRef.current(text, { voice: true }),
  });
  const sidebar = useMemberSidebar();
  // How wide the page is: with room, the chats sit beside the conversation (and a tools column on the far side) instead of squeezing into the
  // shell's sidebar. Measured on the page, not the window, because the shell's own sidebar may be open or collapsed.
  // A callback ref held in state: the workspace only exists once the page has loaded (earlier screens are the loading and closed states).
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  useLayoutEffect(() => {
    const el = workspace;
    if (!el) return;
    const measure = () => setPageWidth(el.getBoundingClientRect().width / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspace]);
  const roomy = pageWidth >= 56;
  const wide = pageWidth >= 80;

  const setSessionId = useCallback((id: string | null) => {
    sessionRef.current = id;
    setSessionIdState(id);
  }, []);
  const setFiles = useCallback((next: File[]) => {
    filesRef.current = next;
    setFilesState(next);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/assistant/sessions", {
      cache: "no-store",
    }).catch(() => null);
    if (response?.ok)
      setSessions(
        ((await response.json()) as { sessions: SessionItem[] }).sessions,
      );
  }, []);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/assistant/status", {
        cache: "no-store",
      }).catch(() => null);
      const loaded: Status = response?.ok
        ? ((await response.json()) as Status)
        : { open: false, reason: "unreachable" };
      setStatus(loaded);
      if (loaded.models) {
        let saved: string | null = null;
        try {
          saved = window.localStorage.getItem(PICKED_KEY(loaded.models.scope));
        } catch {
          saved = null;
        }
        const choices = loaded.models.choices;
        const next = choices.some((c) => c.id === saved) ? saved : (loaded.models.default ?? choices[0]?.id ?? null);
        setPicked(next);
        let savedEffort: string | null = null;
        try {
          savedEffort = window.localStorage.getItem(EFFORT_KEY(loaded.models.scope));
        } catch {
          savedEffort = null;
        }
        setEffort(effortsFor(choices, next).some((e) => e.id === savedEffort) ? (savedEffort as string) : "auto");
      }
      void refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Follow the answer as it streams, unless the student has scrolled up to read something earlier.
  useEffect(() => {
    if (stickToLatest.current)
      log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages]);

  function onLogScroll() {
    const el = log.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    stickToLatest.current = near;
    setAtLatest(near);
  }

  function jumpToLatest() {
    stickToLatest.current = true;
    setAtLatest(true);
    log.current?.scrollTo({
      top: log.current.scrollHeight,
      behavior: "smooth",
    });
  }

  function clearAttachments() {
    setFiles([]);
    fileIdsRef.current = new Map();
  }

  function choose(id: string) {
    setPicked(id);
    // A model's levels are its own: an effort the new model does not offer goes back to Auto rather than being silently changed.
    const next = effortsFor(status?.models?.choices ?? [], id).some((e) => e.id === effort) ? effort : "auto";
    setEffort(next);
    const scope = status?.models?.scope;
    if (!scope) return;
    try {
      window.localStorage.setItem(PICKED_KEY(scope), id);
      window.localStorage.setItem(EFFORT_KEY(scope), next);
    } catch {
      // Not kept in this browser: it still applies for this visit.
    }
  }

  function chooseEffort(id: string) {
    setEffort(id);
    const scope = status?.models?.scope;
    if (!scope) return;
    try {
      window.localStorage.setItem(EFFORT_KEY(scope), id);
    } catch {
      // Not kept in this browser: it still applies for this visit.
    }
  }

  // Leaving the chat with files still in the box (a new chat, or another one): they are not going to be sent, so release them.
  function discardAttachments() {
    for (const file of filesRef.current) forgetOnServer(fileIdsRef.current.get(file));
    clearAttachments();
  }

  async function open(id: string) {
    if (busy) return;
    sidebar.closeDrawer();
    const response = await fetch(`/api/assistant/sessions/${id}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) return setError("We could not open that chat.");
    const data = (await response.json()) as { messages: ApiMsg[] };
    setSessionId(id);
    setMessages(data.messages.map(fromApi));
    setError("");
    discardAttachments();
    stickToLatest.current = true;
  }

  // The Paper Tutor posted its summary into the chat, with the paper attached to it: show it, and take the paper out of the box.
  async function paperFinished(file: File, sid: string, extras: File[] = []) {
    if (file && filesRef.current.includes(file)) removeFile(file);
    for (const extra of extras) if (filesRef.current.includes(extra)) removeFile(extra);
    if (sessionRef.current !== sid) return;
    const response = await fetch(`/api/assistant/sessions/${sid}`, {
      cache: "no-store",
    }).catch(() => null);
    if (response?.ok)
      setMessages(((await response.json()) as { messages: ApiMsg[] }).messages.map(fromApi));
    void refresh();
  }

  function newChat() {
    if (busy) return;
    sidebar.closeDrawer();
    setSessionId(null);
    setMessages([]);
    discardAttachments();
    setError("");
  }

  async function removeChat(id: string) {
    if (!window.confirm("Delete this chat? It is removed for good.")) return;
    const response = await fetch(`/api/assistant/sessions/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (response?.ok) {
      if (id === sessionRef.current) newChat();
      void refresh();
    } else setError("We could not delete that chat.");
  }

  async function removeAll() {
    if (
      !window.confirm(
        "Delete all your LearnThrive AI chats? They are removed for good.",
      )
    )
      return;
    const response = await fetch("/api/assistant/sessions", {
      method: "DELETE",
    }).catch(() => null);
    if (response?.ok) {
      newChat();
      void refresh();
    } else setError("We could not delete your chats.");
  }

  async function saveTitle() {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return setRenaming(null);
    const response = await fetch(`/api/assistant/sessions/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (response?.ok) {
      setRenaming(null);
      void refresh();
    } else setError(data?.error ?? "We could not rename that chat.");
  }

  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") void saveTitle();
    if (event.key === "Escape") setRenaming(null);
  }

  // Files are uploaded (and read) one after another. The first upload of a new chat creates the chat; later files must go to the
  // same one, so the id is taken from the ref, which the first upload has already set.
  function upload(picked: File[]) {
    setError("");
    setAdding((names) => [...names, ...picked.map((f) => f.name)]);
    const run = async () => {
      for (const file of picked) {
        setReading(file.name);
        const form = new FormData();
        form.set("file", file);
        if (sessionRef.current) form.set("sessionId", sessionRef.current);
        const response = await fetch("/api/assistant/files", {
          method: "POST",
          body: form,
        }).catch(() => null);
        const data = (await response?.json().catch(() => null)) as {
          fileId?: string;
          sessionId?: string;
          error?: string;
        } | null;
        if (response?.ok && data?.fileId) {
          if (data.sessionId && !sessionRef.current)
            setSessionId(data.sessionId);
          fileIdsRef.current = new Map(fileIdsRef.current).set(
            file,
            data.fileId,
          );
          setFiles([...filesRef.current, file]);
        } else
          setError(
            `${file.name}: ${data?.error ?? (response ? "We could not add that file." : "We lost the connection while sending that file.")}`,
          );
        setAdding((names) => {
          const at = names.indexOf(file.name);
          return at < 0 ? names : names.filter((_, i) => i !== at);
        });
      }
      setReading("");
    };
    const next = (uploading.current ?? Promise.resolve()).then(run);
    uploading.current = next;
    void next.then(() => {
      if (uploading.current === next) uploading.current = null;
    });
  }

  // Taking a file out of the box also removes it from the chat on the server: it was uploaded when it was picked, and until it is
  // sent it counts toward the three allowed. Best effort: if the call fails the file is simply left to expire with the chat.
  function forgetOnServer(fileId: string | undefined) {
    if (fileId) void fetch(`/api/assistant/files/${fileId}`, { method: "DELETE" }).catch(() => {});
  }

  function removeFile(file: File) {
    setFiles(filesRef.current.filter((f) => f !== file));
    const next = new Map(fileIdsRef.current);
    forgetOnServer(next.get(file));
    next.delete(file);
    fileIdsRef.current = next;
    setError("");
  }

  async function send(text: string, options: { voice?: boolean } = {}) {
    // A question that came from the microphone is answered in short, speakable wording and read aloud; a typed one is not.
    const viaVoice = Boolean(options.voice && status?.voice);
    if (busy) {
      if (viaVoice) voice.answerFinished(false);
      return;
    }
    if (uploading.current) {
      setWaiting("Waiting for your file to finish uploading…");
      await uploading.current;
      setWaiting("");
    }
    const sid = sessionRef.current;
    const needsAck = !sid && !status?.minorsApproved;
    if (needsAck && !adultAck) {
      if (viaVoice) voice.answerFinished(false);
      return setError(
        "Please tick the box to confirm you are 18 or over before you start.",
      );
    }
    const attached = filesRef.current
      .map((f) => fileIdsRef.current.get(f))
      .filter((id): id is string => Boolean(id));
    if (!text && attached.length === 0) return;
    setError("");
    setBusy(true);
    setWaiting("");
    const carried: MsgFile[] = filesRef.current.flatMap((f) => {
      const id = fileIdsRef.current.get(f);
      return id ? [{ id, name: f.name, contentType: f.type || "application/octet-stream", bytes: f.size }] : [];
    });
    const mine: Msg = {
      id: nextId(),
      role: "user",
      content: text,
      files: carried.length > 0 ? carried : undefined,
    };
    const reply: Msg = { id: nextId(), role: "assistant", content: "", activity: { steps: [], phase: "running" } };
    // The panel in the answer is the ONE place progress is shown. Every update goes through here, to this question's own message.
    const patchActivity = (change: (view: ActivityView) => ActivityView) => setMessages((m) => m.map((x) => (x.id === reply.id && x.activity ? { ...x, activity: change(x.activity) } : x)));
    const announcedKinds = new Set<string>();
    let textBegan = false;
    setMessages((m) => [...m, mine, reply]);
    setDraft("");
    stickToLatest.current = true;
    const speech: { speaker: Speaker | null } = { speaker: null };
    if (viaVoice) speech.speaker = voice.beginSpeaking();
    const sentFiles = { files: filesRef.current, ids: fileIdsRef.current };
    let refusedUpFront = false;
    clearAttachments();
    spoken.current = 0;
    const controller = new AbortController();
    abort.current = controller;
    let answer = "";
    let failed = "";
    /** The server's closing event (`done` or `error`) arrived. Without it the answer is incomplete. */
    let ended = false;
    // Fixed for this question: the picker is disabled until the answer ends, so nothing changes the model part-way through one.
    const model = status?.models ? picked : null;
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          sessionId: sid,
          fileIds: attached,
          adultAck: needsAck ? true : undefined,
          voice: viaVoice || undefined,
          model: model ?? undefined,
          // Only with a picked model, and only when the developer chose one: "Auto" leaves it to the question, on the server.
          effort: model && effort !== "auto" ? effort : undefined,
        }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        failed = data?.error ?? ERROR_TEXT.unavailable!;
        refusedUpFront = true;
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            // A stream that ends without its closing event (`done` or `error`) was cut off, however cleanly the connection closed: the answer
            // is not complete and the panel must not say it was.
            if (!ended && !controller.signal.aborted) failed = INTERRUPTED;
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          for (
            let at = buffer.indexOf("\n");
            at >= 0;
            at = buffer.indexOf("\n")
          ) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (!line) continue;
            const event = JSON.parse(line) as {
              type: string;
              sessionId?: string;
              text?: string;
              code?: string;
              position?: number;
              /** An honest processing state, only when the server has evidence for it. */
              state?: "preparing" | "reading" | "researching" | "verifying" | "thinking";
              /** One real step of the work being done (activity.ts). */
              step?: ActivityStep;
              /** A held answer (verified, advanced) arrives once, whole, after every check: it replaces, it is not appended. */
              whole?: boolean;
              /** Developer view: who answered (done) or who failed (error), as the server reports it. */
              model?: string | null;
              detail?: string;
              retryAfterSeconds?: number;
            };
            if (event.type === "done" || event.type === "error") ended = true;
            if (event.type === "session" && event.sessionId)
              setSessionId(event.sessionId);
            else if (event.type === "queued")
              patchActivity((v) => withStep(v, { id: "ui-queue", kind: "queue", state: "running", label: "Waiting in the queue", detail: `You are number ${event.position}` }));
            else if (event.type === "status") {
              // Only the model loading is shown from here; reading, researching, checking and thinking arrive as real steps.
              if (event.state === "preparing") patchActivity((v) => withStep(v, { id: "ui-prepare", kind: "prepare", state: "running", label: "Getting the model ready", detail: "The first answer after a start can take a moment" }));
            } else if (event.type === "activity" && event.step) {
              const step = event.step;
              patchActivity((v) => withStep(v, step));
              const phrase = SAYS[step.kind];
              if (phrase && step.state === "running" && !announcedKinds.has(step.kind)) {
                announcedKinds.add(step.kind);
                setAnnounce(phrase);
              }
            } else if (event.type === "delta" && event.text) {
              if (!textBegan) {
                textBegan = true;
                patchActivity(withoutWaiting);
              }
              answer = event.whole ? event.text : answer + event.text;
              const now = answer;
              setMessages((m) =>
                m.map((x) => (x.id === reply.id ? { ...x, content: now } : x)),
              );
              speech.speaker?.push(now);
              // A polite announcement a sentence at a time, not every word. A whole answer is announced once, when it is ready (below).
              const end = event.whole
                ? now.length
                : Math.max(
                    now.lastIndexOf(". "),
                    now.lastIndexOf("? "),
                    now.lastIndexOf("! "),
                    now.lastIndexOf("\n"),
                  );
              if (end > spoken.current) {
                if (!event.whole)
                  setAnnounce(
                    plainText(parseMarkdown(now.slice(spoken.current, end + 1))),
                  );
                spoken.current = end + 1;
              }
            } else if (event.type === "done" && event.model) {
              const by = event.model;
              setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, model: by } : x)));
            } else if (event.type === "error") {
              failed = pickedModelError(event) ?? ERROR_TEXT[event.code ?? ""] ?? ERROR_TEXT.unavailable!;
              // Part of an answer arrived before the failure: it is still labelled with the model that wrote it.
              if (event.model && answer) {
                const by = event.model;
                setMessages((m) => m.map((x) => (x.id === reply.id ? { ...x, model: by } : x)));
              }
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        failed = "We lost the connection. Please try again.";
    } finally {
      abort.current = null;
      setBusy(false);
      setWaiting("");
    }
    // The turn is over, however it ended: the panel's last state, with no step left running and no waiting step left over.
    patchActivity((v) => settle(v, controller.signal.aborted ? "stopped" : failed ? "failed" : "done"));
    if (failed) setError(failed);
    // Refused before anything was sent (a limit, a missing tick): the files are still the student's to send, so put them, and the
    // words, back in the box instead of leaving them uploaded but invisible.
    if (refusedUpFront && sentFiles.files.length > 0 && filesRef.current.length === 0) {
      setFiles(sentFiles.files);
      fileIdsRef.current = sentFiles.ids;
      setDraft((d) => d || text);
    }
    if (!answer) setMessages((m) => m.filter((x) => x.id !== reply.id));
    setAnnounce(answer ? "The answer is ready." : "");
    // Stop is silence; a failure speaks nothing more; a finished answer has its last sentences read.
    if (speech.speaker) {
      if (answer && !failed && !controller.signal.aborted)
        speech.speaker.end(answer);
      else speech.speaker.cancel();
    }
    if (viaVoice)
      voice.answerFinished(
        Boolean(answer) && !failed && !controller.signal.aborted,
      );
    void refresh();
  }
  useEffect(() => {
    sendRef.current = send;
  });

  async function copy(m: Msg) {
    try {
      // In the developer view the copy says which model wrote it, so answers compared elsewhere keep their source.
      await navigator.clipboard.writeText(`${m.model ? `[Answered by ${m.model}]\n\n` : ""}${plainText(parseMarkdown(m.content))}`);
      setCopied(m.id);
      setTimeout(() => setCopied((c) => (c === m.id ? null : c)), 2000);
    } catch {
      setError(
        "We could not copy that. Please select the text and copy it yourself.",
      );
    }
  }

  if (!status) {
    return (
      <div className={styles.center}>
        <PencilLoader size="md" label="Opening LearnThrive AI" />
      </div>
    );
  }
  if (!status.open) {
    return (
      <div className={styles.center} role="status">
        <div>
          <h1 className={styles.centerTitle}>LearnThrive AI</h1>
          <p>LearnThrive AI is not available right now. Please try again later.</p>
        </div>
      </div>
    );
  }

  const first = !sessionId && messages.length === 0;
  const currentTitle =
    sessions.find((s) => s.id === sessionId)?.title ||
    (sessionId ? "This chat" : "New chat");
  // The paper to offer the Paper Tutor for: the first PDF or photo in the box (a file is only listed once it has uploaded).
  const solvable = status.paperTutor
    ? files.find(
        (f) => f.type === "application/pdf" || f.type.startsWith("image/"),
      )
    : undefined;
  // Other PDFs in the box: possibly the mark scheme, or the blank question paper, for a paper being checked.
  const extraPdfs =
    solvable && status.paperMarker
      ? files.filter(
          (f) => f !== solvable && f.type === "application/pdf" && fileIdsRef.current.has(f),
        )
      : [];
  const roleKey = (f: File) => `${f.name}:${f.size}`;
  const withRole = (role: "scheme" | "blank") => extraPdfs.find((f) => roles[roleKey(f)] === role);
  const shown = query.trim()
    ? sessions.filter((s) =>
        (s.title || "New chat")
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : sessions;

  const historyPanel = (
        <section className={styles.chats} aria-label="Your chats">
          <button
            type="button"
            className={styles.newChat}
            onClick={newChat}
            disabled={busy}
          >
            <Plus size={16} aria-hidden="true" />
            <span>New chat</span>
          </button>
          {sessions.length > 0 ? (
            <label className={styles.search}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search your chats</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
              />
            </label>
          ) : null}
          <h2 className={styles.chatsHeading}>Your chats</h2>
          {sessions.length === 0 ? (
            <p className={styles.chatsEmpty}>No chats yet.</p>
          ) : null}
          {sessions.length > 0 && shown.length === 0 ? (
            <p className={styles.chatsEmpty}>No chats match “{query}”.</p>
          ) : null}
          <ul className={styles.sessions}>
            {shown.map((s) => {
              const title = s.title || "New chat";
              const isCurrent = s.id === sessionId;
              return (
                <li
                  key={s.id}
                  className={isCurrent ? styles.current : undefined}
                >
                  {renaming?.id === s.id ? (
                    <div className={styles.renameRow}>
                      <label className="sr-only" htmlFor={`rename-${s.id}`}>
                        New title for {title}
                      </label>
                      <input
                        id={`rename-${s.id}`}
                        className={styles.renameInput}
                        value={renaming.title}
                        maxLength={120}
                        autoFocus
                        onChange={(e) =>
                          setRenaming({ id: s.id, title: e.target.value })
                        }
                        onKeyDown={onRenameKey}
                      />
                      <button
                        type="button"
                        className={styles.rowIcon}
                        onClick={() => void saveTitle()}
                        aria-label="Save the new title"
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.rowIcon}
                        onClick={() => setRenaming(null)}
                        aria-label="Cancel renaming"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.sessionButton}
                        onClick={() => void open(s.id)}
                        aria-current={isCurrent ? "true" : undefined}
                        title={title}
                      >
                        {title}
                      </button>
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.rowIcon}
                          onClick={() =>
                            setRenaming({ id: s.id, title: s.title })
                          }
                          aria-label={`Rename chat: ${title}`}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={styles.rowIcon}
                          onClick={() => void removeChat(s.id)}
                          aria-label={`Delete chat: ${title}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className={styles.chatsFooter}>
            <p>
              Chats are kept for 30 days after your last message and uploads for
              7 days. You can delete them at any time.
            </p>
            <a href="/api/assistant/export">Download my chats</a>
            {sessions.length > 0 ? (
              <button
                type="button"
                className={styles.dangerLink}
                onClick={() => void removeAll()}
              >
                Delete all my chats
              </button>
            ) : null}
          </div>
        </section>
  );

  const toolTips = (
    <aside className={styles.tools} aria-label="Study tools">
      <h2>Bring your work</h2>
      <ul>
        <li>
          <Camera size={18} aria-hidden="true" />
          <div>
            <strong>A photo of your work</strong>
            <p>Add a photo of a question or your working, and LearnThrive AI reads it.</p>
          </div>
        </li>
        {status.paperTutor ? (
          <li>
            <FileCheck2 size={18} aria-hidden="true" />
            <div>
              <strong>A whole maths paper</strong>
              <p>
                Add a PDF or photo to have it solved onto a copy{status.paperMarker ? ", or to check your own answers (the marks are AI estimates)" : ""}.
              </p>
            </div>
          </li>
        ) : null}
        {status.voice ? (
          <li>
            <Mic size={18} aria-hidden="true" />
            <div>
              <strong>Talk it through</strong>
              <p>Use the microphone to ask out loud and hear the answer.</p>
            </div>
          </li>
        ) : null}
        <li>
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Answers or step by step</strong>
            <p>Ask for the answer and you get it; ask to work through it and you go one step at a time. Maths answers are checked by calculation where they can be. It can still be wrong, so check anything important.</p>
          </div>
        </li>
      </ul>
    </aside>
  );

  return (
    <>
      {roomy ? null : <SidebarSection>{historyPanel}</SidebarSection>}
      <div className={styles.workspace} ref={setWorkspace} data-roomy={roomy || undefined} data-wide={wide || undefined}>
        {roomy ? (
          <aside className={styles.history} aria-label="Chat history">
            {historyPanel}
          </aside>
        ) : null}

      <div className={styles.page}>
        <header className={styles.bar}>
          <div className={styles.barTitle}>
            <span className={styles.barIcon} aria-hidden="true">
              <MessagesSquare size={18} />
            </span>
            <div>
              <h1 id="sb-heading">LearnThrive AI</h1>
              <p className={styles.barSub}>
                {first
                  ? "Maths, English, Science and 11+"
                  : currentTitle}
              </p>
            </div>
          </div>
          <div className={styles.barEnd}>
            {status.models && status.models.choices.length > 0 ? (
              <>
                <ModelPicker
                  choices={status.models.choices}
                  value={picked}
                  onChange={choose}
                  disabled={busy}
                />
                <EffortPicker
                  options={effortsFor(status.models.choices, picked)}
                  value={effort}
                  onChange={chooseEffort}
                  disabled={busy}
                />
              </>
            ) : null}
            {!first ? (
              <button
                type="button"
                className={styles.barButton}
                onClick={newChat}
                disabled={busy}
              >
                <Plus size={16} aria-hidden="true" />
                <span>New chat</span>
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.logWrap}>
          <div
            className={styles.log}
            ref={log}
            onScroll={onLogScroll}
            role="log"
            aria-label="Conversation"
            aria-live="off"
            tabIndex={0}
          >
            <div className={styles.column}>
              {first ? (
                <div className={styles.empty}>
                  <h2>What are you working on?</h2>
                  <p>
                    Ask a question, or add a photo or PDF of your work. Ask for
                    the answer or a model answer and LearnThrive AI gives it; ask
                    to work through it and it goes step by step with you.
                  </p>
                  <ul
                    className={styles.suggestions}
                    aria-label="Ideas to start with"
                  >
                    {SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <button type="button" onClick={() => setDraft(s)}>
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {messages.map((m) => {
                const streaming = busy && m.id === messages.at(-1)?.id;
                return m.role === "user" ? (
                  <article key={m.id} className={styles.mine} aria-label="You">
                    <h2 className="sr-only">You</h2>
                    {m.files && m.files.length > 0 ? (
                      <ul className={styles.sent} aria-label="What you sent">
                        {m.files.map((file) => (
                          <li key={file.id}>
                            <button
                              type="button"
                              className={styles.sentTile}
                              aria-label={`Look at ${fileLabel(file)}`}
                              aria-haspopup="dialog"
                              onClick={() => setLookingAt(file)}
                            >
                              {isPicture(file) ? (
                                // The student's own upload, from this site, behind their sign-in: next/image cannot optimise it.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={fileUrl(file)} alt="" loading="lazy" />
                              ) : (
                                <span className={styles.sentDocument}>
                                  <FileText size={26} aria-hidden="true" />
                                  <span>{fileLabel(file)}</span>
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {m.content && !(m.files?.length && FILE_ONLY_TEXT.test(m.content)) ? <p className={styles.plain}>{m.content}</p> : null}
                  </article>
                ) : (
                  <article
                    key={m.id}
                    className={styles.theirs}
                    aria-label="LearnThrive AI"
                    aria-busy={streaming || undefined}
                  >
                    <h2 className={styles.who}>
                      <span className={styles.avatar} aria-hidden="true">
                        <MessagesSquare size={13} />
                      </span>
                      LearnThrive AI
                      {m.model ? <span className={styles.modelTag}>Answered by {m.model}</span> : null}
                    </h2>
                    {m.activity && (m.activity.phase === "running" || hasNotableWork(m.activity.steps)) ? <ActivityPanel view={m.activity} /> : null}
                    {m.content ? <RenderedAnswer text={m.content} /> : null}
                    {m.content && !streaming ? (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void copy(m)}
                        >
                          {copied === m.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </div>

          {!atLatest ? (
            <button
              type="button"
              className={styles.jump}
              onClick={jumpToLatest}
            >
              <ArrowDown size={15} aria-hidden="true" />
              Latest
            </button>
          ) : null}
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {announce}
        </div>

        <div className={styles.composer}>
          <div className={styles.column}>
            {offline ? (
              <p className={styles.notice} role="status">
                <WifiOff size={15} aria-hidden="true" /> You are offline. Your
                message will need the internet to send.
              </p>
            ) : null}
            {reading ? (
              <p className={styles.notice} role="status">
                <FileText size={15} aria-hidden="true" /> Reading {reading}…
              </p>
            ) : null}
            {!busy && waiting ? (
              <p className={styles.notice} role="status">
                {waiting}
              </p>
            ) : null}
            {first && !status.minorsApproved ? (
              <label className={styles.ack}>
                <input
                  type="checkbox"
                  checked={adultAck}
                  onChange={(e) => setAdultAck(e.target.checked)}
                />
                <span>{ADULT_ACKNOWLEDGEMENT}</span>
              </label>
            ) : null}
            {busy ? (
              <div className={styles.stopRow}>
                <button
                  type="button"
                  className={styles.stop}
                  onClick={() => abort.current?.abort()}
                >
                  <span className={styles.stopSquare} aria-hidden="true" />
                  Stop
                </button>
              </div>
            ) : null}
            {paper ? (
              <PaperTutor
                key={paper.fileId}
                fileId={paper.fileId}
                sessionId={paper.sessionId}
                fileName={paper.file.name}
                kind={paper.kind}
                schemeFileId={paper.scheme?.fileId}
                blankFileId={paper.blank?.fileId}
                onFinished={() =>
                  void paperFinished(
                    paper.file,
                    paper.sessionId,
                    [paper.scheme?.file, paper.blank?.file].filter((x): x is File => Boolean(x)),
                  )
                }
                onClose={() => setPaper(null)}
              />
            ) : solvable && sessionId ? (
              <div className={styles.paperOffer}>
                <button
                  type="button"
                  className={styles.paperButton}
                  onClick={() =>
                    setPaper({
                      file: solvable,
                      fileId: fileIdsRef.current.get(solvable)!,
                      sessionId,
                      kind: "solve",
                    })
                  }
                >
                  <FileCheck2 size={16} aria-hidden="true" />
                  Solve this paper
                </button>
                {status.paperMarker ? (
                  <button
                    type="button"
                    className={styles.paperButton}
                    onClick={() =>
                      setPaper({
                        file: solvable,
                        fileId: fileIdsRef.current.get(solvable)!,
                        sessionId,
                        kind: "mark",
                        scheme: withRole("scheme")
                          ? {
                              file: withRole("scheme")!,
                              fileId: fileIdsRef.current.get(withRole("scheme")!)!,
                            }
                          : undefined,
                        blank: withRole("blank")
                          ? {
                              file: withRole("blank")!,
                              fileId: fileIdsRef.current.get(withRole("blank")!)!,
                            }
                          : undefined,
                      })
                    }
                  >
                    <FileCheck2 size={16} aria-hidden="true" />
                    Check my completed paper
                  </button>
                ) : null}
                {status.paperMarker && extraPdfs.length > 0 ? (
                  <span className={styles.schemeChoice}>
                    {extraPdfs.map((pdf) => (
                      <label key={roleKey(pdf)}>
                        <span>{pdf.name} is </span>
                        <select
                          value={roles[roleKey(pdf)] ?? ""}
                          onChange={(e) =>
                            setRoles((r) => {
                              const next = { ...r };
                              // One mark scheme and one blank paper at most: choosing a role moves it off any other file.
                              if (e.target.value === "scheme" || e.target.value === "blank") {
                                for (const other of extraPdfs) if (next[roleKey(other)] === e.target.value) delete next[roleKey(other)];
                                next[roleKey(pdf)] = e.target.value;
                              } else delete next[roleKey(pdf)];
                              return next;
                            })
                          }
                        >
                          <option value="">not used</option>
                          <option value="scheme">the mark scheme</option>
                          <option value="blank">the blank question paper</option>
                        </select>
                      </label>
                    ))}
                  </span>
                ) : (
                  <span>
                    Worked answers written onto {solvable.name}
                    {status.paperMarker
                      ? ", or your own answers checked (marks are AI estimates)"
                      : ""}
                  </span>
                )}
              </div>
            ) : null}
            {status.voice ? (
              <VoicePanel
                voice={voice}
                onEdit={(text) => setDraft(text)}
                // Talking over the answer stops it arriving, silences it, and starts a new turn.
                onTalkOver={() => {
                  abort.current?.abort();
                  voice.listen();
                }}
              />
            ) : null}
            {lookingAt ? (
              <FilePreview
                name={fileLabel(lookingAt)}
                size={lookingAt.bytes}
                image={isPicture(lookingAt)}
                pdf={lookingAt.contentType === "application/pdf"}
                url={fileUrl(lookingAt)}
                onClose={() => setLookingAt(null)}
              />
            ) : null}
            <AiInput
              value={draft}
              onValueChange={(text) => {
                setDraft(text);
                if (error) setError("");
              }}
              files={files}
              onFilesSelected={(picked) =>
                upload(picked.filter((f) => !filesRef.current.includes(f)))
              }
              onFileRemove={(file) => removeFile(file)}
              pending={adding}
              onSubmit={(text) => void send(text)}
              busy={busy}
              maxLength={status.limits?.maxInputChars}
              maxFiles={status.limits?.files ?? 3}
              error={error}
              onVoiceButton={
                status.voice
                  ? () => (voice.phase === "off" ? voice.open() : voice.close())
                  : undefined
              }
              voiceActive={voice.phase !== "off"}
              placeholder="Ask about your work"
              fullWidth
            />
            <p className={styles.footnote}>
              Answers are AI-generated and may be wrong: This is an AI,
              not a tutor or a person. Never share your full name, school or
              address. <a href="/privacy">Privacy</a>
            </p>
          </div>
        </div>
      </div>
        {wide ? toolTips : null}
      </div>
    </>
  );
}
