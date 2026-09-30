import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Card, CardHeader, CardBody, StatTile } from "./Card";

/**
 * The one surface primitive — a white card on the neutral app canvas (docs/DESIGN_SYSTEM.md's
 * "Card / CardHeader / CardBody / StatTile" row). `CardHeader`'s `action` slot and `StatTile`'s
 * optional `href` are the two variation points worth showing on their own.
 */
// No single `component:` binding — every story here composes Card with CardHeader/CardBody/
// StatTile (real, separately-exported siblings, not props of Card itself), so a story-level
// `render` is the correct shape throughout rather than args against one component.
const meta = {
  title: "UI/Card",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader title="Recent lessons" description="The last ten lessons across the platform." />
      <CardBody>
        <p>A card&apos;s body is free-form — a list, a form, a chart, whatever the section needs.</p>
      </CardBody>
    </Card>
  ),
};

export const WithHeaderAction: Story = {
  name: "With a header action",
  render: () => (
    <Card>
      <CardHeader
        title="Tuition assignments"
        description="The ongoing relationship between a tutor, their students and a subject."
        action={<button className="btn btn--primary">Create assignment</button>}
      />
      <CardBody>
        <p>Content goes here.</p>
      </CardBody>
    </Card>
  ),
};

export const WithoutDescription: Story = {
  render: () => (
    <Card>
      <CardHeader title="Quick create" />
      <CardBody>
        <p>A header can be title-only — `description` is optional.</p>
      </CardBody>
    </Card>
  ),
};

/** `as` swaps the rendered element (`section` by default) — `li` for a card inside a list, for example. */
export const AsListItem: Story = {
  name: 'as="li"',
  render: () => (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Card as="li">
        <CardBody>
          <p>Rendered as a real &lt;li&gt;, for a card that&apos;s genuinely one item in a list.</p>
        </CardBody>
      </Card>
    </ul>
  ),
};

export const StatTiles: Story = {
  name: "StatTile",
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "1rem" }}>
      <StatTile label="Active students" value={42} />
      <StatTile label="Lessons this week" value={128} hint="+12 vs last week" />
      <StatTile label="Reports owed" value={3} href="/dashboard/reports" />
    </div>
  ),
};

/** With `href`, StatTile renders as a real link — the whole tile is a target, not just its text. */
export const StatTileAsLink: Story = {
  name: "StatTile (linked)",
  render: () => <StatTile label="Reports owed" value={3} hint="Tap to review" href="/dashboard/reports" />,
};
