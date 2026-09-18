import type { Metadata } from "next";
import { SubjectLandingPage } from "@/components/SubjectLandingPage";
import { createMetadata } from "@/lib/metadata";
import { subjectLandingPages } from "@/lib/site";

const subject = subjectLandingPages["11-plus"];

export const metadata: Metadata = createMetadata({
  title: subject.seo.title,
  description: subject.seo.description,
  path: subject.path,
});

export default function ElevenPlusTuitionPage() {
  return <SubjectLandingPage subject={subject} />;
}
