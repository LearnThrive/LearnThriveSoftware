"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarPlus, ChevronDown, ClipboardList, GraduationCap, Plus, UserRound, Users } from "lucide-react";
import { QUICK_CREATE } from "@/lib/navigation/quickCreate";
import { useDelayedUnmount } from "@/lib/motion/useDelayedUnmount";

// The entries (and who may have them) live in lib/navigation/quickCreate.ts, shared with the command
// palette; this only adds each one's icon.
const ICONS = {
  "/dashboard/admin/people/students": GraduationCap,
  "/dashboard/admin/people/clients": Users,
  "/dashboard/admin/people/tutors": UserRound,
  "/dashboard/admin/assignments": ClipboardList,
  "/dashboard/admin/lessons/new": CalendarPlus,
} as const;
const ITEMS = QUICK_CREATE.map((item) => ({ ...item, icon: ICONS[item.href] }));

/**
 * One "+ Create" control instead of five competing buttons across the dashboard (plan6 section
 * 51). Each option goes to the page that owns that creation flow, where the real form lives.
 */
export function QuickCreateMenu() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panel = useDelayedUnmount(open, 100);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="quick-create" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--primary"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus size={16} aria-hidden="true" />Create
        <ChevronDown size={14} aria-hidden="true" className={`icon-rotate ${open ? "is-open" : ""}`} />
      </button>
      {panel.rendered && (
        <div className={`quick-create__panel ${panel.closing ? "is-closing" : ""}`} role="menu">
          {ITEMS.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className="quick-create__item"
              role="menuitem"
              style={{ animationDelay: `${index * 25}ms` }}
            >
              <item.icon size={16} aria-hidden="true" />{item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
