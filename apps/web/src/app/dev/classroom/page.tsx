import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClassroomClient } from "@/features/classroom/ClassroomClient";

export const metadata: Metadata = {
  title: "Classroom Test Lab | LearnThrive",
  robots: { index: false, follow: false },
};

export default function DevClassroomPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="classroom-dev-container" style={{ minHeight: "100vh", background: "#0e2a47" }}>
      <ClassroomClient isDevRoute={true} />
    </div>
  );
}
