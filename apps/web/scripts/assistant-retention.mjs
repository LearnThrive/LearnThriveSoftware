#!/usr/bin/env node
/**
 * Study Buddy retention job (plan19 section 5.3). Run it daily (a cron job on Render; docs/ASSISTANT.md).
 *
 *   npm run assistant:retention
 *
 * Removes chat text 30 days after a chat's last message, uploads after 7 days or when their chat is deleted, and chats the family
 * deleted. Files in the private `chat-uploads` bucket are deleted FIRST and the database rows only if every file went, so a
 * failure leaves everything in place for the next run. Needs DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment (never printed). Prints counts only: no chat text, no file name, no address.
 */
import { SqlLibraryStore } from "@learnthrive/data/library";
import { createExecutor } from "../src/lib/db.ts";
import { runRetention } from "../src/lib/assistant/retention.ts";
import { SupabaseLibraryStorage, CHAT_UPLOADS_BUCKET } from "../src/lib/library/storage.ts";

const env = process.env;
for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!env[key]?.trim()) {
    console.error(`${key} is required.`);
    process.exit(2);
  }
}
const { executor, close } = await createExecutor(env.DATABASE_URL.trim());
try {
  const report = await runRetention({
    store: new SqlLibraryStore(executor),
    storage: new SupabaseLibraryStorage({ url: env.SUPABASE_URL.trim(), serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), bucket: CHAT_UPLOADS_BUCKET }),
  });
  console.log(`Files removed from storage: ${report.objectsRemoved}. Failed: ${report.failed}.`);
  if (report.purged) console.log(`Purged: ${report.purged.sessions} chat(s), ${report.purged.messages} message(s), ${report.purged.files} file record(s).`);
  else {
    console.error("Some files could not be deleted, so no rows were purged. Run again.");
    process.exitCode = 1;
  }
} finally {
  await close();
}
