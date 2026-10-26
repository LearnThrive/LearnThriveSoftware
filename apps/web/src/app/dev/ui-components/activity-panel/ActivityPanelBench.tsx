"use client";

import { ActivityPanel, type ActivityView, type PanelStep } from "@/components/study-buddy/ActivityPanel";

const src = (host: string, title: string, tier: string, via: "browser" | "direct" = "browser") => ({ title, host, url: `https://${host}/read`, tier, via });

const researched: PanelStep[] = [
  { id: "analyse-1", kind: "analyse", state: "done", label: "Understanding your question", detail: "English Literature · an exam answer" },
  { id: "search-2", kind: "search", state: "done", label: "Searching the web for sources", detail: "12 results" },
  { id: "read-3", kind: "read", state: "done", label: "Read www.folger.edu", source: src("www.folger.edu", "Macbeth, Act 5 Scene 1 | Folger Shakespeare Library", "primary text") },
  { id: "read-4", kind: "read", state: "done", label: "Read www.bbc.co.uk", source: src("www.bbc.co.uk", "Lady Macbeth - Macbeth revision - BBC Bitesize", "education site", "direct") },
  { id: "read-5", kind: "read", state: "failed", label: "Reading www.example.org", detail: "could not be read" },
  { id: "write-6", kind: "write", state: "done", label: "Drafted the answer" },
  { id: "verify-7", kind: "verify", state: "done", label: "Checking quotations and facts against the sources", detail: "everything checked was supported" },
];

const VIEWS: Array<{ id: string; title: string; view: ActivityView }> = [
  { id: "pending", title: "Just sent", view: { phase: "running", steps: [] } },
  { id: "running", title: "Working: searching and reading", view: { phase: "running", steps: [researched[0]!, researched[1]!, { ...researched[2]!, state: "running", source: undefined, label: "Reading www.folger.edu" }] } },
  { id: "verifying", title: "Working: checking the draft", view: { phase: "running", steps: [...researched.slice(0, 6), { ...researched[6]!, state: "running", detail: undefined }] } },
  { id: "done", title: "Finished: research and verification", view: { phase: "done", steps: researched } },
  { id: "limited", title: "Finished, but no source could be reached", view: { phase: "done", steps: [researched[0]!, { id: "search-2", kind: "search", state: "failed", label: "Searching the web for sources", detail: "search was not available" }, { id: "verify-3", kind: "verify", state: "failed", label: "Checking quotations and facts against the sources", detail: "no sources could be read, so nothing could be confirmed" }] } },
  { id: "failed", title: "Could not finish", view: { phase: "failed", steps: researched.slice(0, 3).map((s) => (s.state === "done" && s.kind === "read" ? s : s)) } },
  { id: "stopped", title: "Stopped by the student", view: { phase: "stopped", steps: [researched[0]!, { ...researched[1]!, state: "failed", detail: "stopped" }] } },
  { id: "calculation", title: "Finished: a calculation was checked", view: { phase: "done", steps: [{ id: "analyse-1", kind: "analyse", state: "done", label: "Understanding your question", detail: "Maths · working something out" }, { id: "calculate-2", kind: "calculate", state: "done", label: "Checking the working by calculation", detail: "every step checked out" }] } },
];

export function ActivityPanelBench() {
  return (
    <>
      {VIEWS.map(({ id, title, view }) => (
        <section key={id} id={`bench-${id}`} aria-labelledby={`bench-${id}-title`} style={{ marginBlockEnd: "1.5rem" }}>
          <h2 id={`bench-${id}-title`} style={{ fontSize: "0.95rem" }}>{title}</h2>
          <ActivityPanel view={view} />
        </section>
      ))}
    </>
  );
}
