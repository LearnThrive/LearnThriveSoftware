"use client";

import { useRef, useState } from "react";
import { AiInput, type VoiceState } from "@/components/ui/AiInput";

const HINT = "Please do not type names, your school or addresses.";

function sampleFile(name: string, type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** The pretend pipeline: start listens, stop "transcribes" for a moment, then leaves a transcript to correct. */
function Interactive() {
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [forced, setForced] = useState<"auto" | VoiceState>("auto");
  const [transcript, setTranscript] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<{ text: string; files: string[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const log = (event: string) => setEvents((previous) => [...previous, event]);

  return (
    <section aria-labelledby="bench-interactive-title" id="bench-interactive" style={{ marginBlockEnd: "2rem" }}>
      <h2 id="bench-interactive-title">Interactive</h2>
      <p>
        <label>
          Show the overlay as{" "}
          <select id="force-voice-state" value={forced} onChange={(event) => setForced(event.target.value as "auto" | VoiceState)}>
            <option value="auto">whatever the pretend pipeline says</option>
            <option value="idle">idle</option>
            <option value="listening">listening</option>
            <option value="thinking">thinking</option>
            <option value="speaking">speaking</option>
          </select>
        </label>
      </p>
      <AiInput
        id="interactive"
        hint={HINT}
        maxLength={400}
        voiceState={forced === "auto" ? voice : forced}
        transcript={transcript}
        onTranscriptEdit={setTranscript}
        onVoiceStart={() => {
          log("start");
          if (timer.current) clearTimeout(timer.current);
          setTranscript("");
          setVoice("listening");
        }}
        onVoiceStop={() => {
          log("stop");
          setVoice("thinking");
          timer.current = setTimeout(() => {
            setTranscript("What is a quadratic equation?");
            setVoice("idle");
          }, 300);
        }}
        onVoiceCancel={() => {
          log("cancel");
          if (timer.current) clearTimeout(timer.current);
          setVoice("idle");
        }}
        onSubmit={(text, files) => {
          log("submit");
          setSubmitted({ text, files: files.map((file) => file.name) });
        }}
      />
      <p>
        Last submitted: <output id="last-submit" data-text={submitted?.text ?? ""} data-files={(submitted?.files ?? []).join("|")}>
          {submitted ? `${submitted.text} [${submitted.files.join(", ")}]` : "nothing yet"}
        </output>
      </p>
      <p>
        Events: <output id="events">{events.join(",")}</output>
      </p>
    </section>
  );
}

export function AiInputBench() {
  const [files, setFiles] = useState<File[]>(() => [
    sampleFile("quadratics-homework.pdf", "application/pdf", 482_000),
    sampleFile("working-out.png", "image/png", 2_300_000),
  ]);

  return (
    <>
      <Interactive />

      <section aria-labelledby="bench-attachments-title" id="bench-attachments" style={{ marginBlockEnd: "2rem" }}>
        <h2 id="bench-attachments-title">With attachments</h2>
        <AiInput
          id="attachments"
          hint={HINT}
          defaultValue="Can you check my working?"
          files={files}
          onFilesSelected={(picked) => setFiles((previous) => [...previous, ...picked])}
          onFileRemove={(_file, index) => setFiles((previous) => previous.filter((_, i) => i !== index))}
        />
      </section>

      <section aria-labelledby="bench-error-title" id="bench-error" style={{ marginBlockEnd: "2rem" }}>
        <h2 id="bench-error-title">Error</h2>
        <AiInput id="error" hint={HINT} error="You can attach up to 3 files. Remove one to add another." defaultValue="Here are my four photos" />
      </section>

      <section aria-labelledby="bench-busy-title" id="bench-busy" style={{ marginBlockEnd: "2rem" }}>
        <h2 id="bench-busy-title">Busy</h2>
        <AiInput id="busy" hint={HINT} busy defaultValue="Explain photosynthesis" />
      </section>

      <section aria-labelledby="bench-disabled-title" id="bench-disabled" style={{ marginBlockEnd: "2rem" }}>
        <h2 id="bench-disabled-title">Disabled</h2>
        <AiInput id="disabled" hint={HINT} disabled onVoiceStart={() => {}} />
      </section>

      <section aria-labelledby="bench-long-title" id="bench-long" style={{ marginBlockEnd: "2rem" }}>
        <h2 id="bench-long-title">Long text and a character limit</h2>
        <AiInput
          id="long"
          maxLength={120}
          defaultValue={"This question is long enough to wrap onto a second line and then a third, so the box grows with it. ".repeat(1)}
        />
      </section>
    </>
  );
}
