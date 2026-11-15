// Permission resolution and the rules for changing roles, on plain data. The stores and the web app are held to the same rules elsewhere
// (rolesStore.test.ts, apps/web tests); this proves the rules themselves.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  can, holdsAny, normaliseRoles, PERMISSIONS, PERMISSIONS_BY_ROLE, permissionsOf, planRoleChange, primaryRole, ROLES, validateRoleSet, type Permission, type Role,
} from "./roles";

describe("permission resolution", () => {
  test("a person's permissions are the union of their roles' permissions", () => {
    const admin = permissionsOf(["ADMIN"]);
    const tutor = permissionsOf(["TUTOR"]);
    const both = permissionsOf(["ADMIN", "TUTOR"]);
    for (const p of [...admin, ...tutor]) assert.ok(both.has(p), `${p} is held through one role`);
    assert.equal(both.size, new Set([...admin, ...tutor]).size, "and nothing is added that neither role has");
  });

  test("a role never loses a permission by being combined with another", () => {
    for (const a of ROLES) for (const b of ROLES) {
      const union = permissionsOf([a, b]);
      for (const p of PERMISSIONS_BY_ROLE[a]) assert.ok(union.has(p), `${a}+${b} keeps ${a}'s ${p}`);
    }
  });

  test("a combination gains nothing a member role does not have: a student who is a junior tutor cannot administer, submit or approve", () => {
    const roles: Role[] = ["STUDENT", "JUNIOR_TUTOR"];
    for (const denied of ["admin.manage", "roles.assign", "report.approve", "report.submit", "tutor.availability", "family.view"] as Permission[]) {
      assert.equal(can(roles, denied), false, `student + junior tutor must not hold ${denied}`);
    }
    for (const allowed of ["learner.view", "classroom.learn", "attendance.mark", "report.draft", "classroom.teach", "concern.raise"] as Permission[]) {
      assert.equal(can(roles, allowed), true, `student + junior tutor holds ${allowed} through one of the two`);
    }
  });

  test("a tutor who is also an admin has both sets and no parent or learner permission", () => {
    const roles: Role[] = ["ADMIN", "TUTOR"];
    assert.ok(can(roles, "admin.manage") && can(roles, "tutor.availability") && can(roles, "report.approve"));
    assert.ok(!can(roles, "family.view") && !can(roles, "learner.view") && !can(roles, "classroom.learn"), "admin and tutor together are not also a parent or a learner");
  });

  test("a junior tutor's permissions are a strict subset of a tutor's", () => {
    const tutor = new Set(PERMISSIONS_BY_ROLE.TUTOR);
    const junior = PERMISSIONS_BY_ROLE.JUNIOR_TUTOR;
    assert.ok(junior.length > 0 && junior.every((p) => tutor.has(p)), "every junior permission is a tutor permission");
    assert.ok(junior.length < tutor.size, "and the junior has fewer");
    assert.deepEqual([...tutor].filter((p) => !junior.includes(p)).sort(), ["report.submit", "tutor.availability"], "what a junior cannot do is exactly this");
  });

  test("every permission is held by at least one role, and no role lists one that does not exist", () => {
    const all = new Set<Permission>(PERMISSIONS);
    for (const role of ROLES) for (const p of PERMISSIONS_BY_ROLE[role]) assert.ok(all.has(p), `${role} lists an unknown permission ${p}`);
    for (const p of PERMISSIONS) assert.ok(ROLES.some((r) => PERMISSIONS_BY_ROLE[r].includes(p)), `${p} is held by no role`);
  });

  test("an unknown role contributes nothing, and no roles means no permissions", () => {
    assert.equal(permissionsOf([]).size, 0);
    assert.equal(permissionsOf(["SUPERUSER" as Role]).size, 0);
    assert.equal(can([], "family.view"), false);
  });

  test("holdsAny: any one held role in the list is enough", () => {
    assert.equal(holdsAny(["STUDENT", "JUNIOR_TUTOR"], ["TUTOR", "JUNIOR_TUTOR"]), true);
    assert.equal(holdsAny(["STUDENT", "JUNIOR_TUTOR"], ["ADMIN"]), false);
  });
});

