"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Plan section 98's reset button — Admin-only, development-only (the route itself refuses in
// production regardless of who's asking). Confirms first: this discards every Tutor/Client/
// Student/Lesson/report/notification created beyond the fixed seed scenario during this session.
export function ResetDevDataButton() {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  async function handleReset() {
    if (!window.confirm("Reset all development data back to the seeded demo scenario? Anything added or changed this session will be lost.")) return;
    setResetting(true);
    try {
      await fetch("/api/dev/reset", { method: "POST" });
      router.refresh();
    } finally {
      setResetting(false);
    }
  }

  return (
    <button type="button" className="button-text" onClick={handleReset} disabled={resetting}>
      <span>{resetting ? "Resetting…" : "Reset demo data"}</span>
    </button>
  );
}
