import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatDateOnly } from "@/lib/format";
import { LOGIN_LABELS, type LoginStatus } from "@/lib/people/loginStatus";

const TONE: Record<LoginStatus["state"], BadgeTone> = { none: "muted", never: "critical", temporary: "warning", set: "positive" };

/** One person's login in a list column: whether they chose their own password, and when they last signed in. */
export function LoginStatusBadge({ status }: { status: LoginStatus | undefined }) {
  const s = status ?? { state: "none" as const, lastSignIn: null };
  return (
    <span className="login-status">
      <Badge tone={TONE[s.state]}>{LOGIN_LABELS[s.state]}</Badge>
      {s.lastSignIn && <span className="login-status__last"> · last in {formatDateOnly(s.lastSignIn)}</span>}
    </span>
  );
}

/** "3 of 5 with a login have set their own password", for the list's toolbar. */
export function loginSummary(statuses: Array<LoginStatus | undefined>): string {
  const total = statuses.filter((s) => s && s.state !== "none").length;
  const set = statuses.filter((s) => s?.state === "set").length;
  return `${set} of ${total} with a login have set their own password`;
}
