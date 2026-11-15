"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./BankTransferPanel.module.css";

export interface BankTransferDetails {
  payeeName: string;
  /** Already written with dashes, like 12-34-56. */
  sortCode: string;
  accountNumber: string;
  bankName: string;
  /** This family's LT- reference. */
  reference: string;
}

/** Copies to the clipboard; falls back to a hidden selection where the clipboard API is not allowed (an older browser, an insecure origin). */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * "Pay by bank transfer" (docs/TUITION_BILLING.md). Shows what a parent needs to make the payment, each line with its own copy button, and the
 * reminder that the details never change by email or message. The details arrive as props from the server for the signed-in parent; nothing
 * here fetches or stores them, and the real values are not in this file or in the site's JavaScript.
 *
 * Accessibility: each copy button names what it copies ("Copy account number"), is a real button, and is at least 44px; the result is
 * announced in a polite live region, so it does not depend on the icon changing.
 */
export function BankTransferPanel({ details }: { details: BankTransferDetails }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows: Array<{ key: string; label: string; value: string; copyAs: string; className?: string }> = [
    { key: "payee", label: "Payee name", value: details.payeeName, copyAs: "payee name" },
    { key: "sort", label: "Sort code", value: details.sortCode, copyAs: "sort code" },
    { key: "account", label: "Account number", value: details.accountNumber, copyAs: "account number" },
    { key: "bank", label: "Bank", value: details.bankName, copyAs: "bank name" },
    { key: "reference", label: "Your payment reference", value: details.reference, copyAs: "payment reference", className: styles.reference },
  ];

  async function copy(row: (typeof rows)[number]) {
    const ok = await copyText(row.value);
    if (timer.current) clearTimeout(timer.current);
    if (ok) {
      setCopied(row.key);
      setAnnouncement(`Copied ${row.copyAs}.`);
      timer.current = setTimeout(() => { setCopied(null); setAnnouncement(""); }, 2500);
    } else {
      setCopied(null);
      setAnnouncement(`Could not copy the ${row.copyAs}. Select it and copy it yourself.`);
    }
  }

  return (
    <section aria-labelledby="bank-transfer-heading">
      <h2 id="bank-transfer-heading" className={styles.heading}>Pay by bank transfer</h2>
      <dl className={styles.list}>
        {rows.map((row) => (
          <div key={row.key} className={styles.row}>
            <div>
              <dt className={styles.label}>{row.label}</dt>
              <dd className={`${styles.value} ${row.className ?? ""}`}>{row.value}</dd>
            </div>
            <button type="button" className={`btn btn--secondary btn--sm ${styles.copy}`} onClick={() => void copy(row)} aria-label={`Copy ${row.copyAs}`}>
              {copied === row.key ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              <span aria-hidden="true">{copied === row.key ? "Copied" : "Copy"}</span>
            </button>
          </div>
        ))}
      </dl>
      <p role="status" aria-live="polite" className={styles.status}>{announcement}</p>
      <p className={styles.warning}>
        Always use your reference exactly. We will never change these details by email or message. If anything looks different, contact us before paying.
      </p>
    </section>
  );
}
