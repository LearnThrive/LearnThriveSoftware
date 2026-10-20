import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PencilLoader, ThinkingIndicator } from "./PencilLoader";

/**
 * The loading and "thinking" indicator (converted from Uiverse.io by gustavofusco). Decorative SVG inside
 * a status element whose only text is hidden, or visible for ThinkingIndicator. Animation is
 * transform and stroke-dashoffset only, pauses off screen, and is a still pencil under every reduce path.
 */
const meta = {
  title: "UI/PencilLoader",
  component: PencilLoader,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    label: { control: "text" },
  },
} satisfies Meta<typeof PencilLoader>;

export default meta;
type Story = StoryObj<typeof meta>;
// These render several indicators at once rather than driving one through args.
type ShowcaseStory = StoryObj;

export const Default: Story = { args: {} };

export const Sizes: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", gap: "2rem", alignItems: "center", flexWrap: "wrap" }}>
      <PencilLoader size="sm" />
      <PencilLoader size="md" />
      <PencilLoader size="lg" />
    </div>
  ),
};

/** The label is what a screen reader announces; it is not shown. */
export const WithLabel: Story = { args: { label: "Loading your library", size: "md" } };

export const Thinking: ShowcaseStory = {
  render: () => <ThinkingIndicator />,
};

/** Each instance gets its own clip id, so several on one page never share or clash. */
export const ManyInstances: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
      <PencilLoader size="sm" />
      <PencilLoader size="sm" label="Loading results" />
      <ThinkingIndicator />
    </div>
  ),
};

export const Dark: Story = { args: {}, globals: { theme: "dark" } };

/** Applies the visitor's "Reduce motion" choice (html[data-motion="reduce"]) for the story. */
function ReduceMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-motion", "reduce");
    return () => root.removeAttribute("data-motion");
  }, []);
  return children;
}

/** Reduced motion: the same indicator as a still pencil. */
export const ReducedMotion: ShowcaseStory = {
  render: () => (
    <ReduceMotion>
      <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
        <PencilLoader />
        <ThinkingIndicator />
      </div>
    </ReduceMotion>
  ),
};
