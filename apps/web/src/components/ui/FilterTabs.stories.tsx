import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FilterTabs, type FilterOption } from "./FilterTabs";

/**
 * Tab-style filters backed by a real URL query parameter, not client state (docs/DESIGN_SYSTEM.md)
 * — a filtered view is linkable, survives a reload, and works with browser Back. The underline
 * slides between tabs via a small ResizeObserver measurement; each tab's own border-bottom-color
 * is the always-correct fallback if it hasn't measured yet or the tabs wrap onto two lines.
 */
const meta = {
  title: "UI/FilterTabs",
  component: FilterTabs,
  tags: ["autodocs"],
} satisfies Meta<typeof FilterTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const STATUS_OPTIONS: FilterOption[] = [
  { value: "all", label: "All", count: 24 },
  { value: "active", label: "Active", count: 18 },
  { value: "paused", label: "Paused", count: 4, tone: "warning" },
  { value: "ended", label: "Ended", count: 2 },
];

export const Default: Story = {
  args: { basePath: "/dashboard/admin/people/students", param: "status", current: "all", options: STATUS_OPTIONS },
};

export const MiddleTabActive: Story = {
  args: { basePath: "/dashboard/admin/people/students", param: "status", current: "paused", options: STATUS_OPTIONS },
};

export const LastTabActive: Story = {
  args: { basePath: "/dashboard/admin/people/students", param: "status", current: "ended", options: STATUS_OPTIONS },
};

/** A tab count can carry a `warning` tone — used when a filter surfaces something needing attention. */
export const WithWarningTone: Story = {
  name: "With a warning-tone count",
  args: { basePath: "/dashboard/admin/people/students", param: "status", current: "all", options: STATUS_OPTIONS },
};

/** Without counts — the tabs alone. */
export const WithoutCounts: Story = {
  args: {
    basePath: "/dashboard/admin/people/tutors",
    param: "view",
    current: "active",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
  },
};

/** Enough options to wrap onto a second line on a narrow container — the indicator hides itself
 * and each tab's own border-bottom is what shows (FilterTabs.tsx's own comment on this behaviour). */
export const NarrowWrapping: Story = {
  name: "Narrow container (wraps, indicator hides)",
  decorators: [(Story) => <div style={{ maxWidth: "20rem" }}><Story /></div>],
  args: {
    basePath: "/dashboard/admin/people/students",
    param: "status",
    current: "ended",
    options: [
      { value: "all", label: "All students", count: 24 },
      { value: "active", label: "Currently active", count: 18 },
      { value: "paused", label: "Temporarily paused", count: 4, tone: "warning" },
      { value: "ended", label: "No longer enrolled", count: 2 },
    ],
  },
};
