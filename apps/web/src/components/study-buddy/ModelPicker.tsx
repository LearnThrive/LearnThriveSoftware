"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Cpu, Gauge } from "lucide-react";
import styles from "./study-buddy.module.css";

export interface ModelChoice {
  id: string;
  label: string;
  description: string;
  /** Whether it answered a readiness check when the page opened. */
  ready: boolean;
  detail?: string | null;
  /**
   * The reasoning efforts this model's own effort picker offers (auto first, then the levels the model honours). Empty or absent: the
   * model takes no effort setting, so no effort picker is shown for it.
   */
  efforts?: ReadonlyArray<EffortChoice>;
}

export interface EffortChoice {
  id: string;
  label: string;
}

interface Option {
  id: string;
  label: string;
  description?: string;
  ready?: boolean;
  detail?: string | null;
}

/**
 * The one listbox behind both header pickers (the WAI-ARIA "select-only combobox" pattern): arrow keys move, Home/End go to the ends,
 * Enter or Space chooses, Escape closes and returns focus to the button. While an answer is arriving a picker is disabled, so a setting
 * never changes part-way through one; a change applies to the next question. Two uses, both for developers: which model answers, and how
 * hard that model thinks.
 */
function Picker({
  options,
  value,
  onChange,
  disabled,
  icon,
  ariaLabel,
  title,
  disabledTitle,
  heading,
  note,
  showReadiness,
}: {
  options: readonly Option[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  icon: ReactNode;
  /** Built from the current option's label, so a screen reader hears the setting and its value. */
  ariaLabel: (label: string) => string;
  title: string;
  disabledTitle: string;
  heading: ReactNode;
  note: string;
  showReadiness?: boolean;
}) {
  const [wantOpen, setOpen] = useState(false);
  // Never open while an answer is arriving, even if it was opened just before.
  const open = wantOpen && !disabled;
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const id = useId();
  // A value that is no longer offered (a model taken out of the table, an effort the current model does not take) falls back to the first option.
  const current = options.find((c) => c.id === value) ?? options[0];

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
    setActive(Math.max(0, options.findIndex((c) => c.id === current?.id)));
    setOpen(true);
  }

  function choose(index: number) {
    const picked = options[index];
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
    const last = options.length - 1;
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
        aria-label={ariaLabel(current.label)}
        title={disabled ? disabledTitle : title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        {icon}
        <span className={styles.pickerName}>{current.label}</span>
        {showReadiness && !current.ready ? <span className={styles.pickerDot} aria-hidden="true" /> : null}
        <ChevronDown size={15} aria-hidden="true" className={styles.pickerChevron} data-open={open || undefined} />
      </button>
      {open ? (
        <div className={styles.pickerPanel}>
          <p className={styles.pickerHeading} id={`${id}-label`}>
            {heading}
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
            {options.map((c, index) => (
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
                  {c.description ? <span>{c.description}</span> : null}
                  {showReadiness && !c.ready ? <span className={styles.pickerWarn}>Not answering right now{c.detail ? ` (${c.detail.replace(/_/g, " ")})` : ""}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.pickerNote}>{note}</p>
        </div>
      ) : null}
    </div>
  );
}

/** The developer model picker (docs/ASSISTANT.md, "Model picker"): which model answers this account's next question. */
export function ModelPicker({ choices, value, onChange, disabled }: { choices: readonly ModelChoice[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <Picker
      options={choices}
      value={value}
      onChange={onChange}
      disabled={disabled}
      icon={<Cpu size={15} aria-hidden="true" />}
      ariaLabel={(label) => `AI model: ${label}. Developer setting.`}
      title="Choose the AI model for your next question (developer setting)"
      disabledTitle="The model can be changed when this answer has finished"
      heading={
        <>
          Choose AI model <span className={styles.aiTag}>DEV</span>
        </>
      }
      note="Applies to your next question. Each answer is labelled with the model that wrote it."
      showReadiness
    />
  );
}

/**
 * How hard the chosen model thinks (docs/ASSISTANT.md, "Model picker"), for the models that take an effort setting. It offers only the
 * levels that model honours, and "Auto" leaves the decision with the question, which is the ordinary behaviour. A model with no levels
 * (the local tutor) shows no picker at all.
 */
export function EffortPicker({ options, value, onChange, disabled }: { options: readonly EffortChoice[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  if (options.length < 2) return null;
  return (
    <Picker
      options={options}
      value={value}
      onChange={onChange}
      disabled={disabled}
      icon={<Gauge size={15} aria-hidden="true" />}
      ariaLabel={(label) => `Reasoning effort: ${label}. Developer setting.`}
      title="Choose how hard the model thinks for your next question (developer setting)"
      disabledTitle="The effort can be changed when this answer has finished"
      heading={
        <>
          Reasoning effort <span className={styles.aiTag}>DEV</span>
        </>
      }
      note="How hard the chosen model thinks about your next question. Auto leaves it to the question: none for ordinary chat, more for a sourced or hard one."
    />
  );
}
