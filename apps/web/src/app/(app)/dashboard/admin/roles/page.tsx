import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { EXCLUSIVE_PAIRS, ROLES, ROLE_LABELS, type Role } from "@learnthrive/data/roles";
import { requirePermission } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { accountRuntime } from "@/lib/account/runtime";
import { changeRolesAction } from "@/lib/actions/roles";
import { formatLessonDayTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = createMetadata({
  title: "Roles",
  description: "Who holds which roles, and the record of every change.",
  path: "/dashboard/admin/roles",
});

const NOTES: Partial<Record<Role, string>> = {
  JUNIOR_TUTOR: "A narrower tutor: takes attendance and drafts reports for the lessons they are given. Cannot be held with Tutor.",
  CLIENT: "A parent or guardian. Cannot be held with Student.",
};

/**
 * Roles (docs/ROLE_PERMISSIONS.md). Administrators only. A person can hold several roles; what each lets them see is still decided by their
 * own records (their students, their family), never by the roles together. You cannot change your own roles, the last administrator cannot
 * lose the role, and every change below is recorded with who made it, when, and the roles before and after.
 */
export default async function RolesPage() {
  const admin = await requirePermission("roles.assign");
  const rt = await accountRuntime();
  if (!rt) {
    return <><PageHeader eyebrow="People" title="Roles" description="Accounts are not available on this server." /></>;
  }
  const [people, history] = await Promise.all([rt.store.accounts.listProfiles(), rt.store.accounts.roleHistory(undefined, 25)]);
  const names = new Map(people.map((p) => [p.profileId, p.displayName || p.username || "Unnamed"]));
  const label = (id: string | null) => (id ? names.get(id) ?? "Someone removed" : "System");
  const list = (roles: readonly Role[]) => (roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "none");

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Roles"
        description="Add or remove a role. A person's access is what all their roles allow together, but they only ever see their own students, family and lessons."
      />
      {people.length === 0 ? (
        <Card><CardBody><EmptyState title="No accounts yet" icon={<ShieldCheck size={20} />} description="People appear here once they have an account." /></CardBody></Card>
      ) : (
        people.map((person) => {
          const self = person.profileId === admin.id;
          return (
            <Card key={person.profileId}>
              <CardHeader
                title={person.displayName || person.username || "Unnamed"}
                description={person.username ?? undefined}
                action={<>{person.roles.map((role) => <Badge key={role} tone="info">{ROLE_LABELS[role]}</Badge>)}</>}
              />
              <CardBody>
                <form action={changeRolesAction} className="form">
                  <input type="hidden" name="profileId" value={person.profileId} />
                  <fieldset disabled={self}>
                    <legend>Roles</legend>
                    {ROLES.map((role) => (
                      <label key={role} className="checkbox-row">
                        <input type="checkbox" name="roles" value={role} defaultChecked={person.roles.includes(role)} />
                        <span>{ROLE_LABELS[role]}{NOTES[role] ? <small> — {NOTES[role]}</small> : null}</span>
                      </label>
                    ))}
                  </fieldset>
                  {self ? <p className="form__hint">You cannot change your own roles. Ask another administrator.</p> : <button type="submit" className="btn btn--secondary">Save roles</button>}
                </form>
              </CardBody>
            </Card>
          );
        })
      )}
      <Card>
        <CardHeader title="Recent changes" description={`Every change is kept: who, when, and the roles before and after. Never allowed together: ${EXCLUSIVE_PAIRS.map(([a, b]) => `${ROLE_LABELS[a]} and ${ROLE_LABELS[b]}`).join("; ")}.`} />
        <CardBody>
          {history.length === 0 ? <p>No changes yet.</p> : (
            <ul className="plain-list">
              {history.map((entry, index) => (
                <li key={index}>
                  {formatLessonDayTime(entry.at.toISOString())}: {label(entry.actorProfileId)} changed {label(entry.targetProfileId)} from {list(entry.before)} to {list(entry.after)}.
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
