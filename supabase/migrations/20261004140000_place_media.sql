-- The shared cache of what Wikipedia says about each place (docs/architecture/place-media.md).
-- One row per place key for every user. Only the API's secret-key client reads or writes it,
-- after loading the plan as the user. An operator corrects a wrong match by editing the row and
-- setting `pinned`, which stops refreshes overwriting it. Phase 2 fills `photo` and `credit`.

create table public.place_media (
  key            text primary key check (char_length(key) <= 200),
  status         text not null check (status in ('found', 'none', 'failed')),
  lookup_version int  not null,
  pinned         boolean not null default false,
  page_title     text,
  page_url       text,
  extract        text check (char_length(extract) <= 600),
  photo          jsonb,  -- { path, thumbPath, width, height }
  credit         jsonb,  -- { author, license, licenseUrl, sourceUrl }
  fetched_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

alter table public.place_media enable row level security;
revoke all on public.place_media from anon, authenticated;
