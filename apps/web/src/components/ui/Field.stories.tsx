import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Field, FieldSet, FormActions } from "./Field";

/**
 * One label/hint/error/control style for every form in the product (docs/DESIGN_SYSTEM.md).
 * `FieldSet` groups related fields within a longer form; `FormActions` is the trailing
 * button row every form ends with.
 */
// No single `component:` binding — several stories compose Field with FieldSet/FormActions
// (real, separately-exported siblings), so story-level `render` is correct throughout.
const meta = {
  title: "UI/Field",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Required: Story = {
  render: () => (
    <Field label="Title" htmlFor="story-title" required hint="How it appears throughout the product.">
      <input id="story-title" autoComplete="off" />
    </Field>
  ),
};

export const Optional: Story = {
  render: () => (
    <Field label="Level" htmlFor="story-level" hint="For example GCSE or A-Level.">
      <input id="story-level" autoComplete="off" />
    </Field>
  ),
};

/** `error` replaces the hint and marks the field invalid — `role="alert"` on the message. */
export const ValidationError: Story = {
  render: () => (
    <Field label="Email address" htmlFor="story-email" required error="Enter a valid email address.">
      <input id="story-email" type="email" autoComplete="off" defaultValue="not-an-email" />
    </Field>
  ),
};

export const WithSelect: Story = {
  render: () => (
    <Field label="Tutor" htmlFor="story-tutor" required>
      <select id="story-tutor" defaultValue="">
        <option value="" disabled>Choose a tutor</option>
        <option value="1">Priya Sharma</option>
        <option value="2">Marcus Webb</option>
      </select>
    </Field>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <Field label="Notes" htmlFor="story-notes" hint="Visible to the tutor and admin only.">
      <textarea id="story-notes" rows={4} />
    </Field>
  ),
};

/** A grouped section within a longer form — a legend, an optional description, related fields. */
export const InFieldSet: Story = {
  name: "FieldSet",
  render: () => (
    <FieldSet legend="Contact details" description="Where and how to reach this person.">
      <Field label="Email" htmlFor="story-fs-email" required>
        <input id="story-fs-email" type="email" autoComplete="off" />
      </Field>
      <Field label="Phone" htmlFor="story-fs-phone">
        <input id="story-fs-phone" type="tel" autoComplete="off" />
      </Field>
    </FieldSet>
  ),
};

/** The trailing action row every form ends with. */
export const Actions: Story = {
  name: "FormActions",
  render: () => (
    <FormActions>
      <button className="btn btn--primary" type="submit">Save changes</button>
      <button className="btn btn--ghost" type="button">Cancel</button>
    </FormActions>
  ),
};

/** A complete small form composed from all three primitives together. */
export const CompleteForm: Story = {
  render: () => (
    <form className="form form--stacked" style={{ maxWidth: "28rem" }}>
      <FieldSet legend="Assignment details">
        <Field label="Title" htmlFor="story-full-title" required hint="e.g. GCSE Mathematics — Brian.">
          <input id="story-full-title" autoComplete="off" />
        </Field>
        <Field label="Subject" htmlFor="story-full-subject" required>
          <input id="story-full-subject" autoComplete="off" />
        </Field>
      </FieldSet>
      <FieldSet legend="Assign to" description="Who this assignment pairs together.">
        <Field label="Tutor" htmlFor="story-full-tutor" required>
          <select id="story-full-tutor" defaultValue="">
            <option value="" disabled>Choose a tutor</option>
            <option value="1">Priya Sharma</option>
          </select>
        </Field>
      </FieldSet>
      <FormActions>
        <button className="btn btn--primary" type="submit">Create assignment</button>
      </FormActions>
    </form>
  ),
};
