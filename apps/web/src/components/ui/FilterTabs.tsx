import Link from "next/link";

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  tone?: "warning";
}

/**
 * Tab-style filters backed by a real URL query parameter, not client state — so a filtered view
 * is linkable, survives a reload, and works with browser Back (plan6 sections 41, 57, 63, 107's
 * "filters must work").
 */
export function FilterTabs({ basePath, param, current, options }: {
  basePath: string;
  param: string;
  current: string;
  options: FilterOption[];
}) {
  return (
    <nav className="filter-tabs" aria-label="Filter">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <Link
            key={option.value}
            href={`${basePath}?${param}=${encodeURIComponent(option.value)}`}
            className={`filter-tab ${active ? "is-active" : ""} ${option.tone ? `filter-tab--${option.tone}` : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {option.label}
            {option.count !== undefined && <span className="filter-tab__count">{option.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
