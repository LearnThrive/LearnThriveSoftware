"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_CONTEXT, type InterfaceContext } from "@/lib/openui/format";

/**
 * What an interface may ask of the page around it, and nothing more. It can ask LearnThrive AI a question (as if the student had typed it: it goes through
 * the same route, the same checks and the same limits as anything typed), and it can read what the SERVER checked about it (which quotations were verified,
 * which pages were read). It cannot call any other address, change an account, or open a link of its own: the only actions are the ones the page's own
 * components perform, and this is the only way out of them.
 */
export interface Host {
  /** What the server checked, kept with the interface. */
  context: InterfaceContext;
  /** Sends a message into the conversation, as the student. */
  ask: (message: string) => void;
  /** False while the interface is still arriving: its controls are shown but cannot be used yet, because it has not passed its checks. */
  enabled: boolean;
  /** `enabled`, and no other answer is being written, so a question can be sent into the conversation. */
  canAsk: boolean;
  /** The longest message the conversation takes. */
  maxChars: number;
}

export const HostContext = createContext<Host>({ context: EMPTY_CONTEXT, ask: () => {}, enabled: false, canAsk: false, maxChars: 1000 });
export const useHost = (): Host => useContext(HostContext);

export function HostProvider({ value, children }: { value: Host; children: ReactNode }) {
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

/** The element-node `props` of each child in a list prop (a Comparison's rows, a Quiz's questions): the parts a component reads as data. */
export function partsOf<T = Record<string, unknown>>(value: unknown): Array<T & { __type?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is { props?: unknown; typeName?: string } => Boolean(v) && typeof v === "object")
    .map((v) => ({ ...((v.props ?? v) as T), __type: v.typeName }));
}

export const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
export const asNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === "object" && value !== null && "value" in value ? Number((value as { value: unknown }).value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
