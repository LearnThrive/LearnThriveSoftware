import type { ReactNode } from "react";

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  align?: "left" | "centre";
  theme?: "default" | "inverse";
};

export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "left",
  theme = "default",
}: SectionHeadingProps) {
  return (
    <div
      className={`section-heading section-heading--${align} section-heading--${theme}`}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {intro ? <div className="section-heading__intro">{intro}</div> : null}
    </div>
  );
}
