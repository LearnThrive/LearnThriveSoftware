import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Avatar } from "./Avatar";

/**
 * Initials-only identity mark — no photo uploads anywhere in the product (Avatar.tsx's own
 * comment). Tint is derived from the name, so the same person reads consistently across every
 * list they appear in.
 */
const meta = {
  title: "UI/Avatar",
  component: Avatar,
  tags: ["autodocs"],
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;
// These two render several Avatars at once rather than driving one through args.
type ShowcaseStory = StoryObj;

export const Default: Story = { args: { name: "Alvi Hossain" } };
export const Small: Story = { args: { name: "Alvi Hossain", size: "sm" } };
export const Large: Story = { args: { name: "Alvi Hossain", size: "lg" } };

/** A single word still gets two letters — never a lone initial. */
export const SingleWordName: Story = { args: { name: "Cher" } };

/** A parenthesised suffix (a real seeded-data shape) doesn't leak into the initials. */
export const NameWithSuffix: Story = { args: { name: "Alvi Hossain (Admin)" } };

/** The tint is deterministic per name, so a list of different people shows a real spread of colours. */
export const NameSpread: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", gap: "0.75rem" }}>
      {["Alvi Hossain", "Priya Sharma", "Marcus Webb", "Fatima Khan", "Jordan Lee"].map((name) => (
        <Avatar key={name} name={name} />
      ))}
    </div>
  ),
};

export const AllSizes: ShowcaseStory = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <Avatar name="Alvi Hossain" size="sm" />
      <Avatar name="Alvi Hossain" size="md" />
      <Avatar name="Alvi Hossain" size="lg" />
    </div>
  ),
};
