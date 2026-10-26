-- 0015_chat_message_model.sql — which model wrote an answer (the developer model picker, docs/ASSISTANT.md "Model picker").
--
-- When a developer chooses the model for a LearnThrive AI turn, the answer is stored with the model that actually produced it, so a
-- reopened chat still says "Answered by DeepSeek V4.1 Flash" or "Answered by Step 5 Preview" next to the right reply. It is the
-- identifier the provider reported for that request ("nim:deepseek-ai/deepseek-v4.1-flash"), never the one that was merely asked for.
--
--   * Nullable: ordinary turns (no picker) leave it empty, and every existing row stays as it was.
--   * Bounded and plain: an identifier, not text from the conversation. It is deleted with its message (30 days, or with the chat).
--   * Server only, like the rest of the table: RLS and grants are unchanged (0005_rls.sql). Re-runnable.

alter table public.chat_messages add column if not exists generated_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_generated_by_check') then
    alter table public.chat_messages
      add constraint chat_messages_generated_by_check
      check (generated_by is null or (role = 'assistant' and char_length(generated_by) between 1 and 120));
  end if;
end $$;

comment on column public.chat_messages.generated_by is
  'The provider and model that produced an assistant message, when a developer chose the model. Null otherwise.';
