"use client";

import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  readStoredTheme,
  resolvedScheme,
  setTheme,
  THEME_CHOICES,
  THEME_EVENT,
  THEMES_ENABLED,
  type ThemeChoice,
} from "@/lib/theme";
import styles from "./ThemeToggle.module.css";

/**
 * The three-way appearance control (plan15 Wave 3): System, Light, Dark.
 *
 * - `variant="cycle"` is the compact header control — one icon button that steps System -> Light ->
 *   Dark. Its accessible name always says what is selected *and* what pressing it does, and a
 *   visually hidden live region announces the new state.
 * - `variant="radio"` is the full control for the footer and the app's account menu: a native radio
 *   group (so arrow keys, Tab and selection behave exactly as the platform does) drawn as a
 *   segmented control.
 *
 * Both read the stored choice through useSyncExternalStore, so the server render (always "system")
 * and the first client render agree and nothing mismatches; the real choice lands right after
 * hydration, and the page itself has already been painted correctly by the pre-paint script. They
 * render nothing when the themes flag is off.
 */
const LABELS: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

function subscribe(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", listener);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", listener);
    media.removeEventListener("change", listener);
  };
}

const getSnapshot = () => readStoredTheme(window.localStorage);
const getServerSnapshot = (): ThemeChoice => "system";

function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

type ThemeToggleProps = {
  variant?: "cycle" | "radio";
  /** True on a navy surface (the footer), where the control uses the on-inverse colours. */
  inverse?: boolean;
  className?: string;
};

export function ThemeToggle({ variant = "radio", inverse = false, className }: ThemeToggleProps) {
  const choice = useThemeChoice();
  const groupName = useId();
  if (!THEMES_ENABLED) return null;

  if (variant === "cycle") {
    const next = THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
    const Icon = ICONS[choice];
    return (
      <>
        <button
          type="button"
          className={[styles.cycle, className].filter(Boolean).join(" ")}
          onClick={() => setTheme(next)}
          aria-label={`Colour theme: ${LABELS[choice]}. Switch to ${LABELS[next]}.`}
          title={`Theme: ${LABELS[choice]}`}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
        <span className="sr-only" role="status" aria-live="polite">
          {choice === "system" ? "" : `Theme set to ${LABELS[choice]}`}
        </span>
      </>
    );
  }

  return (
    <fieldset className={[styles.group, inverse ? styles.inverse : "", className].filter(Boolean).join(" ")}>
      <legend className={styles.legend}>Appearance</legend>
      {THEME_CHOICES.map((option) => {
        const Icon = ICONS[option];
        return (
          <label key={option} className={styles.option}>
            <input
              type="radio"
              name={groupName}
              value={option}
              checked={choice === option}
              onChange={() => setTheme(option)}
              className={styles.input}
            />
            <span className={styles.face}>
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              {LABELS[option]}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** For the few places that need to know which scheme is on screen (a logo variant, a canvas). */
export function useResolvedScheme(): "light" | "dark" {
  const choice = useThemeChoice();
  const prefersDark = useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  return resolvedScheme(choice, prefersDark);
}
