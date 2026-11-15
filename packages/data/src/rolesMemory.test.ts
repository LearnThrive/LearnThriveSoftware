import { randomUUID } from "node:crypto";
import { InMemoryLibraryStore } from "./library";
import { rolesContract } from "./testing/rolesContract";

rolesContract("in-memory", async () => {
  const store = new InMemoryLibraryStore();
  return {
    close: async () => {},
    harness: {
      store,
      bare: async (roles) => store.seedProfile({ roles }),
      person: async (roles) => {
        const profileId = store.seedProfile({ roles });
        let tutorId: string | null = null;
        let studentId: string | null = null;
        if (roles.includes("TUTOR") || roles.includes("JUNIOR_TUTOR")) {
          tutorId = randomUUID();
          store.seedTutorRef(profileId, tutorId);
        }
        if (roles.includes("STUDENT")) {
          studentId = store.seedStudent(store.seedProfile({}), { displayName: "Kid", isMinor: true });
          store.seedLearner(studentId, profileId);
        }
        return { profileId, tutorId, studentId };
      },
    },
  };
});
