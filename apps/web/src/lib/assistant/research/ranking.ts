import type { RawResult } from "./searxng";

/**
 * Which results to read first. A search engine ranks by popularity; a student needs the exam board's own page before a revision blog. Tiers are
 * by host (fixed, reviewable lists, not guessed), nudged by what the question is for, and results from one site are thinned so a single domain
 * cannot fill the list. Ranking decides what is READ FIRST; it does not decide what is TRUE.
 */
export type SourceTier = "official_exam" | "authoritative_text" | "institutional" | "reputable_education" | "revision" | "general" | "low";

export type SearchPurpose = "specification" | "mark_scheme" | "quotation" | "fact" | "general";

const TIER_SCORE: Record<SourceTier, number> = { official_exam: 100, authoritative_text: 85, institutional: 75, reputable_education: 60, revision: 40, general: 25, low: 5 };

/** Hosts (and their subdomains) of the UK exam boards and regulator. */
export const OFFICIAL_EXAM_HOSTS = ["aqa.org.uk", "filestore.aqa.org.uk", "qualifications.pearson.com", "pearson.com", "ocr.org.uk", "eduqas.co.uk", "wjec.co.uk", "ccea.org.uk", "gov.uk", "sqa.org.uk", "ofqual.gov.uk"];
const AUTHORITATIVE_TEXT_HOSTS = ["folger.edu", "shakespeare.mit.edu", "gutenberg.org", "perseus.tufts.edu", "poetryfoundation.org", "britishlibrary.cn", "bl.uk", "oxfordreference.com", "britannica.com", "nationaltrust.org.uk"];
const REPUTABLE_EDUCATION_HOSTS = ["bbc.co.uk", "bbc.com", "ox.ac.uk", "cam.ac.uk", "khanacademy.org", "royalsociety.org", "rsc.org", "iop.org", "ngs.org", "nhs.uk", "stem.org.uk", "senecalearning.com", "oakacademy.org", "thenational.academy"];
const REVISION_HOSTS = ["sparknotes.com", "cliffsnotes.com", "gcsepod.com", "savemyexams.com", "physicsandmathstutor.com", "revisionworld.com", "mrbruff.com", "litcharts.com", "shmoop.com", "tes.com", "studysmarter.co.uk", "senecalearning.com", "thestudentroom.co.uk", "mymathscloud.com", "corbettmaths.com"];
const LOW_HOSTS = ["pinterest.", "quora.com", "reddit.com", "answers.yahoo.com", "brainly.", "coursehero.com", "studocu.com", "scribd.com", "chegg.com", "medium.com", "blogspot.", "wordpress.com", "tiktok.com", "facebook.com", "x.com", "twitter.com", "youtube.com", "gradesaver.com", "123helpme", "essaysauce", "ukessays.com", "bartleby.com", "enotes.com"];

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

const onHost = (host: string, list: readonly string[]): boolean => list.some((h) => host === h || host.endsWith(`.${h}`) || (h.endsWith(".") && host.includes(h)));

/** The site's "registrable" name, roughly: example.co.uk and sub.example.co.uk are one site. Enough to thin repeats; not a public-suffix list. */
export const siteOf = (host: string): string => {
  const parts = host.split(".");
  return parts.length <= 2 ? host : parts.length >= 3 && /^(co|org|gov|ac|sch|nhs)$/.test(parts[parts.length - 2]!) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
};

export function tierOf(url: string): SourceTier {
  const host = hostOf(url);
  if (!host) return "low";
  if (onHost(host, LOW_HOSTS)) return "low";
  if (onHost(host, OFFICIAL_EXAM_HOSTS)) return "official_exam";
  if (onHost(host, AUTHORITATIVE_TEXT_HOSTS)) return "authoritative_text";
  if (onHost(host, REVISION_HOSTS)) return "revision";
  if (onHost(host, REPUTABLE_EDUCATION_HOSTS)) return "reputable_education";
  if (/\.(gov\.uk|ac\.uk|edu|sch\.uk)$/.test(host)) return "institutional";
  return "general";
}

export const isOfficialExamHost = (url: string): boolean => onHost(hostOf(url), OFFICIAL_EXAM_HOSTS);

export interface RankedResult extends RawResult {
  tier: SourceTier;
  score: number;
  host: string;
}

const PURPOSE_BOOST: Record<SearchPurpose, Partial<Record<SourceTier, number>>> = {
  specification: { official_exam: 40 },
  mark_scheme: { official_exam: 50 },
  quotation: { authoritative_text: 30, institutional: 10 },
  fact: { institutional: 10, reputable_education: 10, authoritative_text: 10 },
  general: {},
};

/** Ranks results best first and keeps at most `perSite` from any one site. */
export function rankResults(results: readonly RawResult[], purpose: SearchPurpose = "general", options: { perSite?: number; limit?: number } = {}): RankedResult[] {
  const perSite = options.perSite ?? 2;
  const ranked = results
    .map((r, index): RankedResult => {
      const tier = tierOf(r.url);
      const host = hostOf(r.url);
      const pdf = /\.pdf(?:$|\?)/i.test(r.url) && purpose !== "general" ? 8 : 0;
      const agree = Math.min(r.engines.length, 3) * 2;
      return { ...r, tier, host, score: TIER_SCORE[tier] + (PURPOSE_BOOST[purpose][tier] ?? 0) + pdf + agree - index * 0.5 };
    })
    .sort((a, b) => b.score - a.score);
  const count = new Map<string, number>();
  const kept: RankedResult[] = [];
  for (const r of ranked) {
    const site = siteOf(r.host);
    const n = count.get(site) ?? 0;
    if (n >= perSite) continue;
    count.set(site, n + 1);
    kept.push(r);
    if (kept.length >= (options.limit ?? 8)) break;
  }
  return kept;
}
