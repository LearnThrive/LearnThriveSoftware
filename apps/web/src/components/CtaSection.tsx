import { ButtonLink } from "@/components/ButtonLink";
import { Container } from "@/components/Container";

type CtaSectionProps = {
  title?: string;
  text?: string;
};

export function CtaSection({
  title = "Ready to help your child thrive?",
  text = "Tell LearnThrive about your child’s needs and explore how personalised tuition could support their next steps.",
}: CtaSectionProps) {
  return (
    <section className="cta-section">
      <Container className="cta-section__inner">
        <div>
          <p className="eyebrow">Start with a conversation</p>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        <div className="button-group">
          <ButtonLink href="/book" variant="light">
            Book a free consultation
          </ButtonLink>
          <ButtonLink href="/contact" variant="text">
            Contact us
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
