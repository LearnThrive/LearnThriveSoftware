import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PageHeader, Breadcrumbs, BackLink } from "./PageHeader";

/**
 * The one page header every authenticated page uses (docs/DESIGN_SYSTEM.md) — optional back link
 * and breadcrumbs, an eyebrow for context, the title, a supporting line, and primary/secondary
 * actions. Breadcrumbs are deliberately opt-in per page, not derived from the URL — a trail on a
 * top-level page is noise.
 */
const meta = {
  title: "Shell/PageHeader",
  component: PageHeader,
  tags: ["autodocs"],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;
// Breadcrumbs/BackLink are real sibling exports, not PageHeader props — the three stories that
// show them alone compose them directly rather than driving them through PageHeader's own args.
type ShowcaseStory = StoryObj;

export const Minimal: Story = {
  args: { title: "Activity", eyebrow: "Operations", description: "What's been happening across lessons, attendance and reports." },
};

export const TitleOnly: Story = {
  args: { title: "Settings" },
};

export const WithPrimaryAction: Story = {
  name: "With a primary action",
  args: {
    eyebrow: "Tuition",
    title: "Tuition assignments",
    description: "The ongoing relationship between a tutor, their students and a subject. Lessons are scheduled against these.",
    actions: <button className="btn btn--primary">Create assignment</button>,
  },
};

/** A nested detail page: back link, breadcrumb trail and a meta line together. */
export const NestedWithBreadcrumbs: Story = {
  name: "Nested (back link + breadcrumbs)",
  args: {
    backTo: { href: "/dashboard/admin/assignments", label: "Back to assignments" },
    breadcrumbs: [
      { label: "Tuition", href: "/dashboard/admin/assignments" },
      { label: "Assignments", href: "/dashboard/admin/assignments" },
      { label: "GCSE Mathematics — Brian" },
    ],
    title: "GCSE Mathematics — Brian",
    description: "Priya Sharma is paired with Brian Chen for GCSE Mathematics.",
    meta: <span className="badge badge--positive">Active</span>,
    actions: <button className="btn btn--secondary">Edit</button>,
  },
};

export const LongTitleAndDescription: Story = {
  name: "Long title and description",
  args: {
    eyebrow: "Tuition",
    title: "A-Level Further Mathematics — Comprehensive Preparation Programme",
    description:
      "A long-running assignment covering the full A-Level Further Mathematics syllabus across two years, including mechanics, statistics and pure mathematics modules, with weekly progress reviews and termly mock examinations.",
    actions: (
      <>
        <button className="btn btn--secondary">Archive</button>
        <button className="btn btn--primary">Edit</button>
      </>
    ),
  },
};

export const BreadcrumbsOnly: ShowcaseStory = {
  name: "Breadcrumbs",
  render: () => (
    <Breadcrumbs
      trail={[
        { label: "Tuition", href: "/dashboard/admin/assignments" },
        { label: "Assignments", href: "/dashboard/admin/assignments" },
        { label: "GCSE Mathematics — Brian" },
      ]}
    />
  ),
};

/** An empty trail renders nothing — breadcrumbs are opt-in, never forced. */
export const BreadcrumbsEmpty: ShowcaseStory = {
  name: "Breadcrumbs (empty trail)",
  render: () => <Breadcrumbs trail={[]} />,
};

export const BackLinkOnly: ShowcaseStory = {
  name: "BackLink",
  render: () => <BackLink href="/dashboard/admin/assignments" label="Back to assignments" />,
};
