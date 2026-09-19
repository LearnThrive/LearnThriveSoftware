"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { FormActions } from "@/components/ui/Field";

// Plan section 98's reset button — Admin-only, development-only (the route itself refuses in
// production regardless of who's asking). Confirms first: this discards every Tutor/Client/
// Student/Lesson/report/notification created beyond the fixed seed scenario during this session.
//
// Confirmation goes through the app's own Dialog rather than window.confirm(): the native dialog
// is unstyled, unbrandable, and the only place in the product that asked for confirmation that
// way. This button also used to carry a `button-text` class that exists in no stylesheet, so it
// rendered as a bare browser-default button on an otherwise fully styled Settings page.
export function ResetDevDataButton() {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    setResetting(true);
    try {
      await fetch("/api/dev/reset", { method: "POST" });
      router.refresh();
    } finally {
      setResetting(false);
    }
  }

  return (
    <Dialog
      trigger={resetting ? "Resetting…" : "Reset demo data"}
      tone="danger"
      title="Reset the demo data?"
      description="Everything created while trying the product out is discarded and the original seeded scenario comes back."
    >
      <p className="form-hint" style={{ marginTop: 0 }}>
        People, lessons, reports and notifications all return to the seeded demo scenario. This
        can&apos;t be undone — though nothing here is real data.
      </p>
      <FormActions>
        <button type="button" className="btn btn--danger" onClick={handleReset} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset demo data"}
        </button>
      </FormActions>
    </Dialog>
  );
}
