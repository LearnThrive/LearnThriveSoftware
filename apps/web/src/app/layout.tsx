import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { siteConfig } from "@/lib/site";
import "./globals.css";
import "./app-shell.css";
import "./app-components.css";
import "./app-dashboard.css";
import "./app-auth.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "Personalised Online Tuition | LearnThrive Tuition",
    template: "%s | LearnThrive Tuition",
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  category: "education",
  creator: siteConfig.name,
  publisher: siteConfig.name,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e2a47",
};

const organisationData = {
  "@context": "https://schema.org",
  "@type": "EducationalOrganization",
  name: siteConfig.name,
  url: siteConfig.url,
  logo: `${siteConfig.url}/brand/learnthrive-logo.png`,
  description: siteConfig.description,
  email: siteConfig.email,
  telephone: siteConfig.phoneContacts.map((contact) => contact.phoneHref),
  sameAs: [siteConfig.social.instagram, siteConfig.social.linkedin],
  contactPoint: siteConfig.phoneContacts.map((contact) => ({
    "@type": "ContactPoint",
    name: contact.name,
    telephone: contact.phoneHref,
    email: siteConfig.email,
    contactType: "customer enquiries",
    availableLanguage: "English",
  })),
};

// Deliberately only the document shell: fonts, global styles, structured data. The two product
// surfaces own their own chrome — marketing pages get PublicShell via the (public) route group,
// authenticated pages get AppShell via (app). Putting SiteHeader/SiteFooter here (as this file
// used to) is what made every dashboard page render the public marketing navbar above it.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // data-scroll-behavior tells Next.js this document really does opt into `scroll-behavior:
  // smooth` (globals.css, for the marketing pages' in-page anchor links) so it can suspend it for
  // the duration of a route change and restore it afterwards. Without the attribute Next leaves
  // it alone and warns: every dashboard navigation then animated its scroll-to-top, so the new
  // page visibly slid up from wherever the previous one had been scrolled to.
  return (
    <html
      lang="en-GB"
      data-scroll-behavior="smooth"
      className={`${bricolage.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        {children}
        <Script
          id="learnthrive-organisation-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organisationData).replace(/</g, "\\u003c"),
          }}
        />
      </body>
    </html>
  );
}
