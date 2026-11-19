-- 0030_lesson_chat_file_types.sql — lesson chat accepts every document, image, audio, video, text and zip type the meetings chat does (docs/LESSON_CHAT.md).
--
-- 0027 allowed only png, jpg and pdf. PNG, JPEG and PDF are still judged by their bytes; every other allowed type is judged by its extension, kept as sent
-- and served only as a download, and is stored under a generated key ending .bin. So the type list and the key shape are loosened here; the size cap,
-- the generated-key rule and the plain-display-name rule stay.
-- Re-runnable.

alter table public.lesson_files drop constraint if exists lesson_files_content_type_check;
alter table public.lesson_files add constraint lesson_files_content_type_check check (char_length(content_type) between 3 and 150 and content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' and content_type !~ '^(text/html|application/xhtml|text/javascript|application/javascript|application/x-(msdownload|sh|msdos-program)|application/octet-stream)');
alter table public.lesson_files drop constraint if exists lesson_files_storage_key_check;
alter table public.lesson_files add constraint lesson_files_storage_key_check check (storage_key ~ '^lessons/[A-Za-z0-9_-]{1,80}/[0-9a-f-]{36}\.(png|jpg|pdf|bin)$');

alter table public.lesson_file_objects drop constraint if exists lesson_file_objects_content_type_check;
alter table public.lesson_file_objects add constraint lesson_file_objects_content_type_check check (char_length(content_type) between 3 and 150 and content_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' and content_type !~ '^(text/html|application/xhtml|text/javascript|application/javascript|application/x-(msdownload|sh|msdos-program)|application/octet-stream)');
alter table public.lesson_file_objects drop constraint if exists lesson_file_objects_storage_key_check;
alter table public.lesson_file_objects add constraint lesson_file_objects_storage_key_check check (storage_key ~ '^lessons/[A-Za-z0-9_-]{1,80}/[0-9a-f-]{36}\.(png|jpg|pdf|bin)$');
