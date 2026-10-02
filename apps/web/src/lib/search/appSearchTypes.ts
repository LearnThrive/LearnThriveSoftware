/**
 * The shapes and labels of an app search result, in a module with NO imports, so the palette (a client
 * component) can use them without pulling the server-only search (and the data layer behind it) into the
 * browser bundle. The searching itself is lib/search/appSearch.ts.
 */
export type AppSearchKind = "lesson" | "student" | "client" | "tutor" | "report";

export interface AppSearchResult {
  id: string;
  kind: AppSearchKind;
  title: string;
  subtitle?: string;
  href: string;
}

const KIND_LABEL: Record<AppSearchKind, string> = {
  lesson: "Lessons",
  student: "Students",
  client: "Clients",
  tutor: "Tutors",
  report: "Reports",
};

export function groupLabelFor(kind: AppSearchKind): string {
  return KIND_LABEL[kind];
}
