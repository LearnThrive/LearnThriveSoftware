import type { Metadata } from "next";
import { Plus, Users } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createClientAction } from "@/lib/actions/people";
import { PageHeader } from "@/components/shell/PageHeader";
import { PeopleTabs } from "@/components/people/PeopleTabs";
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/SearchInput";
import { formatLessonDayTime } from "@/lib/format";
import { matchesQuery, peopleCounts } from "@/lib/people/peopleHelpers";

export const metadata: Metadata = createMetadata({
  title: "Clients",
  description: "Parents and guardians.",
  path: "/dashboard/admin/people/clients",
});

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(["ADMIN"]);
  const { q = "" } = await searchParams;
  const data = getDataProvider();

  const [clients, lessons, counts] = await Promise.all([
    data.clients.list(), data.lessons.list(), peopleCounts(data),
  ]);

  const nowIso = new Date().toISOString();
  const studentsByClient = new Map<string, string[]>();
  for (const client of clients) {
    const linked = await data.students.studentsFor(client.id);
    studentsByClient.set(client.id, linked.map((student) => student.name));
  }

  const visible = clients.filter((client) => matchesQuery(q, client.name, client.email, ...(studentsByClient.get(client.id) ?? [])));

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Clients"
        description="The parents and guardians LearnThrive works with."
        actions={
          <Dialog
            trigger={<><Plus size={16} aria-hidden="true" />Add client</>}
            title="Add a client"
            description="The parent or guardian responsible for a student."
          >
            <form action={createClientAction} className="form">
              <Field label="Full name" htmlFor="client-name" required>
                <input id="client-name" name="name" required autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="client-email" required hint="Used to identify them and, later, to contact them.">
                <input id="client-email" name="email" type="email" required autoComplete="off" />
              </Field>
              <Field label="Phone" htmlFor="client-phone">
                <input id="client-phone" name="phone" type="tel" autoComplete="off" />
              </Field>
              <FormActions>
                <button type="submit" className="btn btn--primary">Add client</button>
              </FormActions>
            </form>
          </Dialog>
        }
      />

      <PeopleTabs current="clients" counts={counts} />

      <div className="list-toolbar">
        <SearchInput placeholder="Search clients or their children…" label="Search clients" />
        <p className="list-toolbar__count">{visible.length} of {clients.length}</p>
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={q ? `No clients match “${q}”` : "No clients yet"}
            description={q
              ? "Try a different name, email or child."
              : "Add a parent or guardian to link them to their children's tuition."}
          />
        ) : (
          <PersonList identityLabel="Client" columnLabels={["Children", "Next lesson"]}>
            {visible.map((client) => {
              const childNames = studentsByClient.get(client.id) ?? [];
              const next = lessons
                .filter((lesson) => lesson.status !== "CANCELLED" && lesson.clientIds.includes(client.id) && lesson.startAt >= nowIso)
                .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
              return (
                <PersonRow
                  key={client.id}
                  name={client.name}
                  subtitle={client.email}
                  href={`/dashboard/admin/clients/${client.id}`}
                  active={client.active}
                  columns={[
                    { label: "Children", value: childNames.join(", ") || "None linked" },
                    { label: "Next lesson", value: next ? formatLessonDayTime(next.startAt) : "None scheduled" },
                  ]}
                />
              );
            })}
          </PersonList>
        )}
      </Card>
    </>
  );
}
