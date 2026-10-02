import { jsonLdString } from "@/lib/structuredData";

/**
 * Renders one JSON-LD block (plan15 Wave 10 section 14.4). A plain server-rendered <script>: JSON-LD
 * is data, not executable script, so it is unaffected by a strict script-src Content-Security-Policy
 * (the type is not "text/javascript"), and it is in the first HTML response where crawlers look.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
