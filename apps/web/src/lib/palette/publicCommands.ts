import type { PaletteCommand } from "@/components/palette/CommandPalette";
import { faqSections } from "@/lib/faqs";
import { navigation, siteConfig, subjects } from "@/lib/site";
import { setMotionPreference } from "@/lib/motion/preference";
import { setTheme } from "@/lib/theme";

/**
 * The public site's command set (plan15 Wave 9 section 13.3): pages, subjects, FAQ questions, the
 * enquiry, contact options, the theme switch and the legal pages. Everything here is already public
 * content; nothing is fetched. It is imported only by the lazily loaded palette (PublicPalette.tsx),
 * never by the page bundle, so the FAQ text costs nothing until someone opens the palette.
 *
 * `keywords` carry the words people search with that are not in the title ("dbs" for Safeguarding,
 * "gcse" for a subject), so a search for them lands on the right place.
 */
const legalPages: ReadonlyArray<{ href: PaletteCommand["href"]; title: string; keywords: string[] }> = [
  { href: "/privacy", title: "Privacy notice", keywords: ["data", "gdpr", "personal information"] },
  { href: "/careers/privacy", title: "Applicant privacy notice", keywords: ["tutor application", "data", "gdpr", "cv"] },
  { href: "/cookies", title: "Cookies", keywords: ["storage", "tracking"] },
  { href: "/terms", title: "Website terms", keywords: ["conditions", "legal"] },
  { href: "/tuition-terms", title: "Tuition terms", keywords: ["agreement", "fees", "cancellation", "legal"] },
  { href: "/complaints", title: "Complaints", keywords: ["feedback", "problem", "concern"] },
  { href: "/accessibility", title: "Accessibility statement", keywords: ["a11y", "screen reader", "wcag"] },
];

/** Words people search with that are not in a navigation label ("tutor" and "jobs" for Careers). */
const navigationKeywords: Record<string, string[]> = {
  "/careers": ["tutor", "apply", "application", "jobs", "work", "teach", "vacancy", "roles"],
};

export function buildPublicCommands(): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  for (const item of navigation) {
    commands.push({
      id: `page:${item.href}`,
      title: item.label,
      group: "Pages",
      href: item.href,
      hint: item.href === "/" ? "/" : item.href,
      keywords: navigationKeywords[item.href],
    });
  }
  commands.push({
    id: "page:/safeguarding",
    title: "Safeguarding",
    group: "Pages",
    href: "/safeguarding",
    hint: "/safeguarding",
    keywords: ["dbs", "child protection", "safe", "vetting"],
  });
  commands.push({
    id: "page:/trust",
    title: "Trust and policies",
    group: "Pages",
    href: "/trust",
    hint: "/trust",
    keywords: ["policies", "safeguarding", "privacy", "complaints", "terms", "company"],
  });

  for (const subject of subjects) {
    commands.push({
      id: `subject:${subject.slug}`,
      title: `${subject.title} tuition`,
      group: "Subjects",
      href: subject.path,
      hint: subject.stage,
      keywords: [subject.slug, ...subject.focus.map((f) => f.toLowerCase()), "gcse", "a-level", "ks2", "ks3"],
    });
  }

  commands.push(
    { id: "action:enquiry", title: "Send an enquiry", group: "Actions", href: "/book", hint: "Free consultation", keywords: ["book", "contact", "consultation", "start", "get started"] },
    { id: "action:email", title: "Email LearnThrive", group: "Actions", href: `mailto:${siteConfig.email}`, hint: siteConfig.email, keywords: ["contact", "message"] },
  );
  for (const contact of siteConfig.phoneContacts) {
    commands.push({
      id: `action:call:${contact.phoneHref}`,
      title: `Call ${contact.name}`,
      group: "Actions",
      href: `tel:${contact.phoneHref}`,
      hint: contact.phoneDisplay,
      keywords: ["phone", "telephone", "contact"],
    });
  }

  commands.push(
    { id: "theme:system", title: "Use the system appearance", group: "Appearance", run: () => setTheme("system"), keywords: ["theme", "dark", "light", "auto"] },
    { id: "theme:light", title: "Switch to the light theme", group: "Appearance", run: () => setTheme("light"), keywords: ["theme", "day", "bright"] },
    { id: "theme:dark", title: "Switch to the dark theme", group: "Appearance", run: () => setTheme("dark"), keywords: ["theme", "night"] },
    { id: "motion:system", title: "Follow my device for motion", group: "Appearance", run: () => setMotionPreference("system"), keywords: ["animation", "motion", "reduce", "default"] },
    { id: "motion:reduce", title: "Reduce motion", group: "Appearance", run: () => setMotionPreference("reduce"), keywords: ["animation", "motion", "less", "calm", "accessibility"] },
  );

  for (const page of legalPages) {
    commands.push({ id: `legal:${page.href}`, title: page.title, group: "Legal", href: page.href, hint: page.href, keywords: page.keywords });
  }

  for (const section of faqSections) {
    for (const item of section.items) {
      commands.push({
        id: `faq:${item.id}`,
        title: item.question,
        group: "FAQ",
        href: `/faq#${item.id}`,
        hint: section.title,
        keywords: [section.title.toLowerCase()],
      });
    }
  }
  return commands;
}
