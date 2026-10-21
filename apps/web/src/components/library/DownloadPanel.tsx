import Link from "next/link";
import type { AccessDecision } from "@learnthrive/data/library";
import styles from "./catalogue.module.css";

/**
 * The download box on a resource's page. The page decides what to show from `canAccess` (the same function the
 * download route uses, so the box can never promise what the route will refuse); the route is still the only gate.
 * The button is a plain form POST, so it works without JavaScript.
 */
export type DownloadView =
  | { kind: "signed_out" }
  | { kind: "decided"; decision: AccessDecision; hasFile: boolean };

const REASONS: Record<string, string> = {
  no_access: "Your account does not include this resource.",
  rate_limited: "You have reached the hourly download limit. Please try again a little later.",
  unavailable: "The download is not available right now. Please try again shortly, or email us.",
  no_file: "This resource has no file yet. Please email us and we will help.",
  not_found: "We could not find that resource.",
  adult_required: "Downloads are for adult account holders.",
};

export function downloadMessage(reason: string | string[] | undefined): string | null {
  const key = Array.isArray(reason) ? reason[0] : reason;
  return key && Object.hasOwn(REASONS, key) ? REASONS[key]! : null;
}

export function DownloadPanel({ slug, free, view, message }: { slug: string; free: boolean; view: DownloadView; message: string | null }) {
  const next = encodeURIComponent(`/library/${slug}`);
  return (
    <section className={styles.panel} aria-labelledby="download-heading">
      <h2 id="download-heading">Download</h2>
      {message ? (
        <p className={styles.notice} role="alert">
          {message}
        </p>
      ) : null}
      {view.kind === "signed_out" ? (
        <>
          <p>{free ? "This is a free sample. Sign in or create an account to download it." : "Sign in to download. This resource is included for enrolled students."}</p>
          <p>
            <Link className="button button--primary" href={`/login?next=${next}`}>
              <span>Sign in</span>
            </Link>{" "}
            <Link className="button button--secondary" href="/account/sign-up">
              <span>Create an account</span>
            </Link>
          </p>
        </>
      ) : view.decision.allowed ? (
        view.hasFile ? (
          <>
            <form method="post" action={`/api/library/download/${slug}`}>
              <button type="submit" className="button button--primary">
                <span>Download PDF</span>
              </button>
            </form>
            <p className={styles.small}>Your name and the date are printed on every page. Please do not share or resell it.</p>
          </>
        ) : (
          <p>This resource has no file yet. Please check back soon.</p>
        )
      ) : (
        <>
          <p>This resource is included for students enrolled with LearnThrive. A subscription for everyone else is coming soon.</p>
          <p>
            <Link className="text-link" href="/pricing">
              About the plan <span aria-hidden="true">→</span>
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
