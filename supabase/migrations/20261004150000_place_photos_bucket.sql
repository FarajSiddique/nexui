-- The public bucket for place photos (docs/architecture/place-media.md). The API copies each
-- photo here once from Wikimedia Commons at 960px and 500px, so devices never load Wikimedia.
-- Anyone can read a file by its public URL through Supabase's CDN. There are no policies, so app
-- users can't list, upload or change files; only the API's secret-key client writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
