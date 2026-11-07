import { randomUUID } from "node:crypto";
import { resetDataProvider } from "./inMemoryProvider";
import { tuitionBillingContract } from "./testing/tuitionBillingContract";
import { createMemoryTuitionBilling } from "./tuitionBilling";

tuitionBillingContract("in-memory", async () => {
  const provider = resetDataProvider();
  return {
    close: async () => {},
    harness: {
      repo: createMemoryTuitionBilling(),
      provider,
      family: async (name = "Family") => {
        const userId = randomUUID();
        const client = await provider.clients.create({ userId, name, email: `${randomUUID()}@example.test`, active: true });
        return { clientId: client.id, userId };
      },
      login: async () => randomUUID(),
    },
  };
});
