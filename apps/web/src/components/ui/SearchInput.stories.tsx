import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SearchInput } from "./SearchInput";

/**
 * List search that writes to the URL (`?q=`), not client state — a filtered view is shareable and
 * survives a reload (docs/DESIGN_SYSTEM.md). Debounced 250ms before it navigates.
 */
const meta = {
  title: "UI/SearchInput",
  component: SearchInput,
  tags: ["autodocs"],
  parameters: {
    // useSearchParams/usePathname/useRouter (SearchInput.tsx) need the App Router context
    // @storybook/nextjs-vite provides automatically for any component using next/navigation.
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: "Search…", label: "Search" },
};

export const CustomPlaceholder: Story = {
  args: { placeholder: "Search students, tutors or clients…", label: "Search people" },
};

/** Typing shows the clear button; clearing empties the field and hides it again. */
export const Typing: Story = {
  args: { placeholder: "Search…", label: "Search" },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("searchbox", { name: "Search" });
    await userEvent.type(input, "gcse maths");
    await canvas.findByRole("button", { name: "Clear search" });
  },
};
