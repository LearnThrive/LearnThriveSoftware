"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The shell's page-specific secondary slot: a page renders into the sidebar, under the navigation, with <SidebarSection> (Study Buddy
 * puts its conversation history there). There is ONE navigation column for the whole signed-in product: a page never adds a second one.
 * The shell moves one slot element between the sidebar and the mobile drawer, so what a page renders keeps its state (an open search
 * box, a rename in progress) whichever of the two is showing.
 */
interface SidebarApi {
  slot: HTMLElement | null;
  collapsed: boolean;
  closeDrawer: () => void;
}

export const SidebarContext = createContext<SidebarApi>({ slot: null, collapsed: false, closeDrawer: () => {} });

/** Renders its children into the shell's sidebar, under the navigation. Nothing where there is no shell. */
export function SidebarSection({ children }: { children: ReactNode }) {
  const { slot } = useContext(SidebarContext);
  return slot ? createPortal(children, slot) : null;
}

export function useMemberSidebar(): Pick<SidebarApi, "collapsed" | "closeDrawer"> {
  const { collapsed, closeDrawer } = useContext(SidebarContext);
  return { collapsed, closeDrawer };
}
