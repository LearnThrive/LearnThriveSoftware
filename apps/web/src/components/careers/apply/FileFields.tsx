"use client";

import { useRef } from "react";
import { fieldId } from "@/components/forms/Fields";
import { careersConfig } from "@/lib/careers-config";
import {
  acceptAttribute,
  acceptedFormatsText,
  formatBytes,
  SUPPORTING_DOCUMENT_TYPES,
  type FileSlot,
} from "@/lib/careers-files";
import { shrinkImageIfLarge } from "./imageResize";
import styles from "./apply.module.css";

/**
 * File fields for the application. Each is a real, labelled `<input type="file">`: the input is stretched
 * invisibly over a dashed drop area, so a click, the keyboard (the focus ring is drawn around the whole area)
 * and dropping a file all go to the native control and work with a screen reader. After a file is chosen its
 * name and size are shown with a Remove button, and choosing again replaces it. Large photographs are
 * resized first (imageResize.ts). Every change is announced through `announce` (an aria-live region in the
 * form). The checks here are a courtesy; the server checks everything again.
 */
interface SingleProps {
  name: string;
  slot: FileSlot;
  label: string;
  optional?: boolean;
  hint?: string;
  file: File | null;
  error?: string;
  onChange: (file: File | null) => void;
  announce: (message: string) => void;
}

export function SingleFileField({ name, slot, label, optional, hint, file, error, onChange, announce }: SingleProps) {
  const input = useRef<HTMLInputElement>(null);
  const id = fieldId(name);

  async function pick(picked: File | undefined) {
    if (!picked) return;
    const prepared = await shrinkImageIfLarge(picked);
    onChange(prepared);
    announce(`${label} chosen: ${prepared.name}, ${formatBytes(prepared.size)}.`);
  }

  return (
    <div className={styles.fileBlock}>
      <label className={styles.fileLabel} htmlFor={id}>
        {label}
        {optional ? <span> (optional)</span> : null}
      </label>
      <div className={`${styles.drop}${error ? ` ${styles.dropInvalid}` : ""}`}>
        <input
          ref={input}
          id={id}
          name={name}
          type="file"
          accept={acceptAttribute(slot)}
          aria-invalid={Boolean(error)}
          aria-describedby={[hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined}
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            void pick(picked);
          }}
        />
        <span className={styles.dropText}>
          <strong>{file ? "Choose a different file" : "Choose a file, or drop one here"}</strong>
          <small>{acceptedFormatsText(slot)}</small>
        </span>
      </div>
      {file ? (
        <div className={styles.chosen}>
          <span className={styles.chosenName}>{file.name}</span>
          <span className={styles.chosenSize}>{formatBytes(file.size)}</span>
          <button
            type="button"
            className={styles.removeButton}
            onClick={() => {
              onChange(null);
              announce(`${label} removed.`);
              input.current?.focus();
            }}
          >
            Remove<span className="sr-only"> {label}</span>
          </button>
        </div>
      ) : null}
      {hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface SupportingItem {
  id: string;
  file: File;
  type: string;
}

interface SupportingProps {
  items: readonly SupportingItem[];
  /** Per-item problem messages by item id (file problems and a missing type). */
  errors: Readonly<Record<string, string>>;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  onType: (id: string, type: string) => void;
  announce: (message: string) => void;
}

export function SupportingFiles({ items, errors, onAdd, onRemove, onType, announce }: SupportingProps) {
  const input = useRef<HTMLInputElement>(null);
  const { maxFiles } = careersConfig.limits.supporting;
  const full = items.length >= maxFiles;
  const id = fieldId("supporting");

  async function pickMany(files: File[]) {
    let room = maxFiles - items.length;
    for (const picked of files) {
      if (room <= 0) {
        announce(`Only ${maxFiles} supporting documents can be added.`);
        break;
      }
      const prepared = await shrinkImageIfLarge(picked);
      onAdd(prepared);
      announce(`Supporting document added: ${prepared.name}, ${formatBytes(prepared.size)}. Choose its type.`);
      room -= 1;
    }
  }

  return (
    <div className={styles.fileBlock}>
      {items.length > 0 ? (
        <ul className={styles.docList} aria-label="Supporting documents added">
          {items.map((item) => {
            const error = errors[item.id];
            const selectId = fieldId(`docType-${item.id}`);
            return (
              <li className={styles.docRow} key={item.id}>
                <div className={styles.chosen}>
                  <span className={styles.chosenName}>{item.file.name}</span>
                  <span className={styles.chosenSize}>{formatBytes(item.file.size)}</span>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => {
                      onRemove(item.id);
                      announce(`${item.file.name} removed.`);
                      input.current?.focus();
                    }}
                  >
                    Remove<span className="sr-only"> {item.file.name}</span>
                  </button>
                </div>
                <div className="form-field">
                  <label htmlFor={selectId}>
                    Type of document<span className="sr-only"> for {item.file.name}</span>
                  </label>
                  <select
                    id={selectId}
                    value={item.type}
                    onChange={(event) => onType(item.id, event.target.value)}
                    aria-invalid={Boolean(error && !item.type)}
                    aria-describedby={error ? `${selectId}-error` : undefined}
                  >
                    <option value="">Choose a type</option>
                    {SUPPORTING_DOCUMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                {error ? (
                  <span className={`field-error ${styles.docError}`} id={`${selectId}-error`}>
                    {error}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {full ? (
        <p className="field-hint">You have added the most you can: {maxFiles} documents. Remove one to add another.</p>
      ) : (
        <>
          <label className={styles.fileLabel} htmlFor={id}>
            {items.length === 0 ? "Add a supporting document" : "Add another supporting document"}
            <span> (optional)</span>
          </label>
          <div className={styles.drop}>
            <input
              ref={input}
              id={id}
              name="supporting"
              type="file"
              multiple
              accept={acceptAttribute("supporting")}
              aria-describedby={`${id}-hint`}
              onChange={(event) => {
                const picked = event.target.files ? Array.from(event.target.files) : [];
                event.target.value = "";
                if (picked.length) void pickMany(picked);
              }}
            />
            <span className={styles.dropText}>
              <strong>Choose files, or drop them here</strong>
              <small>{acceptedFormatsText("supporting")}</small>
            </span>
          </div>
          <span className="field-hint" id={`${id}-hint`}>
            Up to {maxFiles} files, each up to {formatBytes(careersConfig.limits.supporting.maxBytes)}.
          </span>
        </>
      )}
    </div>
  );
}

/** How much of the whole-application limit the chosen files use. */
export function FileTotal({ total, error }: { total: number; error?: string }) {
  const limit = careersConfig.limits.totalBytes;
  const over = total > limit;
  return (
    <div className={styles.meter}>
      <span id={`${fieldId("files")}-total`}>
        Files chosen: {formatBytes(total)} of {formatBytes(limit)}
        {over ? " (too much)" : ""}
      </span>
      <div className={styles.meterBar} aria-hidden="true">
        <div className={styles.meterFill} data-over={over} style={{ width: `${Math.min(100, (total / limit) * 100)}%` }} />
      </div>
      {error ? (
        <span className="field-error" id={`${fieldId("files")}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
