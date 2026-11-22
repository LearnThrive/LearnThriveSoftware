"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight, BookOpen, CalendarDays, Clock, Compass, CornerDownLeft, FileText, GraduationCap, Landmark, LifeBuoy, Loader2,
  LogOut, MessageCircleQuestion, Palette, Plus, Scale, Search, SearchX, Sparkles, UserRound, Users, X,
  type LucideIcon,
} from "lucide-react";
import { useDelayedUnmount } from "@/lib/motion/useDelayedUnmount";
import { rankCommands } from "@/lib/palette/score";
import styles from "./CommandPalette.module.css";

/**
 * The command palette (plan15 Wave 9 section 13.3, reused by the app in Wave 11): one shared
 * component for "go to", "do" and "find".
 *
 * It is built on the existing Dialog primitive's pattern and classes (`.dialog`, `.dialog__scrim`,
 * `.dialog__panel`, `useDelayedUnmount`): focus moves in on open and is trapped, Escape and the
 * scrim close it, focus returns to whatever opened it, and it closes instantly under reduced
 * motion. On top of that it is an ARIA combobox: the text field owns focus the whole time and points
 * at the active result with `aria-activedescendant`; results are a `listbox` of `option`s in
 * labelled groups; the result count is announced through a polite live region.
 *
 * Nothing here knows what the commands are. The caller passes a list (public pages, FAQ questions,
 * theme switches; or, in the app, the role's own navigation) and an optional `search` that returns
 * more results from the server for a query. The palette never receives a dataset it should not
 * show: static commands are the caller's choice, and anything dynamic comes from `search`, which the
 * app implements as a role-scoped server action.
 */
export interface PaletteCommand {
  id: string;
  title: string;
  group: string;
  keywords?: readonly string[];
  /** Right-aligned secondary text: a path, a shortcut, a status. */
  hint?: string;
  /** Internal path (client navigation), a same-page hash, or an absolute/mailto/tel URL. */
  href?: string;
  /** Instead of navigating. The palette closes after it runs. */
  run?: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly PaletteCommand[];
  /** Server-side results for a query (the app's role-scoped search). Debounced by the palette. */
  search?: (query: string) => Promise<readonly PaletteCommand[]>;
  placeholder?: string;
  /** The dialog's accessible name. */
  label?: string;
  /** Storage key for "recent": one per surface (public site, app). */
  storageKey: string;
  /**
   * Where "recent" lives. The public site uses "session": it is forgotten when the tab closes, so the
   * marketing site leaves nothing behind between visits (see the cookie notice). The signed-in app
   * keeps the default, "local".
   */
  persist?: "local" | "session";
  /** What the open-shortcut is, for the footer hint ("Ctrl K" / "⌘K"). */
  shortcutLabel?: string;
}

const MAX_RESULTS = 40;
const MAX_RECENT = 5;
const SEARCH_DEBOUNCE_MS = 160;

function storageFor(persist: "local" | "session"): Storage {
  return persist === "session" ? window.sessionStorage : window.localStorage;
}

