-- 0016_chat_message_activity.sql — what Study Buddy did to prepare an answer (the activity panel, docs/ASSISTANT.md "Activity panel").
--
-- An answer can carry a short record of the real work done for it: that it searched, which pages it read (title, site and a sanitised link), that it
-- checked quotations and working, and whether it had to correct a draft. A reopened chat shows the same collapsed "Research and verification
-- completed" row with the same sources, kept apart from the answer text.
--
--   * Nullable: ordinary turns leave it empty, and every existing row stays as it was.
--   * Small and plain: a JSON document of at most 6,000 characters, written by the server. It holds labels, counts, page titles and links. It never
--     holds a search query, the model's hidden reasoning, a draft that was rejected, a page's text, or an internal address.
--   * It is deleted with its message (30 days, or with the chat). Server only, like the rest of the table: RLS and grants are unchanged. Re-runnable.

alter table public.chat_messages add column if not exists activity text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_activity_check') then
    alter table public.chat_messages
      add constraint chat_messages_activity_check
      check (activity is null or (role = 'assistant' and char_length(activity) between 2 and 6000));
  end if;
end $$;

comment on column public.chat_messages.activity is
  'A bounded JSON record of the research and checks done for an assistant message: steps, counts and the pages read. No queries, no reasoning.';
