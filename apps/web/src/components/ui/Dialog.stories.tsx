import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { Dialog } from "./Dialog";

/**
 * The one modal pattern in the product (docs/DESIGN_SYSTEM.md) — focus moves in and is trapped
 * while open, returns to the trigger on close, Escape and the backdrop both close it. `tone` sets
 * what the dialog leads to, so a destructive flow doesn't present itself as a green primary
 * action; it's the only confirmation pattern in the product — never `window.confirm()`.
 */
const meta = {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  argTypes: {
    tone: { control: "select", options: ["primary", "danger", "secondary"] },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed by default — the trigger is a real `<button>`, styled however the page needs. */
export const Closed: Story = {
  args: {
    trigger: "Create assignment",
    title: "Create a tuition assignment",
    description: "Pair a tutor with one or more students for a subject.",
    tone: "primary",
    children: (
      <div className="form">
        <p>Form fields go here.</p>
      </div>
    ),
  },
};

/** The dialog after its trigger is clicked — focus moves to the first focusable element inside. */
export const Open: Story = {
  args: { ...Closed.args },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Create assignment" }));
    // Not toBeVisible(): the panel opens via a 220ms `dialog-in` CSS animation starting at
    // opacity: 0 (app-components.css), and jest-dom's toBeVisible() checks computed opacity — a
    // real, reproducible race against that animation's first frame, not a product bug. Presence
    // in the document is what this story is actually verifying.
    await expect(await canvas.findByRole("dialog")).toBeInTheDocument();
  },
};

/** A destructive flow — the trigger and panel both carry `danger`, not the default green primary. */
export const DangerTone: Story = {
  name: "Danger tone (open)",
  args: {
    trigger: "Cancel lesson",
    title: "Cancel this lesson?",
    description: "The student and tutor will both be notified. This can't be undone.",
    tone: "danger",
    children: (
      <div className="form-actions">
        <button className="btn btn--secondary" type="button">Keep lesson</button>
        <button className="btn btn--danger" type="button">Cancel lesson</button>
      </div>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Cancel lesson" }));
  },
};

/** A realistic multi-field form inside the body — the actual shape a create/edit dialog takes. */
export const WithForm: Story = {
  name: "With a form (open)",
  args: {
    trigger: "Create assignment",
    title: "Create a tuition assignment",
    description: "Pair a tutor with one or more students for a subject.",
    tone: "primary",
    children: (
      <form className="form">
        <div className="field">
          <label className="field__label" htmlFor="story-title">
            Title
            <span className="field__required" aria-hidden="true">*</span>
          </label>
          <input id="story-title" required autoComplete="off" placeholder="GCSE Mathematics — Brian" />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="story-subject">
            Subject
            <span className="field__required" aria-hidden="true">*</span>
          </label>
          <input id="story-subject" required autoComplete="off" />
        </div>
        <div className="form-actions">
          <button className="btn btn--primary" type="submit">Create assignment</button>
        </div>
      </form>
    ),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Create assignment" }));
  },
};
