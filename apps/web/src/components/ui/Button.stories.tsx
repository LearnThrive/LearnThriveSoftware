import type { Meta, StoryObj } from "@storybook/nextjs-vite";

/**
 * The one tactile-press treatment shared by every button-shaped control in the product
 * (docs/DESIGN_SYSTEM.md's Motion section: hover lifts 1px, press drops to scale(0.97)). There is
 * no `<Button>` React component — every button in the app is a plain `<button className="btn
 * btn--...">`, styled entirely by app-components.css. These stories document that class
 * vocabulary directly, the same way the app itself uses it, rather than inventing a wrapper
 * component Storybook-only.
 */
const meta = {
  title: "UI/Buttons",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tones: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      <button className="btn btn--primary">Primary</button>
      <button className="btn btn--secondary">Secondary</button>
      <button className="btn btn--ghost">Ghost</button>
      <button className="btn btn--danger">Danger</button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
      <button className="btn btn--primary">Default</button>
      <button className="btn btn--primary btn--sm">Small</button>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      <button className="btn btn--primary" disabled>Primary</button>
      <button className="btn btn--secondary" disabled>Secondary</button>
      <button className="btn btn--danger" disabled>Danger</button>
    </div>
  ),
};

export const Block: Story = {
  name: "btn--block (full width)",
  render: () => (
    <div style={{ maxWidth: "20rem" }}>
      <button className="btn btn--primary btn--block">Save changes</button>
    </div>
  ),
};

/** An in-flight async action — the spinner is capped to 0.01ms under reduced motion by the
 * sitewide blanket rule, not a per-component opt-in. */
export const Loading: Story = {
  render: () => (
    <button className="btn btn--primary" disabled aria-busy="true">
      <span className="btn__spinner" aria-hidden="true" style={{ width: "1rem", height: "1rem", border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block" }} />
      Signing in…
    </button>
  ),
};

/** The dialog trigger carries its own matching tone vocabulary (Dialog.tsx's `tone` prop) rather
 * than reusing `.btn` — see the Dialog stories for it composed with the modal it opens. */
export const DialogTriggers: Story = {
  name: "Dialog triggers",
  render: () => (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      <button className="dialog-trigger dialog-trigger--primary" type="button">Create assignment</button>
      <button className="dialog-trigger dialog-trigger--secondary" type="button">Edit</button>
      <button className="dialog-trigger dialog-trigger--danger" type="button">Cancel lesson</button>
    </div>
  ),
};
