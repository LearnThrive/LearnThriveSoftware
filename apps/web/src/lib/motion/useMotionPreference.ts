"use client";

import { useSyncExternalStore } from "react";
import { currentMotionPreference, subscribeMotionPreference, type MotionPreference } from "./preference";

/** The visitor's motion preference. The server render (and the first client render) is always "system". */
export function useMotionPreference(): MotionPreference {
  return useSyncExternalStore(subscribeMotionPreference, () => currentMotionPreference(), (): MotionPreference => "system");
}
