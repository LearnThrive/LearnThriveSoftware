"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * The four motion tiers of plan11.md task 3. What each one is *for*:
 *
 * - "full": a wide, fine-pointer, capable desktop. The richest effects: pointer depth, full-range
 *   parallax, and the only tier the optional WebGL hero enhancement may run on.
 * - "standard": the default whenever the evidence is mixed or missing — tablets, narrow desktop
 *   windows, wide touch screens, engines that report nothing useful. Scroll choreography runs
 *   with the parallax ranges scaled down; pointer depth only if the pointer is genuinely fine.
 * - "light": phones and anything that says it is short on resources (Save-Data, little memory,
 *   few cores). Scroll choreography stays — the scenes are still readable and lively — but with
 *   tiny parallax, no pointer effects and no WebGL.
 * - "reduced": prefers-reduced-motion. Every scene renders its final state; no spatial choreography.
 *
 * Detection uses media queries and a few capability hints only. It never reads the user-agent
 * string: UA sniffing for "is this device powerful" ages badly and gets iPadOS, foldables and
 * desktop-mode phones wrong in both directions.
 *
 * The tier lives in one module-level store that subscribes to `matchMedia` once, however many
 * components ask for it, and is read through useSyncExternalStore. That matters for hydration: the
 * server snapshot is always "standard", React hydrates with it, and only then re-renders with the
 * client's real tier — so a scene whose markup depends on the tier can never mismatch the HTML it
 * was served, which the earlier lazy-`useState(computeTier)` read of matchMedia during the first
 * client render could not promise.
 */
export type MotionTier = "full" | "standard" | "light" | "reduced";

/** Everything a tier decision may depend on, gathered in one place so the rule is testable. */
export interface CapabilitySignals {
  reducedMotion: boolean;
  /** `(pointer: coarse)` — touch is the primary input. */
  coarsePointer: boolean;
  /** `(hover: none)` — the primary input cannot hover. */
  hoverNone: boolean;
  /** window.innerWidth, in CSS px. */
  viewportWidth: number;
  /** navigator.connection.saveData — the visitor asked the browser to use less data. */
  saveData: boolean;
  /** navigator.hardwareConcurrency; undefined where the browser does not report it. */
  cpuCores: number | undefined;
  /** navigator.deviceMemory in GB (Chromium only, reported in coarse buckets); undefined elsewhere. */
  memoryGb: number | undefined;
}

/** Below this a viewport is a phone, however capable the phone. */
export const PHONE_MAX_WIDTH = 767;
/** From this up, with a fine pointer, a desktop can be "full". */
export const DESKTOP_MIN_WIDTH = 1024;
const LOW_MEMORY_GB = 4;
const LOW_CORE_COUNT = 4;

export function selectMotionTier(signals: CapabilitySignals): MotionTier {
  if (signals.reducedMotion) return "reduced";

  const lowPower =
    signals.saveData ||
    (signals.memoryGb !== undefined && signals.memoryGb < LOW_MEMORY_GB) ||
    (signals.cpuCores !== undefined && signals.cpuCores < LOW_CORE_COUNT);
  if (lowPower || signals.viewportWidth <= PHONE_MAX_WIDTH) return "light";

  // Touch-primary devices and narrow windows are capable of scroll choreography but not of a
  // desktop's pointer effects, and their layouts can't hold a desktop's depth — "standard".
  if (signals.coarsePointer || signals.hoverNone || signals.viewportWidth < DESKTOP_MIN_WIDTH) return "standard";

  // No capability evidence at all (neither core count nor memory) is uncertainty, not permission.
  if (signals.cpuCores === undefined && signals.memoryGb === undefined) return "standard";

  return "full";
}

