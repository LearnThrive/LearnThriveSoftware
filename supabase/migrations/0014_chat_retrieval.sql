-- 0014_chat_retrieval.sql — the authorised chunk index for Study Buddy's retrieval role (three-model brief section 9).
--
-- Two things the tutor needs that a chat's uploads did not store:
--   1. What a document SAID, once, so a follow-up ("and question 4b?") does not re-read and re-render the whole PDF (and re-send
--      its pages as pictures) on every turn. `extracted_text` is that transcription; `pages` is how many pages were read.
--   2. Short chunks of a student's own authorised uploads, with their embedding, so a follow-up can retrieve the relevant piece
--      even when the question names no page. Retrieval is a convenience on top of the original file, never a second copy of it.
--
-- Embeddings are `real[]` and cosine similarity is computed in the application over owner-filtered candidates: no pgvector
-- extension, so no new database image or index type to operate. A row is only ever read through a repository call that names the
-- owning family AND learner, and the API roles cannot reach the table at all.
--
--   * One row set per file: chunking a file again replaces its chunks atomically (see the repository), and a unique ordinal keeps
--     a partial re-index from duplicating a chunk.
--   * Model identity is part of the row (`model`, `digest`, `dimension`, `chunk_config_version`): switching embedding model or
--     chunking must re-index, even if the dimension happens to match, so a query is only compared with same-model vectors.
--   * Retention follows the upload: deleting a chat file (7 days, chat deletion) cascades to its chunks. The retention job deletes
--     chat_files, so nothing here outlives its source.
--   * Server only: RLS on and forced, no policy, no grant to anon or authenticated. Re-runnable.
--
-- The embedding of a photo is of the text read from it (a transcription), never of the pixels: the text embedding model does not
-- look at images, and this file does not pretend it does.

alter table public.chat_files add column if not exists extracted_text text
  check (extracted_text is null or char_length(extracted_text) <= 32000);
alter table public.chat_files add column if not exists pages integer
  check (pages is null or (pages >= 1 and pages <= 100));
comment on column public.chat_files.extracted_text is
  'The text read from the upload (PDF text layer, a transcription of pictured pages, or the photo description), kept so a follow-up does not re-read and re-render the file. Retention follows the file.';

create table if not exists public.chat_file_chunks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.chat_files (id) on delete cascade,
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  page integer check (page is null or (page >= 1 and page <= 100)),
  label text check (label is null or char_length(label) <= 40),
  ordinal integer not null check (ordinal >= 0 and ordinal < 500),
  text text not null check (char_length(text) between 1 and 4000),
  model text not null check (char_length(model) between 1 and 120),
  digest text check (digest is null or char_length(digest) <= 120),
  dimension integer not null check (dimension between 1 and 8192),
  chunk_config_version text not null check (char_length(chunk_config_version) between 1 and 40),
  embedding real[] not null check (array_length(embedding, 1) = dimension),
  created_at timestamptz not null default now(),
  unique (file_id, ordinal)
);
create index if not exists chat_file_chunks_file_idx on public.chat_file_chunks (file_id, ordinal);
create index if not exists chat_file_chunks_session_idx on public.chat_file_chunks (session_id);
comment on table public.chat_file_chunks is
  'Chunks of one student upload with their embedding (real[]; cosine in application code). Owner-scoped by the session, cascades with chat_files, no API grants.';

alter table public.chat_file_chunks enable row level security;
alter table public.chat_file_chunks force row level security;
