import { siteConfig } from "@/lib/site";

/** The plain-email way onto the Library waitlist: shown without JavaScript, and when the server cannot take sign-ups. */
export const WAITLIST_MAILTO = `mailto:${siteConfig.email}?subject=${encodeURIComponent("Library waitlist")}`;
