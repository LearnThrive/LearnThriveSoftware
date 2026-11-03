import { randomUUID } from "node:crypto";
import { InMemoryLibraryStore } from "./library";
import { accountContract } from "./testing/accountContract";

accountContract("in-memory", async () => {
  const store = new InMemoryLibraryStore();
  return {
    close: async () => {},
    harness: {
      store,
      login: async () => store.seedProfile({ adultConfirmed: false }),
      tutor: async () => randomUUID(),
      family: async () => {
        const guardian = store.seedProfile();
        const clientId = await store.accounts.ensureClient(guardian);
        return { guardian, clientId, studentId: store.seedStudent(guardian) };
      },
      auditRows: async (action, actor) => store.auditEntries().filter((row) => row.action === action && row.actorProfileId === actor),
    },
  };
});
