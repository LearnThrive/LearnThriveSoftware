import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge, StatusBadge, type BadgeTone } from "./Badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    tone: {
      control: "select",
      options: ["neutral", "positive", "warning", "critical", "info", "muted"] satisfies BadgeTone[],
    },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;
// StatusBadge is a real sibling export, not a Badge prop — these two stories compose it directly
// rather than driving it through Badge's own args, so they're typed as plain, unbound StoryObj.
type ShowcaseStory = StoryObj;

export const Neutral: Story = { args: { tone: "neutral", children: "Neutral" } };
export const Positive: Story = { args: { tone: "positive", children: "Positive" } };
export const Warning: Story = { args: { tone: "warning", children: "Warning" } };
export const Critical: Story = { args: { tone: "critical", children: "Critical" } };
export const Info: Story = { args: { tone: "info", children: "Info" } };
export const Muted: Story = { args: { tone: "muted", children: "Muted" } };

/** Every tone at once, the way a page reviewing statuses would actually see them together. */
export const AllTones: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      <Badge tone="neutral">Neutral</Badge>
      <Badge tone="positive">Positive</Badge>
      <Badge tone="warning">Warning</Badge>
      <Badge tone="critical">Critical</Badge>
      <Badge tone="info">Info</Badge>
      <Badge tone="muted">Muted</Badge>
    </div>
  ),
};

/** StatusBadge picks its own tone from a real domain status string — see Badge.tsx's STATUS_TONES. */
export const StatusBadgeExamples: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
      {["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "SUBMITTED", "APPROVED"].map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
