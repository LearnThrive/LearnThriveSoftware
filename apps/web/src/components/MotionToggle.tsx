"use client";

import { useId } from "react";
import { Monitor, Pause } from "lucide-react";
import { MOTION_CHOICES, setMotionPreference, type MotionPreference } from "@/lib/motion/preference";
import { useMotionPreference } from "@/lib/motion/useMotionPreference";
import styles from "./ThemeToggle.module.css";

/**
 * The motion preference control (plan15 Wave 11, A3): "System" follows the device, "Reduce" switches off
 * spatial motion on this site whatever the device says. It is deliberately two choices, not three: there is
 * no "full motion" override of an operating-system reduced-motion setting (see lib/motion/preference.ts).
 *
 * A native radio group drawn as the same segmented control as the theme switch (the styles are shared, so it
 * themes itself). Reads the choice through useSyncExternalStore, so the server render and first client render
 * agree.
 */
const LABELS: Record<MotionPreference, string> = { system: "System", reduce: "Reduce" };
const ICONS = { system: Monitor, reduce: Pause } as const;

export function MotionToggle({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  const choice = useMotionPreference();
  const groupName = useId();

  return (
    <fieldset className={[styles.group, inverse ? styles.inverse : "", className].filter(Boolean).join(" ")}>
      <legend className={styles.legend}>Motion</legend>
      {MOTION_CHOICES.map((option) => {
        const Icon = ICONS[option];
        return (
          <label key={option} className={styles.option}>
            <input
              type="radio"
              name={groupName}
              value={option}
              checked={choice === option}
              onChange={() => setMotionPreference(option)}
              className={styles.input}
              aria-label={option === "reduce" ? "Reduce motion" : "Motion: follow my device"}
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
