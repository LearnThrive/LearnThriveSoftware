import Link from "next/link";

const TABS = [
  { href: "/dashboard/admin/people/students", label: "Students", key: "students" },
  { href: "/dashboard/admin/people/clients", label: "Clients", key: "clients" },
  { href: "/dashboard/admin/people/tutors", label: "Tutors", key: "tutors" },
] as const;

export type PeopleTab = (typeof TABS)[number]["key"];

export function PeopleTabs({ current, counts }: {
  current: PeopleTab;
  counts: Record<PeopleTab, number>;
}) {
  return (
    <nav className="filter-tabs" aria-label="People">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`filter-tab ${tab.key === current ? "is-active" : ""}`}
          aria-current={tab.key === current ? "page" : undefined}
        >
          {tab.label}
          <span className="filter-tab__count">{counts[tab.key]}</span>
        </Link>
      ))}
    </nav>
  );
}
