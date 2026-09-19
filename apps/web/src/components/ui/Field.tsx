import type { ReactNode } from "react";

/**
 * Form primitives (plan6 section 35): one label style, one hint style, one error style, one set
 * of control styles — so a form never looks hand-built per page.
 */

export function Field({ label, htmlFor, hint, error, required, children }: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field ${error ? "field--invalid" : ""}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="field__required" aria-hidden="true">*</span>}
        {!required && <span className="field__optional">Optional</span>}
      </label>
      {children}
      {hint && !error && <p className="field__hint" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && <p className="field__error" id={`${htmlFor}-error`} role="alert">{error}</p>}
    </div>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions">{children}</div>;
}

/** A visually separated group of related fields within a longer form (plan6 section 35). */
export function FieldSet({ legend, description, children }: {
  legend: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="fieldset">
      <legend className="fieldset__legend">{legend}</legend>
      {description && <p className="fieldset__description">{description}</p>}
      <div className="fieldset__body">{children}</div>
    </fieldset>
  );
}
