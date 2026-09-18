import { Icon } from "@/components/Icon";
import type { IconName } from "@/lib/site";

type FeatureCardProps = {
  title: string;
  text: string;
  icon: IconName;
  index?: number;
};

export function FeatureCard({ title, text, icon, index }: FeatureCardProps) {
  return (
    <article className="feature-card">
      <div className="feature-card__topline">
        <span className="icon-box">
          <Icon name={icon} />
        </span>
        {index ? <span className="feature-card__index">0{index}</span> : null}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
