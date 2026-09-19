"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * List search that writes to the URL (plan6 section 41), so a filtered view is shareable and
 * survives a reload. Debounced so typing doesn't fire a navigation per keystroke, and the
 * uncontrolled-to-controlled handoff keeps the field responsive while the server catches up.
 */
export function SearchInput({ placeholder = "Search…", label = "Search" }: {
  placeholder?: string;
  label?: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (value === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value); else next.delete("q");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, pathname]);

  return (
    <div className="search-input">
      <Search size={16} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button type="button" onClick={() => setValue("")} aria-label="Clear search">
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
