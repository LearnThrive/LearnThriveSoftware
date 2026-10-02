import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AnnouncementBar } from "./AnnouncementBar";
import { Breadcrumbs } from "./Breadcrumbs";
import { BrandMark } from "./brand/BrandMark";
import { MotionToggle } from "./MotionToggle";
import { SubjectsFlyout } from "./SubjectsFlyout";
import { ThemeToggle } from "./ThemeToggle";
import { CommandPalette, type PaletteCommand } from "./palette/CommandPalette";
import { Stagger } from "./motion/primitives/Stagger";

/**
 * Plan 15's new primitives, in one place. Use the theme switch in the toolbar to see each in light and
 * dark; the a11y panel runs axe on every story.
 */
const meta = {
  title: "Plan 15/Primitives",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three-way theme control: the compact header button and the radio group used in the footer and the app. */
export const ThemeSwitch: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
      <ThemeToggle variant="cycle" />
      <ThemeToggle variant="radio" />
    </div>
  ),
};

/** System or Reduce. There is deliberately no "full motion" choice. */
export const MotionSwitch: Story = {
  render: () => <MotionToggle />,
};

/** The Subjects flyout inside a header-like frame: a disclosure beside the link, keyboard and touch operable. */
export const SubjectsFlyoutOpenable: Story = {
  render: () => (
    <nav className="primary-navigation" aria-label="Example navigation" style={{ minHeight: "20rem", alignItems: "flex-start" }}>
      <SubjectsFlyout current={false} transitionType="nav-forward" onNavigate={() => undefined} />
    </nav>
  ),
};

const COMMANDS: PaletteCommand[] = [
  { id: "p1", title: "Home", group: "Pages", href: "/", hint: "/" },
  { id: "p2", title: "About", group: "Pages", href: "/about", hint: "/about" },
  { id: "p3", title: "Safeguarding", group: "Pages", href: "/safeguarding", keywords: ["dbs", "safe"] },
  { id: "s1", title: "Maths tuition", group: "Subjects", href: "/maths-tuition", hint: "KS2 to A Level" },
  { id: "a1", title: "Send an enquiry", group: "Actions", href: "/book" },
  { id: "t1", title: "Switch to the dark theme", group: "Appearance", run: () => undefined },
];

/** The command palette, open. Type to filter, arrow keys to move, Enter to choose, Escape to close. */
export const Palette: Story = {
  render: () => (
    <CommandPalette open onClose={() => undefined} commands={COMMANDS} storageKey="storybook-palette" persist="session" shortcutLabel="Ctrl K" />
  ),
};

/** One array renders the visible trail and the structured data. */
export const BreadcrumbTrail: Story = {
  render: () => (
    <div className="page-hero" style={{ padding: "2rem" }}>
      <Breadcrumbs trail={[{ name: "Subjects", path: "/subjects" }, { name: "Maths tuition", path: "/maths-tuition" }]} />
    </div>
  ),
};

/** Off by default in lib/site.ts; shown here with a message and a link. */
export const Announcement: Story = {
  render: () => <AnnouncementBar announcement={{ text: "An example announcement.", href: "/book", linkLabel: "Book a free consultation" }} />,
};

/** The vector mark takes its two inks from `--brand-ink` and `--brand-green`, so one component fits any ground. */
export const BrandOnGrounds: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "1rem" }}>
      <div style={{ padding: "1.5rem", background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
        <BrandMark className="brand__mark" />
      </div>
      <div style={{ padding: "1.5rem", background: "var(--surface-inverse)", ["--brand-ink" as string]: "#eef4f8", ["--brand-green" as string]: "#5fd08e" }}>
        <BrandMark className="brand__mark" />
      </div>
    </div>
  ),
};

/** A staggered arrival: children rise in order, 90 ms apart (static under reduced motion). */
export const StaggeredCards: Story = {
  render: () => (
    <Stagger>
      {["One", "Two", "Three"].map((label) => (
        <div key={label} className="feature-card" style={{ padding: "1rem", marginBottom: "0.5rem" }}>
          {label}
        </div>
      ))}
    </Stagger>
  ),
};
