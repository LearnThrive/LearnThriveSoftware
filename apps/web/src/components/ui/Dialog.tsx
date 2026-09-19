"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Modal dialog for significant create/edit flows (plan6 section 36), replacing the `<details>`
 * disclosures the admin pages used to use.
 *
 * Focus management is the reason this is a real component rather than markup copied per page:
 * focus moves into the dialog on open, is trapped inside while it's open, and returns to the
 * trigger on close. Escape and a click on the backdrop both close it.
 */
export function Dialog({ trigger, title, description, children, id }: {
  /** Rendered as the opening control; receives no props, so style it however the page needs. */
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const generatedId = useId();
  const dialogId = id ?? generatedId;

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const focusable = () => Array.from(
      panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("has-dialog");
    };
  }, [open]);

  function close() {
    setOpen(false);
    // Returning focus to what opened the dialog is what makes this usable by keyboard.
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="dialog-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        {trigger}
      </button>
      {open && (
        <div className="dialog">
          <button type="button" className="dialog__scrim" aria-label="Close dialog" onClick={close} />
          <div className="dialog__panel" role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} ref={panelRef}>
            <header className="dialog__header">
              <div>
                <h2 className="dialog__title" id={`${dialogId}-title`}>{title}</h2>
                {description && <p className="dialog__description">{description}</p>}
              </div>
              <button type="button" className="icon-button" onClick={close} aria-label="Close">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="dialog__body">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
