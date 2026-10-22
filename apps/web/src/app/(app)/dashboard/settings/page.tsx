import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ResetDevDataButton } from "@/components/ResetDevDataButton";
import { MotionToggle } from "@/components/MotionToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Dialog } from "@/components/ui/Dialog";
import { FormActions } from "@/components/ui/Field";
import { getDataProvider } from "@/lib/data/provider";
import { setReportApprovalAction } from "@/lib/actions/settings";

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

  // Admin only: the platform default for report approval, and how many assignments override it.
  let requireApproval = true;
  let overrides = 0;
  if (user.role === "ADMIN") {
    const data = getDataProvider();
    requireApproval = (await data.settings.get()).requireReportApproval;
    overrides = (await data.assignments.list()).filter((assignment) => assignment.requireReportApproval != null).length;
  }

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

        <Card>
          <CardHeader title="Appearance and motion" description="How this site looks and moves for you, on this device." />
          <CardBody>
            <div className="settings-appearance">
              <div>
                <p className="settings-appearance__label">Colour theme</p>
                <ThemeToggle variant="radio" />
                <p className="form-hint">System follows your device&apos;s light or dark setting.</p>
              </div>
              <div>
                <p className="settings-appearance__label">Motion</p>
                <MotionToggle />
                <p className="form-hint">
                  Reduce switches off animation and movement here, whatever your device says. If your
                  device already asks for reduced motion, this site always follows it.
                </p>
              </div>
            </div>
            <p className="form-hint">These choices are kept in this browser only and are never sent to LearnThrive.</p>
          </CardBody>
        </Card>

        {user.role === "ADMIN" && (
          <Card>
            <CardHeader
              title="Report approval"
              description="Whether a tutor's lesson report waits for an admin before families see it."
            />
            <CardBody>
              <dl className="detail-list">
                <div>
                  <dt>Platform default</dt>
                  <dd>
                    <Badge tone={requireApproval ? "info" : "warning"}>
                      {requireApproval ? "Approval required" : "Shared straight away"}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>Assignments that differ</dt>
                  <dd>
                    {overrides === 0
                      ? "None: every assignment follows the platform default."
                      : `${overrides} ${overrides === 1 ? "assignment sets" : "assignments set"} its own rule (see each assignment).`}
                  </dd>
                </div>
              </dl>
              <Dialog
                trigger="Change default"
                tone="secondary"
                title="Change the report approval default?"
                description="This decides what happens to reports tutors submit from now on."
              >
                <form action={setReportApprovalAction} className="form">
                  <div className="radio-group">
                    <label className="radio-option">
                      <input type="radio" name="requireReportApproval" value="true" defaultChecked={requireApproval} />
                      An admin approves each report before a parent or student can see it
                    </label>
                    <label className="radio-option">
                      <input type="radio" name="requireReportApproval" value="false" defaultChecked={!requireApproval} />
                      Reports are visible to the family as soon as the tutor submits them
                    </label>
                  </div>
                  <p className="form-hint">
                    Reports that already exist keep their current status, and an assignment with its own
                    rule keeps it. Families only ever see the parent-facing fields, never a tutor&apos;s
                    private notes.
                  </p>
                  <FormActions>
                    <button type="submit" className="btn btn--primary">Save default</button>
                  </FormActions>
                </form>
              </Dialog>
            </CardBody>
          </Card>
        )}

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