function readRecent(storageKey: string, persist: "local" | "session"): string[] {
  try {
    const parsed = JSON.parse(storageFor(persist).getItem(`${storageKey}:recent`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRecent(storageKey: string, persist: "local" | "session", id: string) {
  try {
    const next = [id, ...readRecent(storageKey, persist).filter((existing) => existing !== id)].slice(0, MAX_RECENT);
    storageFor(persist).setItem(`${storageKey}:recent`, JSON.stringify(next));
  } catch {
    /* private window or blocked storage: recents simply do not persist */
  }
}

/** One icon per group, so a long list scans by shape as well as by word. Unknown groups get a quiet default. */
const GROUP_ICON: Record<string, LucideIcon> = {
  Recent: Clock, "Go to": Compass, Pages: Compass, Create: Plus, Actions: Sparkles, Appearance: Palette, Help: LifeBuoy, Account: LogOut,
  Lessons: CalendarDays, Students: GraduationCap, Clients: Users, Tutors: UserRound, Reports: FileText, Subjects: BookOpen,
  FAQ: MessageCircleQuestion, Legal: Scale, Results: Search,
};

function iconFor(command: PaletteCommand, group: string): LucideIcon {
  if (command.href && /^(https?:|mailto:|tel:)/i.test(command.href)) return ArrowUpRight;
  return GROUP_ICON[group] ?? Landmark;
}

/** A short hint like "G D", "?" or "Ctrl K" is a keyboard shortcut and is drawn as keys; anything longer is a subtitle. */
function shortcutKeys(hint: string | undefined): string[] | null {
  if (!hint) return null;
  // Exactly the shapes the app uses ("?", "G D", "Ctrl K", "⌘K"); a name or a status that merely starts with G or Q stays a subtitle.
  const isKeys = hint === "?" || /^G [A-Z0-9]$/.test(hint) || /^(Ctrl|Cmd|Alt|Shift)( ?\+ ?| )\S{1,3}$/.test(hint) || /^[⌘⌃⌥⇧]+\S{1,2}$/.test(hint);
  return isKeys ? hint.split(/ ?\+ ?| /).filter(Boolean) : null;
}

/** Marks the part of a title the search matched: the whole phrase if it is there, otherwise each word. */
function Highlight({ text, query, className }: { text: string; query: string; className: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  const whole = lower.indexOf(q);
  if (whole >= 0) ranges.push([whole, whole + q.length]);
  else {
    for (const word of q.split(/\s+/).filter(Boolean)) {
      const at = lower.indexOf(word);
      if (at >= 0) ranges.push([at, at + word.length]);
    }
  }
  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={start} className={className}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

type Row = { kind: "header"; label: string; key: string } | { kind: "option"; command: PaletteCommand; group: string; index: number; key: string };

export function CommandPalette({
  open,
  onClose,
  commands,
  search,
  placeholder = "Search…",
  label = "Command palette",
  storageKey,
  persist = "local",
  shortcutLabel,
}: CommandPaletteProps) {
  const router = useRouter();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const dialog = useDelayedUnmount(open, 160);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<readonly PaletteCommand[]>([]);
  const [remoteFor, setRemoteFor] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");

  // Open: remember what had focus, reset, load recents. (Adjusting state when `open` flips is done in
  // an effect on purpose: it is a response to an external event, and it runs once per open.)
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    // Only on the real closed -> open transition: React Strict Mode (dev) runs an effect twice, and the
    // second run would record the palette's own field as "what had focus", losing the real opener.
    if (!openedRef.current) {
      openedRef.current = true;
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery("");
      setActive(0);
      setRemote([]);
      setRemoteFor("");
      setRecentIds(readRecent(storageKey, persist));
    }
    document.body.classList.add("has-dialog");
    return () => document.body.classList.remove("has-dialog");
  }, [open, storageKey, persist]);

  // Focus the field once it exists.
  useEffect(() => {
    if (open && dialog.rendered) inputRef.current?.focus();
  }, [open, dialog.rendered]);

  // Server results for a query, debounced; stale responses are ignored.
  useEffect(() => {
    if (!open || !search) return;
    const text = query.trim();
    if (text.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      search(text)
        .then((results) => {
          if (!cancelled) {
            setRemote(results);
            setRemoteFor(text);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemote([]);
            setRemoteFor(text);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, search]);

  const rows = useMemo<Row[]>(() => {
    const text = query.trim();
    const result: Row[] = [];
    let index = 0;
    const push = (group: string, items: readonly PaletteCommand[]) => {
      if (items.length === 0) return;
      result.push({ kind: "header", label: group, key: `h-${group}` });
      for (const command of items) result.push({ kind: "option", command, group, index: index++, key: `${group}-${command.id}` });
    };
    if (!text) {
      const byId = new Map(commands.map((command) => [command.id, command]));
      push("Recent", recentIds.map((id) => byId.get(id)).filter((c): c is PaletteCommand => Boolean(c)));
      const shown = new Set(recentIds);
      const groups = new Map<string, PaletteCommand[]>();
      for (const command of commands) {
        if (shown.has(command.id)) continue;
        groups.set(command.group, [...(groups.get(command.group) ?? []), command]);
      }
      for (const [group, items] of groups) push(group, items);
      return result;
    }
    const matched = rankCommands(text, commands).slice(0, MAX_RESULTS);
    const groups = new Map<string, PaletteCommand[]>();
    for (const command of matched) groups.set(command.group, [...(groups.get(command.group) ?? []), command]);
    for (const [group, items] of groups) push(group, items);
    push("Results", remote.filter((r) => !matched.some((m) => m.id === r.id)));
    return result;
  }, [query, commands, recentIds, remote]);

  const searching = Boolean(search) && query.trim().length >= 2 && remoteFor !== query.trim();

  const options = useMemo(() => rows.filter((row): row is Extract<Row, { kind: "option" }> => row.kind === "option"), [rows]);

  // Keep the active index valid as the list changes.
  const activeIndex = options.length === 0 ? -1 : Math.min(active, options.length - 1);

  // Announce the count (polite, after the user stops typing).
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setAnnouncement(
        options.length === 0 ? (query.trim() ? "No results" : "") : `${options.length} result${options.length === 1 ? "" : "s"}`,
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, options.length, query]);

  // Scroll the active option into view inside the list (the list opts out of smooth scrolling).
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows]);

  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose]);

  const execute = useCallback(
    (command: PaletteCommand) => {
      writeRecent(storageKey, persist, command.id);
      onClose();
      if (command.run) {
        command.run();
        return;
      }
      const href = command.href;
      if (!href) return;
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        window.location.href = href;
        return;
      }
      const url = new URL(href, window.location.origin);
      if (url.pathname === window.location.pathname && url.hash) {
        // Same page: a plain hash change, which fires `hashchange` for the FAQ's hash opener.
        window.location.hash = url.hash.slice(1);
        const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (target) {
          if (!target.hasAttribute("tabindex") && !/^(a|button|input|select|textarea|summary)$/i.test(target.tagName)) {
            target.setAttribute("tabindex", "-1");
          }
          target.focus({ preventScroll: true });
        }
        return;
      }
      router.push(href);
    },
    [onClose, router, storageKey, persist],
  );

  // Escape closes; Tab stays inside the panel (the close button and the field).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  if (!dialog.rendered) return null;

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length) setActive((activeIndex + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length) setActive((activeIndex - 1 + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End" || event.key === "PageDown" || event.key === "PageUp") {
      if (!options.length) return;
      event.preventDefault();
      const last = options.length - 1;
      setActive(event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "PageDown" ? Math.min(last, activeIndex + 6) : Math.max(0, activeIndex - 6));
    } else if (event.ctrlKey && (event.key === "n" || event.key === "p" || event.key === "j")) {
      if (!options.length) return;
      event.preventDefault();
      const down = event.key === "n" || event.key === "j";
      setActive((activeIndex + (down ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter") {
      const row = options[activeIndex];
      if (row) {
        event.preventDefault();
        execute(row.command);
      }
    }
  }

  const optionId = (index: number) => `${baseId}-opt-${index}`;

  return (
    <div className={`dialog ${styles.root} ${dialog.closing ? "is-closing" : ""}`}>
      <button type="button" className="dialog__scrim" aria-label="Close search" tabIndex={-1} onClick={close} />
      <div
        ref={panelRef}
        className={`dialog__panel ${styles.panel} ${dialog.closing ? "is-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <div className={styles.field}>
          {searching ? (
            <Loader2 aria-hidden="true" size={18} className={`${styles.fieldIcon} ${styles.spin}`} />
          ) : (
            <Search aria-hidden="true" size={18} className={styles.fieldIcon} />
          )}
          <input
            ref={inputRef}
            data-palette-input=""
            className={styles.input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            aria-label={label}
            placeholder={placeholder}
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          {query ? (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setActive(0);
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          ) : null}
          <button type="button" className={`icon-button ${styles.close}`} aria-label="Close search" onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className={styles.list} data-lenis-prevent="">
          {rows.length === 0 ? (
            <li role="presentation" className={styles.empty}>
              {query.trim() ? (
                <>
                  <SearchX aria-hidden="true" size={26} className={styles.emptyIcon} />
                  <strong>{searching ? "Searching…" : `Nothing matches “${query.trim()}”`}</strong>
                  {searching ? null : <span>Check the spelling, or try a shorter word such as a name or a subject.</span>}
                </>
              ) : (
                <>
                  <Search aria-hidden="true" size={26} className={styles.emptyIcon} />
                  <strong>Start typing to search</strong>
                </>
              )}
            </li>
          ) : (
            rows.map((row) => {
              if (row.kind === "header") {
                const HeaderIcon = GROUP_ICON[row.label];
                return (
                  <li key={row.key} role="presentation" className={styles.group}>
                    {HeaderIcon ? <HeaderIcon aria-hidden="true" size={12} /> : null}
                    {row.label}
                  </li>
                );
              }
              const Icon = iconFor(row.command, row.group);
              const keys = shortcutKeys(row.command.hint);
              const subtitle = keys ? null : row.command.hint;
              const isActive = row.index === activeIndex;
              return (
                <li
                  key={row.key}
                  id={optionId(row.index)}
                  role="option"
                  aria-selected={isActive}
                  data-index={row.index}
                  className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
                  onMouseMove={() => row.index !== activeIndex && setActive(row.index)}
                  onClick={() => execute(row.command)}
                >
                  <span className={styles.optionIcon} aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <span className={styles.optionText}>
                    <span className={styles.optionTitle}>
                      <Highlight text={row.command.title} query={query} className={styles.mark} />
                    </span>
                    {subtitle ? <span className={styles.optionSub}>{subtitle}</span> : null}
                  </span>
                  <span className={styles.optionEnd} aria-hidden="true">
                    {keys?.map((key) => (
                      <kbd key={key} className={styles.key}>{key}</kbd>
                    ))}
                    {isActive ? (
                      <kbd className={`${styles.key} ${styles.keyEnter}`}>
                        <CornerDownLeft size={11} />
                      </kbd>
                    ) : null}
                  </span>
                </li>
              );
            })
          )}
        </ul>

        <div className={styles.footer} aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={11} />
            </kbd>{" "}
            to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
          {shortcutLabel ? <span className={styles.footerRight}>{shortcutLabel} to reopen</span> : null}
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      </div>
    </div>
  );
}
