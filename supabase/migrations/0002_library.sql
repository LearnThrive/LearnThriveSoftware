-- 0002_library.sql — the Library catalogue and its private files.
--
-- resources      public catalogue columns only (safe to show to anyone while published)
-- resource_files storage paths and checksums; never readable by anon or signed-in users, only by
--                the server (service role), which issues short-lived signed URLs after canAccess().

-- text[] -> text for the generated search column. array_to_string is only STABLE (it can call
-- arbitrary element output functions); for text elements it is safe to treat as IMMUTABLE.
create or replace function private.tags_to_text(tags text[]) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.array_to_string(tags, ' ')
$$;

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  subject text not null check (char_length(btrim(subject)) between 1 and 80),
  level text not null check (level in ('KS2', 'KS3', 'GCSE', 'A Level', '11+')),
  exam_board text check (exam_board is null or char_length(btrim(exam_board)) between 1 and 40),
  topic text not null check (char_length(btrim(topic)) between 1 and 120),
  resource_type text not null check (resource_type in ('worksheet', 'exam paper', 'mark scheme', 'notes')),
  year_group text check (year_group is null or char_length(year_group) <= 40),
  tags text[] not null default '{}',
  version integer not null default 1 check (version >= 1),
  access_tier text not null default 'members' check (access_tier in ('free_sample', 'members')),
  -- The import tool refuses a resource without authorship; the database refuses it too. It must
  -- contain at least one letter or digit, so '', spaces, tabs and '---' are all rejected.
  authorship text not null check (authorship ~ '[[:alnum:]]'),
  -- null = draft. A date in the future = scheduled. Visible to the public only once it has passed.
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(subject, '') || ' ' || private.tags_to_text(tags)), 'B')
    || setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored
);
comment on table public.resources is
  'Library catalogue (company-authored material only). Holds no file paths. Public read is limited to published rows by RLS.';
comment on column public.resources.authorship is
  'Who made it. Mandatory: past papers from exam boards are not redistributed.';
comment on column public.resources.access_tier is
  'free_sample: downloadable by any signed-in account; members: needs an active entitlement. Enforced by canAccess() on the server, not by RLS.';
comment on column public.resources.published_at is
  'null = draft; future = scheduled. Visible to anon/authenticated only once published_at <= now().';
comment on column public.resources.search is
  'Full-text vector over title (A), topic/subject/tags (B) and description (C). Query with websearch_to_tsquery(''english'', ...).';

create index if not exists resources_search_idx on public.resources using gin (search);
create index if not exists resources_tags_idx on public.resources using gin (tags);
create index if not exists resources_browse_idx on public.resources (subject, level, published_at desc);

drop trigger if exists resources_touch on public.resources;
create trigger resources_touch
  before update on public.resources
  for each row execute function private.touch_updated_at();

create table if not exists public.resource_files (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources (id) on delete cascade,
  bucket text not null default 'library' check (bucket = 'library'),
  storage_path text not null unique
    check (storage_path !~ '^/' and storage_path !~ '\.\.' and char_length(storage_path) between 1 and 400),
  bytes bigint not null check (bytes > 0),
  content_type text not null check (content_type ~ '^[a-z]+/[a-z0-9.+-]+$'),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists resource_files_resource_id_idx on public.resource_files (resource_id);
comment on table public.resource_files is
  'Private storage objects (bucket library). Server only (service role): never exposed to anon or signed-in users; downloads go through canAccess() and a 60 second signed URL.';

-- ============================== PHASE H PLACEHOLDER (do not create yet) ==============================
-- The pgvector chunk table for answers grounded in the Library arrives with plan19 phase H, as its own
-- later migration (for example 0006_library_embeddings.sql), only if LearnThrive AI passes its gates:
--   create extension if not exists vector with schema extensions;
--   create table public.resource_chunks (resource_id, chunk_index, content, embedding vector(1024), ...);
-- It must copy resources.access_tier, and its RLS must be service-role only: retrieval filters by the
-- caller's entitlement on the server so members-only text can never reach someone without access.
-- ====================================================================================================
