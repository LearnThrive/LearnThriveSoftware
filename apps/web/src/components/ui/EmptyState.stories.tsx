import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Activity, ClipboardList } from "lucide-react";
import { EmptyState } from "./EmptyState";

/**
 * Purposeful empty states (docs/DESIGN_SYSTEM.md) — what would be here, why it matters, the
 * action that fills it. Never a bare "Tutors (0)". `icon` is recommended: without one the card is
 * a paragraph floating in whitespace.
 */
const meta = {
  title: "UI/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;
// InEmptyCard wraps EmptyState in a real .card--empty container rather than driving it through
// EmptyState's own args.
type ShowcaseStory = StoryObj;

/** The minimum: a title alone still reads, but description/action/icon are what make it purposeful. */
export const TitleOnly: Story = {
  args: { title: "Nothing scheduled" },
};

export const WithDescription: Story = {
  args: {
    title: "Nothing scheduled",
    description: "Schedule a lesson against this assignment to get started.",
  },
};

/** A real usage (dashboard/activity/page.tsx): icon, title, description and an action together. */
export const WithIconAndAction: Story = {
  args: {
    icon: <Activity size={22} />,
    title: "No activity yet",
    description: "Scheduling a lesson, marking attendance or approving a report will all show up here.",
    action: <a className="btn btn--primary" href="#">Schedule a lesson</a>,
  },
};

/** The empty state changes its own message when a search filter is active — a real pattern from
 * admin/assignments, not a hypothetical. */
export const FilteredSearchNoResults: Story = {
  name: "Filtered search, no results",
  args: {
    icon: <ClipboardList size={22} />,
    title: 'No assignments match "gcse physic"',
    description: "Try a different title, subject, tutor or student.",
  },
};

/** `.card--empty` (see docs/DESIGN_SYSTEM.md's "Measure and density") is the generous density,
 * for a card whose entire content is the empty state. */
export const InEmptyCard: ShowcaseStory = {
  name: "Inside .card--empty",
  render: () => (
    <div className="card card--empty">
      <EmptyState
        icon={<ClipboardList size={22} />}
        title="No tuition assignments yet"
        description="Create one to pair a tutor with a student, then schedule lessons against it."
        action={<button className="btn btn--primary">Create assignment</button>}
      />
    </div>
  ),
};
