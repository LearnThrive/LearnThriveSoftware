-- The two private buckets (plan20). Re-runnable: applying it again only restores these settings.
--
--   library       the Library's PDFs. Private. PDF only. 25 MB, the import tool's own maximum (LIBRARY_FILE_MAX_BYTES).
--   chat-uploads  Study Buddy's uploads and the Paper Tutor's annotated PDFs. Private. JPEG, PNG or PDF. 15 MB.
--
-- NO storage policies are created for anon or authenticated, on purpose. Row level security is on for storage.objects, so with no
-- policy a browser (with the publishable key, or a signed-in user's token) can neither list nor read nor write an object. Only the
-- server, using the service role (which bypasses row level security), reads and writes, and hands a family a 60 second signed URL
-- after its own access check. Do not add a policy here or in the dashboard: supabase-verify and the local-stack tests fail if one
-- appears. The bucket-level limits below are enforced by Storage itself, in addition to the checks the site makes before uploading.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('library', 'library', false, 26214400, array['application/pdf']),
  ('chat-uploads', 'chat-uploads', false, 15728640, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
