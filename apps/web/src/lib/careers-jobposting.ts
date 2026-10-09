import { escapeHtml } from "@/lib/email";
import type { CareerRole } from "@/lib/careers";
import { siteConfig } from "@/lib/site";

/**
 * schema.org JobPosting markup for a role page. It describes a real vacancy and nothing else, and it is only
 * produced when every one of these is true, so it can never go stale or claim something the page does not say:
 *   - the role is a real vacancy (not the register-your-interest option, which would be a posting whose main
 *     purpose is collecting applications, against search engines' rules),
 *   - it is open, and its closing date (if any) has not passed,
 *   - applications can actually be made online right now (`applicationsOpen`),
 *   - the owner has confirmed the date it went live (`postedDate`; the markup requires one and the page shows it).
 * Everything in the markup is on the visible page: the pay, the self-employed type, the online location and
 * the right-to-work requirement. Pay is published as given ("£10 an hour per student"): the markup carries
 * 10 GBP per hour and the page and description say "per student".
 *
 * Checked against Google's job posting documentation (title, description, datePosted, hiringOrganization;
 * TELECOMMUTE with applicantLocationRequirements for a fully remote role; CONTRACTOR; baseSalary with HOUR).
 */
export function jobPostingData(role: CareerRole, { applicationsOpen, today }: { applicationsOpen: boolean; today: string }) {
  if (role.kind !== "vacancy" || role.status !== "open" || !applicationsOpen || !role.postedDate) return null;
  if (role.closingDate && role.closingDate < today) return null;

  const description = [
    `<p>${escapeHtml(role.summary)}</p>`,
    "<p>What you will do:</p>",
    `<ul>${role.doing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    "<p>What we are looking for:</p>",
    `<ul>${role.looking.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    `<p>${escapeHtml(role.employmentType)}. ${escapeHtml(role.pay)} ${escapeHtml(role.hours)}</p>`,
  ].join("");

  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: role.title,
    description,
    datePosted: role.postedDate,
    ...(role.closingDate ? { validThrough: `${role.closingDate}T23:59:59+00:00` } : {}),
    employmentType: "CONTRACTOR",
    hiringOrganization: { "@type": "Organization", name: siteConfig.legalName, sameAs: siteConfig.url },
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "GB" },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "GBP",
      value: { "@type": "QuantitativeValue", value: 10, unitText: "HOUR" },
    },
    directApply: true,
    url: `${siteConfig.url}/careers/${role.slug}`,
  };
}
