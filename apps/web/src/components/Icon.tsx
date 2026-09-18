import type { IconName } from "@/lib/site";

type IconProps = {
  name: IconName;
  className?: string;
};

export function Icon({ name, className }: IconProps) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "personal":
      return (
        <svg {...common}>
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
          <path d="M8.5 14.5c1.1-1.3 2.25-2 3.5-2s2.4.7 3.5 2" />
          <path d="M9.5 9.25h.01M14.5 9.25h.01" />
        </svg>
      );
    case "tutor":
      return (
        <svg {...common}>
          <path d="m3 8.5 9-4 9 4-9 4-9-4Z" />
          <path d="M6.5 10v5.1c2.8 2.3 8.2 2.3 11 0V10" />
          <path d="M21 8.5V14" />
        </svg>
      );
    case "interactive":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="13" rx="1.5" />
          <path d="M8 21h8M12 17v4M7.5 10.5l2.5 2.25 5-5" />
        </svg>
      );
    case "progress":
      return (
        <svg {...common}>
          <path d="M5 20V9M12 20V4M19 20v-7" />
          <path d="m3 7 5-4 4 3 7-4" />
        </svg>
      );
    case "results":
    case "growth":
      return (
        <svg {...common}>
          <path d="M4 18 10 12l4 3 6-8" />
          <path d="M15 7h5v5" />
          <path d="M4 5v13h16" />
        </svg>
      );
    case "maths":
      return (
        <svg {...common}>
          <path d="M4 7h6M7 4v6M14 5l5 5M19 5l-5 5M4 16h6M14 16h5M16.5 13.5v.01M16.5 18.5v.01" />
        </svg>
      );
    case "english":
      return (
        <svg {...common}>
          <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v17H7.5A3.5 3.5 0 0 0 4 22V5.5Z" />
          <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v17h3.5A3.5 3.5 0 0 1 20 22V5.5Z" />
        </svg>
      );
    case "science":
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.75 3h10.5A2 2 0 0 0 19 18l-5-9V3" />
          <path d="M7.5 15h9M9 12h6" />
        </svg>
      );
    case "eleven":
      return (
        <svg {...common}>
          <path d="M5 7h2v10M11 7h2v10M17 12h5M19.5 9.5v5" />
        </svg>
      );
    case "parent":
      return (
        <svg {...common}>
          <path d="M16 20v-1.5A4.5 4.5 0 0 0 11.5 14h-5A4.5 4.5 0 0 0 2 18.5V20" />
          <circle cx="9" cy="7" r="4" />
          <path d="M17 8h5M19.5 5.5v5" />
        </svg>
      );
    case "discuss":
      return (
        <svg {...common}>
          <path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-2-3.5v-5a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4V15Z" />
          <path d="M7 8h10M7 12h6" />
        </svg>
      );
    case "match":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4" />
          <circle cx="16" cy="16" r="4" />
          <path d="m11 11 2 2" />
          <path d="m5 17 2 2 4-5" />
        </svg>
      );
    case "learn":
      return (
        <svg {...common}>
          <path d="M3 5.5A3.5 3.5 0 0 1 6.5 2H11v17H6.5A3.5 3.5 0 0 0 3 22V5.5Z" />
          <path d="M21 5.5A3.5 3.5 0 0 0 17.5 2H13v17h4.5A3.5 3.5 0 0 1 21 22V5.5Z" />
          <path d="m7 11 1.5 1.5L11 9" />
        </svg>
      );
    case "clarity":
      return (
        <svg {...common}>
          <path d="M9 18h6M10 22h4" />
          <path d="M8.5 15.5A7 7 0 1 1 15.5 15.5c-.8.65-1.2 1.4-1.2 2.5h-4.6c0-1.1-.4-1.85-1.2-2.5Z" />
          <path d="m9.5 10 1.5 1.5 3.5-4" />
        </svg>
      );
    case "encouragement":
      return (
        <svg {...common}>
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
        </svg>
      );
    case "partnership":
      return (
        <svg {...common}>
          <path d="M7 11 3.5 8.5 6 6l3 2h6l3-2 2.5 2.5L17 11" />
          <path d="m8 10 5.5 5.5a2 2 0 0 0 3-2.65L13 9.5l-2 2a2.1 2.1 0 0 1-3-3L10.5 6" />
          <path d="m6 12-2 2 4 4 2-2M18 12l2 2-2 2" />
        </svg>
      );
  }
}
