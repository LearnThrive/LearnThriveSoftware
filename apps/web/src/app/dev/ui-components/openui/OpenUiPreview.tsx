"use client";

import { useEffect, useMemo, useState } from "react";
import InterfaceMessage from "@/components/openui/InterfaceMessage";
import { buildInterfaceMessage } from "@/lib/openui/format";

const fromHash = (): string => {
  try {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get("program");
    if (!raw) return "";
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
};

export function OpenUiPreview() {
  const [program, setProgram] = useState("");
  const [asked, setAsked] = useState<string[]>([]);
  // The address is only known in the browser; read it after the first paint (not synchronously in the effect).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setProgram(fromHash()));
    return () => cancelAnimationFrame(frame);
  }, []);
  const content = useMemo(() => (program.trim() ? buildInterfaceMessage(program) : ""), [program]);
  return (
    <>
      <label htmlFor="program">Program</label>
      <textarea id="program" rows={8} style={{ inlineSize: "100%", fontFamily: "monospace" }} value={program} onChange={(e) => setProgram(e.target.value)} />
      <section aria-label="Preview" data-preview style={{ marginBlockStart: "1rem" }}>
        {content ? <InterfaceMessage content={content} streaming={false} busy={false} onAsk={(m) => setAsked((a) => [...a, m])} maxChars={1000} /> : <p>Nothing to show yet.</p>}
      </section>
      {asked.length ? (
        <ul aria-label="Questions the interface asked" data-asked>
          {asked.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      ) : null}
    </>
  );
}
