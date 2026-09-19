"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarPlus, ChevronDown, ClipboardList, GraduationCap, Plus, UserRound, Users } from "lucide-react";

const ITEMS = [
  { href: "/dashboard/admin/people/students", label: "Student", icon: GraduationCap },
  { href: "/dashboard/admin/people/clients", label: "Client", icon: Users },
  { href: "/dashboard/admin/people/tutors", label: "Tutor", icon: UserRound },
  { href: "/dashboard/admin/assignments", label: "Tuition assignment", icon: ClipboardList },
  { href: "/dashboard/admin/lessons/new", label: "Lesson", icon: CalendarPlus },
];

/**
 * One "+ Create" control instead of five competing buttons across the dashboard (plan6 section
 * 51). Each option goes to the page that owns that creation flow, where the real form lives.
 */
export function QuickCreateMenu() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="quick-create__panel" role="menu">
          {ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className="quick-create__item" role="menuitem">
              <item.icon size={16} aria-hidden="true" />{item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