/** What a tier allows, so components ask a question ("may I parallax?") not a tier name. */
export interface MotionCapabilities {
  tier: MotionTier;
  /** Scroll-linked transforms (parallax, path drawing, sticky narratives) run at all. */
  scrollChoreography: boolean;
  /** Multiplier applied to every authored parallax distance; 0 when there is no parallax. */
  parallaxScale: number;
  /** Cursor-driven depth. The primitive additionally requires a fine pointer. */
  pointerDepth: boolean;
  /** Optional WebGL enhancements. */
  webgl: boolean;
}

const CAPABILITIES: Record<MotionTier, Omit<MotionCapabilities, "tier">> = {
  full: { scrollChoreography: true, parallaxScale: 1, pointerDepth: true, webgl: true },
  standard: { scrollChoreography: true, parallaxScale: 0.7, pointerDepth: true, webgl: false },
  light: { scrollChoreography: true, parallaxScale: 0.35, pointerDepth: false, webgl: false },
  reduced: { scrollChoreography: false, parallaxScale: 0, pointerDepth: false, webgl: false },
};

export function motionCapabilities(tier: MotionTier): MotionCapabilities {
  return { tier, ...CAPABILITIES[tier] };
}

// ── The shared store ───────────────────────────────────────────────────────────────────────

interface NetworkInformationLike extends EventTarget {
  saveData?: boolean;
}

interface CapabilitySnapshot {
  tier: MotionTier;
  finePointer: boolean;
}

const SERVER_SNAPSHOT: CapabilitySnapshot = { tier: "standard", finePointer: false };

function hasWindow() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function readSignals(): CapabilitySignals {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  return {
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    hoverNone: window.matchMedia("(hover: none)").matches,
    viewportWidth: window.innerWidth,
    saveData: connection?.saveData === true,
    cpuCores: typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : undefined,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  };
}

function readSnapshot(): CapabilitySnapshot {
  return {
    tier: selectMotionTier(readSignals()),
    finePointer: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  };
}

const listeners = new Set<() => void>();
let snapshot: CapabilitySnapshot | null = null;
let detach: (() => void) | null = null;

function refresh() {
  const next = readSnapshot();
  if (snapshot && snapshot.tier === next.tier && snapshot.finePointer === next.finePointer) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function attach() {
  const queries = [
    "(prefers-reduced-motion: reduce)",
    "(pointer: coarse)",
    "(hover: none)",
    "(hover: hover) and (pointer: fine)",
    // The two width breakpoints selectMotionTier cares about; a change event fires as each is
    // crossed, which is far cheaper than a resize listener re-evaluating on every pixel.
    `(max-width: ${PHONE_MAX_WIDTH}px)`,
    `(max-width: ${DESKTOP_MIN_WIDTH - 1}px)`,
  ].map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener("change", refresh));

  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  connection?.addEventListener?.("change", refresh);

  // The store may have sat unsubscribed (with a stale snapshot) since the first render read it.
  refresh();

  return () => {
    queries.forEach((query) => query.removeEventListener("change", refresh));
    connection?.removeEventListener?.("change", refresh);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && hasWindow()) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
    }
  };
}

function getSnapshot(): CapabilitySnapshot {
  if (!hasWindow()) return SERVER_SNAPSHOT;
  snapshot ??= readSnapshot();
  return snapshot;
}

const getTier = () => getSnapshot().tier;
const getServerTier = () => SERVER_SNAPSHOT.tier;
const getFinePointer = () => getSnapshot().finePointer;
const getServerFinePointer = () => SERVER_SNAPSHOT.finePointer;

/** The current tier. "standard" on the server and during hydration, then the client's real tier. */
export function useMotionTier(): MotionTier {
  return useSyncExternalStore(subscribe, getTier, getServerTier);
}

/** What the current tier allows. Stable between renders while the tier does not change. */
export function useMotionCapabilities(): MotionCapabilities {
  const tier = useMotionTier();
  return useMemo(() => motionCapabilities(tier), [tier]);
}

/** True only for a genuinely fine, hovering pointer (a mouse or trackpad), never on touch. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, getFinePointer, getServerFinePointer);
}
