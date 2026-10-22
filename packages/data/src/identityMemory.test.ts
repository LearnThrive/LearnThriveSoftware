import { InMemoryLibraryStore } from "./library";
import { identityContract } from "./testing/identityContract";

identityContract("in-memory", async () => {
  const store = new InMemoryLibraryStore();
  return {
    close: async () => {},
    harness: {
      store,
      profile: async (o) => store.seedProfile({ role: o?.role, adultConfirmed: o?.adult ?? true, email: o?.email }),
      student: async (profileId, o) => store.seedStudent(profileId, o),
      guardianLink: async (studentId, profileId, status) => store.seedGuardianLink(studentId, profileId, status),
      assignment: async (studentId, status) => store.seedAssignment(studentId, status),
      setAssignment: async (id, status) => store.setAssignmentStatus(id, status),
      entitlement: async (profileId, source, startsAt, endsAt) => store.seedEntitlement(profileId, source, startsAt, endsAt),
    },
  };
});
