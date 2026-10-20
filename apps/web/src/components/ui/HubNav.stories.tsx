import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { HubNav, hubNavItems } from "./HubNav";

/**
 * The signed-in Library area's icon menu. A bottom bar under 64rem, a side rail from 64rem. The stories use
 * `placement="inline"` (normal flow) so several can sit on one docs page; the real layout uses the default
 * `fixed`. Resize the canvas (or pick a viewport) to see the bar become a rail.
 */
const meta = {
  title: "UI/HubNav",
  component: HubNav,
  tags: ["autodocs"],
  args: { placement: "inline", current: "/library" },
  argTypes: {
    current: { control: "select", options: hubNavItems.map((item) => item.href) },
    placement: { control: "inline-radio", options: ["fixed", "inline"] },
  },
} satisfies Meta<typeof HubNav>;

export default meta;
type Story = StoryObj<typeof meta>;
type ShowcaseStory = StoryObj;

/** Hover or Tab onto any item to open its label; the current item is open until you do. */
export const Default: Story = {};

/** One menu per current item. */
export const EveryCurrentItem: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem 10rem", paddingBlockEnd: "11rem" }}>
      {hubNavItems.map((item) => (
        <HubNav key={item.href} placement="inline" current={item.href} ariaLabel={`Library, ${item.label} current`} />
      ))}
    </div>
  ),
};

/** Under 64rem: a bar whose items share the width. */
export const NarrowBottomBar: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/** From 64rem: a rail; the open item overlays the page, so nothing shifts. */
export const DesktopRail: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
  globals: { viewport: { value: "desktop", isRotated: false } },
  decorators: [(Story) => <div style={{ minBlockSize: "22rem" }}>{Story()}</div>],
};

export const Dark: Story = { globals: { theme: "dark" } };

/** Applies the visitor's "Reduce motion" choice (html[data-motion="reduce"]) for the story. */
function ReduceMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-motion", "reduce");
    return () => root.removeAttribute("data-motion");
  }, []);
  return children;
}

/** Reduced motion: labels open and close with no transition. */
export const ReducedMotion: Story = {
  render: (args) => (
    <ReduceMotion>
      <HubNav {...args} />
    </ReduceMotion>
  ),
};
