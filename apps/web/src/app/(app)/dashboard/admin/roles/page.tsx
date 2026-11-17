import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { EXCLUSIVE_PAIRS, ROLES, ROLE_LABELS, type Role } from "@learnthrive/data/roles";
import { requirePermission } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { accountRuntime } from "@/lib/account/runtime";
import { changeRolesAction } from "@/lib/actions/roles";
import { formatLessonDayTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { RoleEditor } from "@/components/people/RoleEditor";

export const metadata: Metadata = createMetadata({
  title: "Roles",
  description: "Who holds which roles, and the record of every change.",
  path: "/dashboard/admin/roles",
});

/** One line each, shown under the role's toggle. */
const DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Runs the platform: people, lessons and billing.",
  TUTOR: "Teaches their own students and lessons.",
  JUNIOR_TUTOR: "Attendance and draft reports for lessons they are given.",
  CLIENT: "A parent or guardian of a family.",
  STUDENT: "A learner.",
};

/**
 * Roles (docs/ROLE_PERMISSIONS.md). Administrators only. Choose one person from the searchable picker, then change their roles; one person at
 * a time keeps the page clear however many accounts there are. A person can hold several roles; what each lets them see is still decided by
 * their own records (their students, their family), never by the roles together. You cannot change your own roles, the last administrator
 * cannot lose the role, and every change is recorded with who made it, when, and the roles before and after.
 */
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const admin = await requirePermission("roles.assign");
  const { person: personId = "" } = await searchParams;
  const rt = await accountRuntime();
  if (!rt) {
    return <><PageHeader eyebrow="People" title="Roles" description="Accounts are not available on this server." /></>;
  }
  const [unsorted, history] = await Promise.all([rt.store.accounts.listProfiles(), rt.store.accounts.roleHistory(undefined, 25)]);
  const nameOf = (p: { displayName?: string | null; username?: string | null }) => p.displayName || p.username || "Unnamed";
  const people = [...unsorted].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const names = new Map(people.map((p) => [p.profileId, nameOf(p)]));
  const label = (id: string | null) => (id ? names.get(id) ?? "Someone removed" : "System");
  const list = (roles: readonly Role[]) => (roles.length > 0 ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "none");

  const selected = people.find((p) => p.profileId === personId) ?? null;
  const personHistory = selected ? await rt.store.accounts.roleHistory(selected.profileId, 10) : [];
  const counts = ROLES.map((role) => ({ role, count: people.filter((p) => p.roles.includes(role)).length }));
  const historyLine = (entry: (typeof history)[number], withTarget: boolean) =>
    `${formatLessonDayTime(entry.at.toISOString())}: ${label(entry.actorProfileId)} changed ${withTarget ? `${label(entry.targetProfileId)} ` : ""}from ${list(entry.before)} to ${list(entry.after)}.`;

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Roles"
        description="Choose a person, then turn their roles on or off. They only ever see their own students, family and lessons."
      />

      {people.length === 0 ? (
        <Card><CardBody><EmptyState title="No accounts yet" icon={<ShieldCheck size={20} />} description="People appear here once they have an account." /></CardBody></Card>
      ) : (
        <>
          <div className="roles-toolbar">
            <SearchSelect
              basePath="/dashboard/admin/roles"
              param="person"
              value={selected?.profileId ?? ""}
              caption="Person"
              placeholder="Choose a person"
              searchLabel="Find a person…"
              options={people.map((p) => ({
                id: p.profileId,
                name: nameOf(p),
                sub: [p.username, p.roles.length > 0 ? p.roles.map((r) => ROLE_LABELS[r]).join(", ") : "No roles"].filter(Boolean).join(" · "),
              }))}
            />
            <p className="roles-toolbar__summary">
              {people.length} {people.length === 1 ? "account" : "accounts"}
              {counts.filter((c) => c.count > 0).map((c) => <span key={c.role}> · {c.count} {ROLE_LABELS[c.role]}</span>)}
            </p>
          </div>

          {selected ? (
            <Card>
              <CardHeader
                title={
                  <span className="child-heading">
                    <Avatar name={nameOf(selected)} size="md" />
                    <span>{nameOf(selected)}{selected.username && <span className="child-heading__year">{selected.username}</span>}</span>
                  </span>
                }
                action={<>{selected.roles.map((role) => <Badge key={role} tone="info">{ROLE_LABELS[role]}</Badge>)}</>}
              />
              <CardBody>
                <RoleEditor
                  key={`${selected.profileId}:${selected.roles.join(",")}`}
                  profileId={selected.profileId}
                  roles={selected.roles}
                  order={ROLES}
                  labels={ROLE_LABELS}
                  descriptions={DESCRIPTIONS}
                  exclusive={EXCLUSIVE_PAIRS}
                  self={selected.profileId === admin.id}
                  action={changeRolesAction}
                />
                {personHistory.length > 0 && (
                  <div className="roles-person-history">
                    <h3 className="roles-person-history__title">Changes to {nameOf(selected)}</h3>
                    <ul className="plain-list">
                      {personHistory.map((entry, index) => <li key={index}>{historyLine(entry, false)}</li>)}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card className="card--empty">
              <EmptyState
                icon={<ShieldCheck size={22} />}
                title="Choose a person"
                description="Pick someone from the list above to see their roles and change them. Type a name, a username or a role to find them."
              />
            </Card>
          )}
        </>
      )}

      <details className="roles-history">
        <summary>Recent changes across everyone ({history.length})</summary>
        <p className="roles-history__note">
          Every change is kept: who, when, and the roles before and after. Never held together: {EXCLUSIVE_PAIRS.map(([a, b]) => `${ROLE_LABELS[a]} and ${ROLE_LABELS[b]}`).join("; ")}.
        </p>
        {history.length === 0 ? <p className="roles-history__note">No changes yet.</p> : (
          <ul className="plain-list">
            {history.map((entry, index) => <li key={index}>{historyLine(entry, true)}</li>)}
          </ul>
        )}
      </details>
    </>
  );
}
