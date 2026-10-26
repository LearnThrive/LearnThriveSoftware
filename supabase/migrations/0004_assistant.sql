-- 0004_assistant.sql — LearnThrive AI chats, uploads and usage counters.
--
-- Retention (defaults, owner to confirm): chat text 30 days, uploads 7 days, audio never stored.
-- The delete_after columns are the deadlines; the retention job (plan19 phase F) deletes rows whose
-- deadline has passed AND removes the matching storage objects (it must read chat_files.storage_path
-- first: deleting a row does not delete the private object). A user "deleting" a chat calls
-- public.request_chat_deletion(), which sets deletion_requested_at; the chat disappears from their
-- view at once and the same job purges it.
-- Messages and files are written only by the server.

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  student_id uuid references public.students (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 120),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '30 days'),
  deletion_requested_at timestamptz
);
create index if not exists chat_sessions_client_idx on public.chat_sessions (client_id, last_activity_at desc);
create index if not exists chat_sessions_delete_after_idx on public.chat_sessions (delete_after);
create index if not exists chat_sessions_deletion_requested_idx
  on public.chat_sessions (deletion_requested_at) where deletion_requested_at is not null;
comment on table public.chat_sessions is
  'A LearnThrive AI conversation owned by a family account (optionally for one of its students). delete_after: 30 days.';
comment on column public.chat_sessions.deletion_requested_at is
  'Set by public.request_chat_deletion() when the user deletes the chat. Hidden from the user immediately; purged (with its files in storage) by the retention job.';

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 32000),
  created_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '30 days'),
  check (delete_after > created_at)
);
create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index if not exists chat_messages_delete_after_idx on public.chat_messages (delete_after);
comment on table public.chat_messages is
  'Chat text. Never logged. Written by the server only. delete_after: 30 days from creation.';

create table if not exists public.chat_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  message_id uuid references public.chat_messages (id) on delete cascade,
  bucket text not null default 'chat-uploads' check (bucket = 'chat-uploads'),
  storage_path text not null unique
    check (storage_path !~ '^/' and storage_path !~ '\.\.' and char_length(storage_path) between 1 and 400),
  bytes bigint not null check (bytes > 0),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  created_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '7 days'),
  check (delete_after > created_at)
);
create index if not exists chat_files_session_idx on public.chat_files (session_id);
create index if not exists chat_files_delete_after_idx on public.chat_files (delete_after);
comment on table public.chat_files is
  'Uploads attached to a chat (private bucket chat-uploads). delete_after: 7 days, or earlier when the chat is deleted. Never used for training.';

-- Counters for caps and rate limits (assistant messages per day, per minute, and so on).
create table if not exists public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  unique (client_id, kind, window_start)
);
comment on table public.usage_counters is
  'Per account, per kind (for example assistant_message_day) and window start: how many used. Server increments; a family may read its own.';

drop trigger if exists usage_counters_touch on public.usage_counters;
create trigger usage_counters_touch
  before update on public.usage_counters
  for each row execute function private.touch_updated_at();
