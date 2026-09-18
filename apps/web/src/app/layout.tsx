import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { siteConfig } from "@/lib/site";
import "./globals.css";

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

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-GB" className={`${bricolage.variable} ${publicSans.variable} ${ibmPlexMono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
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
