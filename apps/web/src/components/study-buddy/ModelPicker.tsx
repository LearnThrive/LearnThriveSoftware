"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import styles from "./study-buddy.module.css";

export interface ModelChoice {
  id: string;
  label: string;
  description: string;
  /** Whether it answered a readiness check when the page opened. */
  ready: boolean;
  detail?: string | null;
}

/**
 * The developer model picker (docs/ASSISTANT.md, "Model picker"). Only rendered when the server listed choices for this account, and the
 * server checks every request again: this is a convenience, not the permission. A compact button in the chat header opens a listbox (the
 * WAI-ARIA "select-only combobox" pattern): arrow keys move, Enter or Space chooses, Escape closes and returns focus. While an answer is
 * arriving it is disabled, so a model never changes part-way through one; a change applies to the next question.
 */
export function ModelPicker({ choices, value, onChange, disabled }: { choices: readonly ModelChoice[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const [wantOpen, setOpen] = useState(false);
  // Never open while an answer is arriving, even if it was opened just before.
  const open = wantOpen && !disabled;
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = choices.find((c) => c.id === value) ?? choices[0];

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function show() {
    if (disabled) return;
    setActive(Math.max(0, choices.findIndex((c) => c.id === current?.id)));
    setOpen(true);
  }

  function choose(index: number) {
    const picked = choices[index];
    if (picked) onChange(picked.id);
    setOpen(false);
    button.current?.focus();
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show();
    }
  }

  function onListKey(event: KeyboardEvent<HTMLUListElement>) {
    const last = choices.length - 1;
    if (event.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (event.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      if (event.key === "Escape") button.current?.focus();
      return;
    } else return;
    event.preventDefault();
  }

  if (!current) return null;
  return (
    <div className={styles.picker} ref={wrap}>
      <button
        ref={button}
        type="button"
        className={styles.pickerButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`AI model: ${current.label}. Developer setting.`}
        title={disabled ? "The model can be changed when this answer has finished" : "Choose the AI model for your next question (developer setting)"}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        <Cpu size={15} aria-hidden="true" />
        <span className={styles.pickerName}>{current.label}</span>
        {!current.ready ? <span className={styles.pickerDot} aria-hidden="true" /> : null}
        <ChevronDown size={15} aria-hidden="true" className={styles.pickerChevron} data-open={open || undefined} />
      </button>
      {open ? (
        <div className={styles.pickerPanel}>
          <p className={styles.pickerHeading} id={`${id}-label`}>
            Choose AI model <span className={styles.aiTag}>DEV</span>
          </p>
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={`${id}-opt-${active}`}
            className={styles.pickerList}
            onKeyDown={onListKey}
          >
            {choices.map((c, index) => (
              <li
                key={c.id}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={c.id === current.id}
                data-active={index === active || undefined}
                className={styles.pickerOption}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span className={styles.pickerRadio} aria-hidden="true">
                  {c.id === current.id ? <Check size={13} /> : null}
                </span>
                <span className={styles.pickerText}>
                  <strong>{c.label}</strong>
                  <span>{c.description}</span>
                  {!c.ready ? <span className={styles.pickerWarn}>Not answering right now{c.detail ? ` (${c.detail.replace(/_/g, " ")})` : ""}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.pickerNote}>Applies to your next question. Each answer is labelled with the model that wrote it.</p>
        </div>
      ) : null}
    </div>
  );
}
