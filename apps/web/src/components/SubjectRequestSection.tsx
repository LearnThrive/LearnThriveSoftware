import { SubjectRequestForm } from "@/components/SubjectRequestForm";
import { Reveal } from "@/components/motion/primitives/Reveal";
import { siteConfig } from "@/lib/site";
import styles from "./SubjectRequestForm.module.css";

/**
 * "Can't see your subject?" on /subjects: a short explanation and the request form, in one card. The
 * introduction runs across the top and the form sits under it in two columns, so the copy and the fields are
 * read together and no part of the section is left empty beside a taller form. It says only that families
 * can ask for a subject we do not yet offer and that, if enough ask, the owners may add it. It promises no
 * subject, no date and no number.
 */
export function SubjectRequestSection() {
  return (
    <section id="request-a-subject" className={styles.section} aria-labelledby="request-subject-heading">
      <Reveal variant="soft">
        <div className={styles.card}>
          <div className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Not on the list?</p>
              <h2 id="request-subject-heading">Can’t see your subject?</h2>
            </div>
            <div>
              <p className={styles.intro}>
                You can ask for a subject we do not offer yet. If enough families ask, we may add it; we cannot promise that any subject will be added, or when.
              </p>
              <noscript>
                <p className={styles.fallback}>
                  The request form needs JavaScript. You can email <a href={`mailto:${siteConfig.email}?subject=Subject%20request`}>{siteConfig.email}</a> instead.
                </p>
              </noscript>
            </div>
          </div>
          <SubjectRequestForm />
        </div>
      </Reveal>
    </section>
  );
}
