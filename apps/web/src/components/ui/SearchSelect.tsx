"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Check, ChevronDown, Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { useDelayedUnmount } from "@/lib/motion/useDelayedUnmount";

export interface SearchSelectOption {
  id: string;
  name: string;
  /** A quiet second line: what a tutor teaches, a person's username and roles. Searched too. */
  sub?: string;
  /** A number in a pill on the right (a tutor's lessons). */
  count?: number;
}

/**
 * One searchable dropdown for choosing a person (the calendar's tutor, the Roles screen's person), instead of a row of tabs or a wall of
 * cards that stops working as the list grows. The choice is a URL query parameter, so the view is a link that survives a reload.
 * A combobox: type to filter, arrow keys move, Enter chooses, Escape closes.
 *
 * `all` adds a pinned first option (value "all"), for a filter. Without it there may be no choice yet, and the button says `placeholder`.
 * `plain` is for a short list that is not people (a subject, a year group, a sort order): no avatars and no search box; `icon` marks the
 * button instead. Changing the choice keeps every other query parameter on the page (search, other filters) and drops a stale toast.
 */
export function SearchSelect({ basePath, param, value, options, all, caption, placeholder, searchLabel, plain = false, icon }: {
  basePath: string;
  param: string;
  value: string;
  options: readonly SearchSelectOption[];
  all?: { label: string; count?: number };
  caption: string;
  placeholder: string;
  /** e.g. "Find a tutor…" (also the list's name in plain mode) */
  searchLabel: string;
  plain?: boolean;
  icon?: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panel = useDelayedUnmount(open, 100);
  const listId = useId();

  const ALL = "all";
  const selected = options.find((option) => option.id === value) ?? null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle ? options.filter((option) => `${option.name} ${option.sub ?? ""}`.toLowerCase().includes(needle)) : options;
    const showAll = all && (!needle || all.label.toLowerCase().includes(needle));
    return [...(showAll ? [{ id: ALL, name: all.label, count: all.count } as SearchSelectOption] : []), ...matches];
  }, [query, options, all]);

  function close(returnFocus: boolean) {
    setOpen(false);
    setQuery("");
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(id: string) {
    close(true);
    if (id === value) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("toast");
    params.set(param, id);
    startTransition(() => router.push(`${basePath}?${params.toString()}`, { scroll: false }));
  }

  function openPanel() {
    setActive(Math.max(0, shown.findIndex((option) => option.id === value)));
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    (plain ? listRef.current : searchRef.current)?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option in view as the arrow keys move.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActive(0); }
    else if (event.key === "End") { event.preventDefault(); setActive(shown.length - 1); }
    else if (event.key === "Enter") { event.preventDefault(); const option = shown[active]; if (option) choose(option.id); }
    else if (event.key === "Tab") close(false);
  }

  const isAll = !selected && Boolean(all);
  const label = selected ? selected.name : all ? all.label : placeholder;
  const count = selected ? selected.count : all?.count;

  return (
    <div className="search-select" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`search-select__trigger ${!selected && !all ? "is-empty" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${caption}: ${label}. Change`}
        onClick={() => (open ? close(false) : openPanel())}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); openPanel(); } }}
        data-pending={pending || undefined}
      >
        <span className="search-select__mark" aria-hidden="true">
          {plain
            ? <span className="search-select__icon">{icon ?? <Search size={15} />}</span>
            : selected ? <Avatar name={selected.name} size="sm" /> : <span className="search-select__icon">{isAll ? <Users size={15} /> : <Search size={15} />}</span>}
        </span>
        <span className="search-select__text">
          <span className="search-select__caption">{caption}</span>
          <span className="search-select__value">{label}</span>
        </span>
        {count !== undefined && <span className="search-select__count" aria-hidden="true">{count}</span>}
        <ChevronDown size={16} aria-hidden="true" className={`icon-rotate ${open ? "is-open" : ""}`} />
      </button>

      {panel.rendered && (
        <div className={`search-select__panel ${plain ? "search-select__panel--plain" : ""} ${panel.closing ? "is-closing" : ""}`}>
          {!plain && <div className="search-select__search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              aria-label={searchLabel}
              placeholder={searchLabel}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }}
              onKeyDown={onSearchKeyDown}
            />
          </div>}
          <ul
            className="search-select__list"
            role="listbox"
            id={listId}
            ref={listRef}
            aria-label={plain ? searchLabel : caption}
            // Plain mode has no search box, so the list itself takes focus and the keys.
            tabIndex={plain ? -1 : undefined}
            aria-activedescendant={plain && shown[active] ? `${listId}-${active}` : undefined}
            onKeyDown={plain ? onSearchKeyDown : undefined}
          >
            {shown.map((option, index) => {
              const isSelected = option.id === ALL ? isAll || value === ALL : option.id === value;
              return (
                <li
                  key={option.id}
                  id={`${listId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  className={`search-select__option ${index === active ? "is-active" : ""} ${isSelected ? "is-selected" : ""}`}
                  onPointerEnter={() => setActive(index)}
                  // pointerdown + preventDefault keeps focus in the search box, so the click is not lost to a blur.
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(option.id)}
                >
                  {!plain && (
                    <span className="search-select__mark" aria-hidden="true">
                      {option.id === ALL ? <span className="search-select__icon"><Users size={15} /></span> : <Avatar name={option.name} size="sm" />}
                    </span>
                  )}
                  <span className="search-select__text">
                    <span className="search-select__value">{option.name}</span>
                    {option.sub && <span className="search-select__sub">{option.sub}</span>}
                  </span>
                  {option.count !== undefined && <span className="search-select__count">{option.count}</span>}
                  <Check size={15} aria-hidden="true" className="search-select__check" />
                </li>
              );
            })}
            {shown.length === 0 && <li className="search-select__empty" role="presentation">Nothing matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
