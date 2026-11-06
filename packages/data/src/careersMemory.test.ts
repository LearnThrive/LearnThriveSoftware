import { randomUUID } from "node:crypto";
import { MemoryCareersStore } from "./careers";
import { careersContract } from "./testing/careersContract";

careersContract("memory", async () => ({
  close: async () => {},
  harness: { store: new MemoryCareersStore(), admin: async () => randomUUID() },
}));
