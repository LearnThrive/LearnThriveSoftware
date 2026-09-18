import { siteConfig } from "@/lib/site";
import styles from "./PhoneContacts.module.css";

export interface PhoneContactsProps {
  layout?: "inline" | "stacked";
}

export function PhoneContacts({ layout = "inline" }: PhoneContactsProps) {
  return (
    <span className={`${styles.contacts} ${styles[layout]}`}>
      {siteConfig.phoneContacts.map((contact) => (
        <span className={styles.contact} key={contact.phoneHref}>
          <strong className={styles.name}>{contact.name}:</strong>
          <a className={styles.link} href={`tel:${contact.phoneHref}`}>
            {contact.phoneDisplay}
          </a>
        </span>
      ))}
    </span>
  );
}
