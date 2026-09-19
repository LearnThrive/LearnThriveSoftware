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

  // No background override here: the classroom paints its own (a cream page around dark stage
  // tiles). A navy one underneath made the pre-join hero render dark-on-dark.
  return (
    <div className="classroom-dev-container">
      <ClassroomClient isDevRoute={true} />
    </div>
  );
}
