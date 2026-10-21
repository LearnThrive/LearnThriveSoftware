"use client";

import dynamic from "next/dynamic";
import { PencilLoader } from "@/components/ui/PencilLoader";

// The whole assistant (the chat client, the Markdown reader, KaTeX) is a separate chunk, fetched only on this screen.
const StudyBuddy = dynamic(() => import("./StudyBuddy").then((m) => m.StudyBuddy), {
  ssr: false,
  loading: () => (
    <div style={{ display: "grid", placeItems: "center", minHeight: "12rem" }}>
      <PencilLoader size="md" label="Opening Study Buddy" />
    </div>
  ),
});

export function StudyBuddyLoader() {
  return <StudyBuddy />;
}
