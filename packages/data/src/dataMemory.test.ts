import { randomUUID } from "node:crypto";
import { resetDataProvider } from "./inMemoryProvider";
import { dataProviderContract } from "./testing/dataProviderContract";

dataProviderContract("in-memory", async () => {
  const provider = resetDataProvider();
  return {
    close: async () => {},
    harness: {
      provider,
      derivesFamilies: false,
      family: async (name = "Family") => {
        const userId = randomUUID();
        const client = await provider.clients.create({ userId, name, email: `${randomUUID()}@example.test`, active: true });
        return { clientId: client.id, userId };
      },
      login: async () => randomUUID(),
    },
  };
});
