import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ResetDevDataButton } from "@/components/ResetDevDataButton";

export const metadata: Metadata = createMetadata({
  title: "Settings",
  description: "Your account details.",
  path: "/dashboard/settings",
});

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", TUTOR: "Tutor", CLIENT: "Parent or guardian", STUDENT: "Student",
};

const ROLE_SUMMARY: Record<string, string> = {
  ADMIN: "Full access to people, scheduling, reports and platform settings.",
  TUTOR: "Your own lessons, students, availability and reports.",
  CLIENT: "Your children's lessons and their approved reports.",
  STUDENT: "Your own lessons and the feedback shared with you.",
};

// Plan6 section 73. Development-only controls live here and nowhere else — never scattered
// across ordinary working pages.
export default async function SettingsPage() {
  const user = await requireSession();
  const isDevelopment = process.env.NODE_ENV !== "production";

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" description="Your details and how this account is set up." />

      <div className="settings-grid">
        <Card>
          <CardHeader title="Account" description="Your name, sign-in email and role on the platform." />
          <CardBody>
            <div className="settings-identity">
              <Avatar name={user.name} size="lg" />
              <div>
                <p className="settings-identity__name">{user.name}</p>
                <p className="settings-identity__email">{user.email}</p>
              </div>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Role</dt>
                <dd><Badge tone="info">{ROLE_LABELS[user.role]}</Badge></dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>{ROLE_SUMMARY[user.role]}</dd>
              </div>
            </dl>
            <p className="form-hint">
              Your name, email and role are managed by LearnThrive. Ask an admin if any of these need changing.
            </p>
          </CardBody>
        </Card>

        {isDevelopment && (
          <Card>
            <CardHeader
              title="Development environment"
              description="This build runs on temporary data that resets whenever the server restarts."
            />
            <CardBody>
              <p className="form-hint" style={{ marginTop: 0 }}>
                Resetting returns everything — people, lessons, reports and notifications — to the
                original demo scenario. Anything added while trying the product out is discarded.
              </p>
              {user.role === "ADMIN" ? (
                <ResetDevDataButton />
              ) : (
                <p className="form-hint">Only an admin can reset the demo data.</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