describe("a valid set of roles", () => {
  test("sets are stored in one canonical order, without duplicates", () => {
    assert.deepEqual(normaliseRoles(["STUDENT", "ADMIN", "STUDENT", "TUTOR"]), ["ADMIN", "TUTOR", "STUDENT"]);
    assert.equal(primaryRole(["STUDENT", "JUNIOR_TUTOR"]), "JUNIOR_TUTOR");
    assert.equal(primaryRole(["CLIENT", "ADMIN"]), "ADMIN");
    assert.equal(primaryRole([]), null);
  });

  test("tutor and junior tutor cannot coexist, so a union can never turn a junior into a full tutor", () => {
    const result = validateRoleSet(["TUTOR", "JUNIOR_TUTOR"]);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.problem.code, "EXCLUSIVE");
    assert.equal(validateRoleSet(["ADMIN", "TUTOR", "JUNIOR_TUTOR"]).ok, false, "even with other roles beside them");
    assert.equal(validateRoleSet(["ADMIN", "JUNIOR_TUTOR"]).ok, true);
  });

  test("a learner cannot also be a parent (the database refuses it too)", () => {
    assert.equal(validateRoleSet(["CLIENT", "STUDENT"]).ok, false);
    assert.equal(validateRoleSet(["CLIENT", "TUTOR"]).ok, true, "a parent who tutors is fine");
  });

  test("empty and unknown sets are refused", () => {
    assert.equal(!validateRoleSet([]).ok && (validateRoleSet([]) as { problem: { code: string } }).problem.code, "EMPTY");
    assert.equal(!validateRoleSet(["ADMIN", "OWNER"]).ok && (validateRoleSet(["ADMIN", "OWNER"]) as { problem: { code: string } }).problem.code, "UNKNOWN_ROLE");
    assert.equal(validateRoleSet(["admin"]).ok, false, "role names are exact");
    assert.equal(validateRoleSet([{ role: "ADMIN" }]).ok, false, "objects are not roles");
  });
});

describe("changing roles", () => {
  const admin = { actorId: "a1", actorRoles: ["ADMIN"] as Role[], targetId: "u1", targetRoles: ["STUDENT"] as Role[], adminCount: 2 };

  test("an administrator can add a role to someone else", () => {
    const plan = planRoleChange({ ...admin, requested: ["STUDENT", "JUNIOR_TUTOR"] });
    assert.deepEqual(plan, { ok: true, before: ["STUDENT"], after: ["JUNIOR_TUTOR", "STUDENT"], added: ["JUNIOR_TUTOR"], removed: [] });
  });

  test("and remove one", () => {
    const plan = planRoleChange({ ...admin, targetRoles: ["ADMIN", "TUTOR"], requested: ["ADMIN"] });
    assert.ok(plan.ok && plan.removed.join() === "TUTOR");
  });

  test("someone who is not an administrator is refused, whatever they asked for, and is told nothing else", () => {
    for (const actorRoles of [["TUTOR"], ["JUNIOR_TUTOR"], ["CLIENT"], ["STUDENT"], ["TUTOR", "STUDENT"], ["STUDENT", "JUNIOR_TUTOR"], []] as Role[][]) {
      for (const requested of [["ADMIN"], ["TUTOR", "JUNIOR_TUTOR"], [], ["NOPE"]]) {
        const plan = planRoleChange({ ...admin, actorRoles, requested });
        assert.equal(!plan.ok && plan.reason, "NOT_ADMIN", `${actorRoles.join("+") || "no roles"} asking for ${JSON.stringify(requested)}`);
      }
    }
  });

  test("a person cannot change their own roles, even an administrator promoting themselves or removing their own", () => {
    const self = { ...admin, targetId: admin.actorId, targetRoles: ["ADMIN"] as Role[] };
    assert.equal(!planRoleChange({ ...self, requested: ["ADMIN", "TUTOR"] }).ok && (planRoleChange({ ...self, requested: ["ADMIN", "TUTOR"] }) as { reason: string }).reason, "SELF");
    const plan = planRoleChange({ ...self, requested: ["TUTOR"] });
    assert.equal(!plan.ok && plan.reason, "SELF");
  });

  test("the last administrator cannot lose the admin role, but one of two can", () => {
    const last = { ...admin, targetRoles: ["ADMIN", "TUTOR"] as Role[], adminCount: 1 };
    const refused = planRoleChange({ ...last, requested: ["TUTOR"] });
    assert.equal(!refused.ok && refused.reason, "LAST_ADMIN");
    assert.ok(planRoleChange({ ...last, adminCount: 2, requested: ["TUTOR"] }).ok, "with another administrator it is allowed");
    assert.ok(planRoleChange({ ...last, requested: ["ADMIN"] }).ok, "dropping a different role is allowed while keeping admin");
  });

  test("tutor and junior tutor cannot be put together by a change", () => {
    const refused = planRoleChange({ ...admin, targetRoles: ["TUTOR"], requested: ["TUTOR", "JUNIOR_TUTOR"] });
    assert.equal(!refused.ok && refused.reason, "EXCLUSIVE");
    assert.ok(planRoleChange({ ...admin, targetRoles: ["TUTOR"], requested: ["JUNIOR_TUTOR"] }).ok, "but a tutor can be changed INTO a junior in one step");
  });

  test("emptying a person's roles, unknown roles and a no-op are refused", () => {
    assert.equal((planRoleChange({ ...admin, requested: [] }) as { reason: string }).reason, "EMPTY");
    assert.equal((planRoleChange({ ...admin, requested: ["STUDENT", "GOD"] }) as { reason: string }).reason, "UNKNOWN_ROLE");
    assert.equal((planRoleChange({ ...admin, requested: ["STUDENT"] }) as { reason: string }).reason, "UNCHANGED");
  });
});
