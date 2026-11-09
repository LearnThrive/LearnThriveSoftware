import { randomUUID } from "node:crypto";
import { resetDataProvider } from "./inMemoryProvider";
import { createMemorySafeguarding } from "./safeguarding";
import { safeguardingContract } from "./testing/safeguardingContract";

safeguardingContract("in-memory", async () => {
  const provider = resetDataProvider();
  return {
    close: async () => {},
    harness: {
      repo: createMemorySafeguarding(async (id) => (await provider.tutors.get(id)) !== null),
      tutor: async () => (await provider.tutors.create({ name: "Tutor", email: `${randomUUID()}@example.test`, subjects: ["Maths"], active: true })).id,
      login: async () => randomUUID(),
    },
  };
});
