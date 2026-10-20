import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PricingCard } from "./PricingCard";

const FEATURES = [
  "Worksheets written by LearnThrive tutors",
  "Exam-style papers and mark schemes",
  "Included free for enrolled students",
];
const NOTE =
  "Terms, price, renewal and cancellation details will be shown in full before anyone pays. No payment is taken now.";

/** Stops the form from leaving the story when a valid checkout form is submitted. */
const noPost = (event: { preventDefault(): void }) => event.preventDefault();

function ReducedMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-motion", "reduce");
    return () => root.removeAttribute("data-motion");
  }, []);
  return children;
}

/**
 * The Library's pricing card. Coming soon is the only state any page uses until billing exists; the live
 * state is built now so nothing is rebuilt later. Prices and plan names in these stories are samples.
 */
const meta = {
  title: "UI/PricingCard",
  component: PricingCard,
  tags: ["autodocs"],
  args: { state: "coming-soon", title: "LearnThrive Library", features: FEATURES, notes: NOTE },
  decorators: [(Story) => <div style={{ padding: "1.5rem" }}><Story /></div>],
} satisfies Meta<typeof PricingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No price set: the card says "Price announced at launch". */
export const ComingSoon: Story = {
  args: { description: "Worksheets, papers and notes written by LearnThrive." },
};

/** Only if the owner sets a price in configuration. */
export const ComingSoonWithPrice: Story = { args: { price: "£9.99", period: "month" } };

export const LiveMonthly: Story = {
  args: {
    state: "live",
    price: "£9.99",
    period: "month",
    checkoutFields: { plan: "monthly" },
    notes: undefined,
    onCheckout: noPost,
  },
};

export const LiveAnnual: Story = {
  args: { ...LiveMonthly.args, price: "£99", period: "year", checkoutFields: { plan: "annual" } },
};

/** Checkout is opening: the button is disabled and says so. */
export const Submitting: Story = { args: { ...LiveMonthly.args, submitting: true } };

export const Disabled: Story = { args: { ...LiveMonthly.args, disabled: true } };

/** Subscribe pressed without the box ticked: focus moves to the box and the error is shown and described. */
export const ErrorState: Story = {
  name: "Error",
  args: LiveMonthly.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to checkout" }));
    await expect(canvas.getByRole("checkbox")).toHaveFocus();
    await expect(canvas.getByRole("checkbox")).toBeInvalid();
  },
};

/** Keyboard focus on the button: the focus ring comes from the shared button style. */
export const Focused: Story = {
  args: LiveMonthly.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.getByRole("button", { name: "Continue to checkout" })).toHaveFocus();
  },
};

/** A live card with no billing period is not allowed to show a payment form: it falls back to coming soon. */
export const LiveWithoutPeriodFallsBack: Story = { args: { ...LiveMonthly.args, period: undefined } };

export const Dark: Story = { args: LiveMonthly.args, globals: { theme: "dark" } };

export const ComingSoonDark: Story = { globals: { theme: "dark" } };

/** The card has no motion of its own; this sets the site's Reduce motion switch so the button's hover is static too. */
export const ReducedMotionStory: Story = {
  name: "ReducedMotion",
  decorators: [(Story) => <ReducedMotion><Story /></ReducedMotion>],
};
