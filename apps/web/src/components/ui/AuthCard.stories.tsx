import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AuthCard } from "./AuthCard";

function ForceReducedMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-motion", "reduce");
    return () => root.removeAttribute("data-motion");
  }, []);
  return children;
}

/**
 * The sign-in / sign-up card. Controlled and presentational: values go out through `onSubmit`, answers come
 * back through `errors`. Email and password only (no "remember me"), and the Google and Apple buttons appear
 * only when `providers` turns them on. The client checks are a convenience; the server owns validation.
 */
const meta = {
  title: "UI/AuthCard",
  component: AuthCard,
  tags: ["autodocs"],
  args: { mode: "sign-in", onSubmit: fn(), onModeChange: fn(), onProvider: fn() },
  decorators: [
    (Story) => (
      <div style={{ padding: "1.5rem", display: "grid", justifyItems: "center" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AuthCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};

export const SignUp: Story = { args: { mode: "sign-up" } };

export const Reset: Story = { args: { mode: "reset" } };

export const VerifySent: Story = { args: { mode: "verify-sent", onResend: fn() } };

/** A server answer shown with the summary, the field message and aria-invalid on the field. */
export const WithErrors: Story = {
  args: {
    mode: "sign-up",
    errors: { email: "We could not use that email address. Try another, or sign in.", confirmAdult: "Confirm that you are 18 or over to create an account." },
  },
};

export const Busy: Story = { args: { busy: true } };

/** Off by default; each button renders only when its provider is enabled. */
export const WithGoogleAndApple: Story = { args: { providers: { google: true, apple: true } } };

export const Dark: Story = { globals: { theme: "dark" }, args: { providers: { google: true, apple: true } } };

export const ReducedMotion: Story = {
  decorators: [(Story) => <ForceReducedMotion><Story /></ForceReducedMotion>],
};

/** Submitting an empty sign-in does not call onSubmit and shows the summary. */
export const EmptySubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
    await expect(await canvas.findByText("There are 2 things to check.")).toBeInTheDocument();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};
