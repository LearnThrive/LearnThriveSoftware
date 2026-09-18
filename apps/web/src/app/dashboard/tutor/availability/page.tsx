import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { addAvailabilityAction, removeAvailabilityAction } from "@/lib/actions/availability";

export const metadata: Metadata = createMetadata({
  title: "My Availability",
  description: "Set your recurring weekly availability.",
  path: "/dashboard/tutor/availability",
});

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TutorAvailabilityPage() {
  const user = await requireRole(["TUTOR"]);
  if (!user.profileId) {
    return <div className="dashboard-page"><h1>My Availability</h1><p>Your account isn&apos;t linked to a Tutor profile yet — contact an Admin.</p></div>;
  }
  const data = getDataProvider();
  const blocks = await data.availability.forTutor(user.profileId);
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  return (
    <div className="dashboard-page">
      <h1>My Availability</h1>
      <p>Recurring weekly availability, shown to Admin while scheduling lessons — this doesn&apos;t automatically book anything.</p>

      <ul className="people-list">
        {sorted.length === 0 && <li className="people-list__empty">No availability set yet.</li>}
        {sorted.map((block) => (
          <li key={block.id}>
            {WEEKDAY_NAMES[block.weekday]}, {block.startTime}–{block.endTime}
            <span className="people-list__meta">{block.type === "AVAILABLE" ? "Available" : "Unavailable"}</span>
            <form action={removeAvailabilityAction} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="blockId" value={block.id} />
              <button type="submit" className="button-text">Remove</button>
            </form>
          </li>
        ))}
      </ul>

      <details className="people-add" open={sorted.length === 0}>
        <summary>Add availability block</summary>
        <form action={addAvailabilityAction} className="login-form">
          <div className="form-field">
            <label htmlFor="availability-weekday">Day of week</label>
            <select id="availability-weekday" name="weekday" required defaultValue="">
              <option value="" disabled>Choose a day</option>
              {WEEKDAY_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </div>
          <div className="form-field"><label htmlFor="availability-start">Start time</label><input id="availability-start" name="startTime" type="time" required /></div>
          <div className="form-field"><label htmlFor="availability-end">End time</label><input id="availability-end" name="endTime" type="time" required /></div>
          <div className="form-field">
            <label htmlFor="availability-type">Type</label>
            <select id="availability-type" name="type" defaultValue="AVAILABLE">
              <option value="AVAILABLE">Available</option>
              <option value="UNAVAILABLE">Unavailable (an exception within an available week)</option>
            </select>
          </div>
          <div className="form-actions"><button type="submit" className="button button--primary"><span>Add block</span></button></div>
        </form>
      </details>
    </div>
  );
}
