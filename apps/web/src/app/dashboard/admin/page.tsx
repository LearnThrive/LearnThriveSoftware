import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "Admin",
  description: "LearnThrive administration.",
  path: "/dashboard/admin",
});

// The first role-restricted route in this platform — proves requireRole()/the 403 path for
// real, ahead of Phase C's actual Admin dashboard (people management, summary cards, etc.)
// having anything to guard yet. See docs/ROLE_PERMISSIONS.md.
export default async function AdminPage() {
  const user = await requireRole(["ADMIN"]);

  return (
    <div className="dashboard-page">
      <h1>Administration</h1>
      <p>
        Signed in as <strong>{user.name}</strong>. People management, tuition assignments,
        scheduling and reporting tools arrive here in later phases of this platform.
      </p>
    </div>
  );
}
