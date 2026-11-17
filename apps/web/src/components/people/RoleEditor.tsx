"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Role } from "@learnthrive/data/roles";

/**
 * One person's roles as a set of toggles. Roles that can never be held together (Tutor and Junior tutor; Parent and Student) lock each other
 * out while one is on, with the reason shown, so the form cannot be sent in a state the server would refuse. Save is only live once something
 * has changed. The server action re-checks everything (who may assign roles, the pairs, never your own roles, never the last administrator).
 */
export function RoleEditor({ profileId, roles, order, labels, descriptions, exclusive, self, action }: {
  profileId: string;
  roles: readonly Role[];
  order: readonly Role[];
  labels: Record<Role, string>;
  descriptions: Record<Role, string>;
  exclusive: ReadonlyArray<readonly [Role, Role]>;
  self: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<Role>>(new Set(roles));
  const partnerOf = (role: Role): Role | null => {
    const pair = exclusive.find(([a, b]) => a === role || b === role);
    return pair ? (pair[0] === role ? pair[1] : pair[0]) : null;
  };
  const added = order.filter((role) => chosen.has(role) && !roles.includes(role));
  const removed = order.filter((role) => !chosen.has(role) && roles.includes(role));
  const changed = added.length + removed.length > 0;

  function toggle(role: Role, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(role); else next.delete(role);
      return next;
    });
  }

  return (
    <form action={action} className="role-editor">
      <input type="hidden" name="profileId" value={profileId} />
      <fieldset className="role-editor__options" disabled={self}>
        <legend className="sr-only">Roles</legend>
        {order.map((role) => {
          const on = chosen.has(role);
          const partner = partnerOf(role);
          const blocked = !on && partner !== null && chosen.has(partner);
          return (
            <label key={role} className={`role-toggle ${on ? "is-on" : ""} ${blocked ? "is-blocked" : ""}`}>
              <input type="checkbox" name="roles" value={role} checked={on} disabled={blocked} onChange={(event) => toggle(role, event.target.checked)} />
              <span className="role-toggle__box" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
              <span className="role-toggle__text">
                <span className="role-toggle__name">{labels[role]}</span>
                <span className="role-toggle__desc">{blocked && partner ? `Not with ${labels[partner]}` : descriptions[role]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="role-editor__footer">
        <p className="role-editor__note" aria-live="polite">
          {self
            ? "You cannot change your own roles. Ask another administrator."
            : changed
              ? [added.length ? `Adds ${added.map((r) => labels[r]).join(", ")}` : "", removed.length ? `Removes ${removed.map((r) => labels[r]).join(", ")}` : ""].filter(Boolean).join(" · ")
              : chosen.size === 0 ? "No roles: this person can sign in but see nothing." : "No changes."}
        </p>
        {!self && (
          <div className="role-editor__actions">
            <button type="button" className="btn btn--ghost btn--sm" disabled={!changed} onClick={() => setChosen(new Set(roles))}>Undo</button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={!changed}>Save roles</button>
          </div>
        )}
      </div>
    </form>
  );
}
