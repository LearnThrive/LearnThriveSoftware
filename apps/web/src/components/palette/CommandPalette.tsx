"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, X } from "lucide-react";
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

type Row = { kind: "header"; label: string; key: string } | { kind: "option"; command: PaletteCommand; index: number; key: string };

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
          if (!cancelled) setRemote(results);
        })
        .catch(() => {
          if (!cancelled) setRemote([]);
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
      for (const command of items) result.push({ kind: "option", command, index: index++, key: `${group}-${command.id}` });
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
          <Search aria-hidden="true" size={18} className={styles.fieldIcon} />
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
          <button type="button" className={`icon-button ${styles.close}`} aria-label="Close search" onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className={styles.list} data-lenis-prevent="">
          {rows.length === 0 ? (
            <li role="presentation" className={styles.empty}>
              {query.trim() ? `Nothing matches “${query.trim()}”.` : "Start typing to search."}
            </li>
          ) : (
            rows.map((row) =>
              row.kind === "header" ? (
                <li key={row.key} role="presentation" className={styles.group}>
                  {row.label}
                </li>
              ) : (
                <li
                  key={row.key}
                  id={optionId(row.index)}
                  role="option"
                  aria-selected={row.index === activeIndex}
                  data-index={row.index}
                  className={`${styles.option} ${row.index === activeIndex ? styles.optionActive : ""}`}
                  onMouseMove={() => row.index !== activeIndex && setActive(row.index)}
                  onClick={() => execute(row.command)}
                >
                  <span className={styles.optionTitle}>{row.command.title}</span>
                  {row.command.hint ? <span className={styles.optionHint}>{row.command.hint}</span> : null}
                </li>
              ),
            )
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
