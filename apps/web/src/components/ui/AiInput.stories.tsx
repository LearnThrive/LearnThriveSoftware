import { useEffect, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AiInput } from "./AiInput";

function ForceReducedMotion({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-motion", "reduce");
    return () => root.removeAttribute("data-motion");
  }, []);
  return children;
}

const sample = (name: string, type: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type });

/**
 * The Study Buddy's input: a pill that grows when used, with take-photo, add-image and add-file buttons, send,
 * and a microphone button that opens the voice overlay. Controlled and presentational: the text, the files and
 * the voice state come in through props and go out through callbacks, and nothing is stored or sent from here.
 * Enter sends and Shift+Enter starts a new line. The voice overlay is a modal dialog with a Talk button that
 * works by holding (pointer or Space/Enter) or by pressing once to start and again to stop, a visible state
 * (Listening, Thinking, Speaking) and a transcript the student can correct before sending.
 */
const meta = {
  title: "UI/AiInput",
  component: AiInput,
  tags: ["autodocs"],
  args: {
    hint: "Please do not type names, your school or addresses.",
    onSubmit: fn(),
    onFilesSelected: fn(),
    onFileRemove: fn(),
    onVoiceStart: fn(),
    onVoiceStop: fn(),
    onVoiceCancel: fn(),
  },
  argTypes: {
    voiceState: { control: "select", options: ["idle", "listening", "thinking", "speaking"] },
  },
  decorators: [
    (Story) => (
      <div style={{ padding: "1.5rem", minHeight: "16rem" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AiInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Focus (or typing) grows the pill to full width; the focus ring is drawn around the whole pill. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("textbox", { name: "Your message" }));
  },
};

export const WithText: Story = { args: { defaultValue: "How do I factorise x squared plus five x plus six?" } };

export const WithAttachments: Story = {
  args: {
    defaultValue: "Can you check my working?",
    files: [sample("quadratics-homework.pdf", "application/pdf", 482_000), sample("working-out.png", "image/png", 2_300_000)],
  },
};

export const Disabled: Story = { args: { disabled: true } };

/** An answer is on its way: sending is paused and "Thinking" is written out (animated only where motion is allowed). */
export const Busy: Story = { args: { busy: true, defaultValue: "Explain photosynthesis" } };

/** The page's own message, here the too-many-files case. It is announced when it appears. */
export const ErrorState: Story = {
  args: { error: "You can attach up to 3 files. Remove one to add another.", defaultValue: "Here are my four photos" },
};

export const CharacterLimit: Story = { args: { maxLength: 60, defaultValue: "A question that is close to the sixty character limit now" } };

/** Open the overlay already (stories only). Nothing is heard; the transcript is what the recogniser would have given. */
export const VoiceIdle: Story = { args: { defaultVoiceOpen: true, voiceState: "idle", transcript: "What is a quadratic equation?", onTranscriptEdit: fn() } };
export const VoiceListening: Story = { args: { defaultVoiceOpen: true, voiceState: "listening", onTranscriptEdit: fn() } };
export const VoiceThinking: Story = { args: { defaultVoiceOpen: true, voiceState: "thinking", transcript: "What is a quadratic equation?", onTranscriptEdit: fn() } };
export const VoiceSpeaking: Story = { args: { defaultVoiceOpen: true, voiceState: "speaking", transcript: "What is a quadratic equation?", onTranscriptEdit: fn() } };

export const VoiceListeningDark: Story = { ...VoiceListening, globals: { theme: "dark" } };

/** Under reduced motion (the OS setting, or the site's own Reduce choice) the orb and the busy dots are still. */
export const ReducedMotion: Story = {
  ...VoiceListening,
  decorators: [(Story) => <ForceReducedMotion><Story /></ForceReducedMotion>],
};

export const Dark: Story = { args: { defaultValue: "Can you check my working?", files: [sample("working-out.png", "image/png", 2_300_000)] }, globals: { theme: "dark" } };

/** Enter sends; Shift+Enter does not. */
export const EnterSends: Story = {
  args: { defaultValue: "" },
  play: async ({ canvasElement, args }) => {
    const box = within(canvasElement).getByRole("textbox", { name: "Your message" });
    await userEvent.type(box, "Hello{Shift>}{Enter}{/Shift}there");
    await expect(args.onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    await expect(args.onSubmit).toHaveBeenCalledWith("Hello\nthere", []);
  },
};
