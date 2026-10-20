import { InMemoryLibraryStore } from "./library";
import { libraryContract } from "./testing/libraryContract";

libraryContract("in-memory", async () => {
  const store = new InMemoryLibraryStore();
  const students = new Map<string, string>();
  return {
    close: async () => {},
    harness: {
      store,
      profile: async (o) => store.seedProfile({ role: o?.role, adultConfirmed: o?.adult ?? true }),
      student: async (profileId) => {
        const id = store.seedStudent(profileId);
        students.set(id, profileId);
        return id;
      },
      assignment: async (studentId, status) => void store.seedAssignment(studentId, status),
      entitlement: async (profileId, source, startsAt, endsAt) => store.seedEntitlement(profileId, source, startsAt, endsAt),
    },
  };
});
