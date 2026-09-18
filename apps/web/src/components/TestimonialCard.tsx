type TestimonialCardProps = {
  title: string;
  quote: string;
  attribution: string;
  featured?: boolean;
};

export function TestimonialCard({
  title,
  quote,
  attribution,
  featured = false,
}: TestimonialCardProps) {
  return (
    <figure
      className={`testimonial-card ${featured ? "testimonial-card--featured" : ""}`}
    >
      <span className="testimonial-card__quote" aria-hidden="true">
        “
      </span>
      <figcaption>{title}</figcaption>
      <blockquote>{quote}</blockquote>
      <p>{attribution}</p>
    </figure>
  );
}
