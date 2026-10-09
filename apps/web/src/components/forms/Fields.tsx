"use client";

import type { ChangeEvent, ReactNode } from "react";
import styles from "./forms.module.css";

/**
 * Field building blocks for the careers application, the safeguarding reconfirmation and the subject request.
 * Text fields, selects and text areas reuse the site's own `.form-field` styles (the enquiry form's look);
 * groups of tick-boxes and radio buttons are fieldsets with a legend. Every control has a real label, every
 * error is tied to its control with aria-describedby, and each field has a predictable id (`field-<name>`)
 * so an error summary can link to it and move focus there.
 */
export const fieldId = (name: string) => `field-${name}`;

interface Common {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  full?: boolean;
}

function describedBy(name: string, hint: ReactNode, error?: string) {
  const ids = [hint ? `${fieldId(name)}-hint` : "", error ? `${fieldId(name)}-error` : ""].filter(Boolean).join(" ");
  return ids || undefined;
}

function Wrapper({ name, label, hint, error, optional, full, children }: Common & { children: ReactNode }) {
  return (
    <div className={`form-field${full ? " form-field--full" : ""}`}>
      <label htmlFor={fieldId(name)}>
        {label}
        {optional ? <span> (optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <span className="field-hint" id={`${fieldId(name)}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={`${fieldId(name)}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextField(
  props: Common & {
    value: string;
    onChange: (value: string) => void;
    type?: "text" | "email" | "tel" | "date";
    autoComplete?: string;
    inputMode?: "text" | "email" | "tel" | "numeric";
    maxLength?: number;
    min?: string;
    max?: string;
  },
) {
  const { name, hint, error, value, onChange, type = "text", autoComplete, inputMode, maxLength, min, max } = props;
  return (
    <Wrapper {...props}>
      <input
        id={fieldId(name)}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        min={min}
        max={max}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, hint, error)}
      />
    </Wrapper>
  );
}

export function TextAreaField(props: Common & { value: string; onChange: (value: string) => void; rows?: number; maxLength?: number; counter?: boolean }) {
  const { name, hint, error, value, onChange, rows = 5, maxLength, counter } = props;
  return (
    <Wrapper {...props} hint={hint}>
      <textarea
        id={fieldId(name)}
        name={name}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, hint, error)}
      />
      {counter && maxLength ? (
        <span className="field-hint" aria-hidden="true">
          {value.length} of {maxLength} characters
        </span>
      ) : null}
    </Wrapper>
  );
}

export function SelectField(props: Common & { value: string; onChange: (value: string) => void; options: ReadonlyArray<string | { value: string; label: string }>; placeholder?: string }) {
  const { name, hint, error, value, onChange, options, placeholder = "Choose an option" } = props;
  return (
    <Wrapper {...props}>
      <select
        id={fieldId(name)}
        name={name}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(name, hint, error)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const entry = typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          );
        })}
      </select>
    </Wrapper>
  );
}

/** A single tick-box that carries its own sentence (a declaration, a part of the agreement). */
export function CheckboxField({
  name,
  label,
  checked,
  onChange,
  error,
  hint,
}: {
  name: string;
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <label className={`${styles.declaration}${error ? ` ${styles.invalidGroup}` : ""}`} htmlFor={fieldId(name)}>
        <input
          id={fieldId(name)}
          name={name}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(name, hint, error)}
        />
        <span>{label}</span>
      </label>
      {hint ? (
        <span className="field-hint" id={`${fieldId(name)}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={`field-error ${styles.message}`} id={`${fieldId(name)}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** A fieldset of tick-boxes: the visitor may pick any number. */
export function CheckboxGroup({
  name,
  legend,
  options,
  values,
  onChange,
  error,
  hint,
  optional,
  stacked,
}: {
  name: string;
  legend: ReactNode;
  options: readonly string[];
  values: readonly string[];
  onChange: (values: string[]) => void;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  stacked?: boolean;
}) {
  return (
    <fieldset className={`${styles.group}${error ? ` ${styles.invalidGroup}` : ""}`} id={fieldId(name)} tabIndex={-1} aria-describedby={describedBy(name, hint, error)}>
      <legend>
        {legend}
        {optional ? <span> (optional)</span> : null}
      </legend>
      <div className={`${styles.options}${stacked ? ` ${styles.optionsStacked}` : ""}`}>
        {options.map((option) => (
          <label className={styles.option} key={option}>
            <input
              type="checkbox"
              name={name}
              value={option}
              checked={values.includes(option)}
              onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((entry) => entry !== option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <span className={`field-hint ${styles.message}`} id={`${fieldId(name)}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={`field-error ${styles.message}`} id={`${fieldId(name)}-error`}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/** A fieldset of radio buttons: exactly one choice. */
export function RadioGroup({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  hint,
  optional,
  stacked,
}: {
  name: string;
  legend: ReactNode;
  options: ReadonlyArray<{ value: string; label: ReactNode }>;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  stacked?: boolean;
}) {
  return (
    <fieldset className={`${styles.group}${error ? ` ${styles.invalidGroup}` : ""}`} id={fieldId(name)} tabIndex={-1} aria-describedby={describedBy(name, hint, error)}>
      <legend>
        {legend}
        {optional ? <span> (optional)</span> : null}
      </legend>
      <div className={`${styles.options}${stacked ? ` ${styles.optionsStacked}` : ""}`}>
        {options.map((option) => (
          <label className={styles.option} key={option.value}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? (
        <span className={`field-hint ${styles.message}`} id={`${fieldId(name)}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={`field-error ${styles.message}`} id={`${fieldId(name)}-error`}>
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}

/** Where the honeypot lives: invisible, unreachable by keyboard, and not announced. */
export function Honeypot({ value, onChange, id }: { value: string; onChange: (value: string) => void; id: string }) {
  return (
    <div className={styles.trap} aria-hidden="true">
      <label htmlFor={id}>Leave this field empty</label>
      <input id={id} name="website" type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
