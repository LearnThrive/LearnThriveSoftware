import Link from "next/link";
import type { FaqItem } from "@/lib/faqs";

type FaqListProps = {
  items: readonly FaqItem[];
  compact?: boolean;
};

export function FaqList({ items, compact = false }: FaqListProps) {
  return (
    <div className={`faq-list${compact ? " faq-list--compact" : ""}`}>
      {items.map((item) => (
        <details className="faq-item" id={item.id} key={item.id}>
          <summary>
            <span>{item.question}</span>
            <span className="faq-item__marker" aria-hidden="true" />
          </summary>
          <div className="faq-item__answer">
            {typeof item.answer === "string" ? <p>{item.answer}</p> : item.answer}
            {item.link ? (
              <Link className="text-link" href={item.link.href}>
                {item.link.label}
                <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
