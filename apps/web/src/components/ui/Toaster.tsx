"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

/**
 * Success/error feedback for actions that end in a redirect (plan6 section 37: "do not rely on
 * invisible server redirects as user feedback").
 *
 * The message travels in the URL (`?toast=Tutor+added`) because the Server Actions here redirect
 * rather than return to the page that called them — there is no client state that survives that
 * hop. The parameter is stripped from the URL as soon as it's shown, so a refresh or a shared
 * link doesn't resurrect a stale confirmation.
 */
export function Toaster() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const message = params.get("toast");
  const error = params.get("toastError");
  const incoming = error ?? message;

  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  // Adjusted during render rather than in an effect: the toast is derived from the URL, and
  // React's own guidance is to compute state from props/params here instead of firing an extra
  // render pass from an effect. `handled` makes it happen exactly once per distinct message.
  if (incoming && incoming !== handled) {
    setHandled(incoming);
    setToast({ message: incoming, tone: error ? "error" : "success" });
  }

  useEffect(() => {
    if (!toast) return;
    // Strip the parameter so a reload or shared link doesn't show the confirmation again.
    if (incoming) {
      const next = new URLSearchParams(params.toString());
      next.delete("toast");
      next.delete("toastError");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
    const timer = setTimeout(() => setToast(null), toast.tone === "error" ? 8000 : 5000);
    return () => clearTimeout(timer);
    // `params` is a fresh object every render; the message itself is what should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, incoming, pathname]);

  if (!toast) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      <div className={`toast toast--${toast.tone}`}>
        {toast.tone === "success"
          ? <CheckCircle2 size={18} aria-hidden="true" />
          : <AlertCircle size={18} aria-hidden="true" />}
        <p>{toast.message}</p>
        <button type="button" className="toast__dismiss" onClick={() => setToast(null)} aria-label="Dismiss">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
