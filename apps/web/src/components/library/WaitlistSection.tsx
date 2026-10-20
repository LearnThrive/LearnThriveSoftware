import { Container } from "@/components/Container";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { siteConfig } from "@/lib/site";
import { WaitlistForm } from "./WaitlistForm";
import { WAITLIST_MAILTO } from "./waitlistMailto";
import styles from "./WaitlistSection.module.css";

/**
 * "Join the waitlist" on /library and /pricing: what joining means, then the form. The card is the target of the
 * pricing card's button (`#waitlist`) and of the Library hero's, so it can take focus (tabIndex -1) and the
 * browser moves focus here with the scroll. Without JavaScript the form is not drawn at all (see WaitlistForm) and
 * the <noscript> block gives a plain email address to write to instead.
 */
export function WaitlistSection({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className={styles.section} aria-labelledby="waitlist-heading">
      <Container>
        <Reveal variant="soft">
          <div id="waitlist" className={styles.card} tabIndex={-1}>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>Library waitlist</p>
              <Heading id="waitlist-heading">Join the waitlist</Heading>
              <p>Leave your email address and tick the box, and we will email you once, when the Library launches. There is nothing to pay.</p>
              <noscript>
                <p className={styles.fallback}>
                  Prefer email? Write to <a href={WAITLIST_MAILTO}>{siteConfig.email}</a> and ask to be added to the Library waitlist.
                </p>
              </noscript>
            </div>
            <WaitlistForm />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
