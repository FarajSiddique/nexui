-- The timeline can be narrowed to one kind (the Notes tab asks for notes only). Postgres
-- overloads functions by argument list, so the old three-argument version is dropped
-- rather than left beside the new one.

drop function if exists public.timeline_page(integer, timestamp, uuid);

-- Keyset page: rows strictly after the cursor, newest first, of one kind when
-- `kind_filter` is given (null means every kind). The API asks for one extra row to learn
-- whether another page exists.
create function public.timeline_page(
  page_size integer,
  cursor_sort_at timestamp default null,
  cursor_id uuid default null,
  kind_filter text default null
)
returns setof public.timeline_items
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.timeline_items
  where (cursor_sort_at is null or (sort_at, id) < (cursor_sort_at, cursor_id))
    and (kind_filter is null or kind = kind_filter)
  order by sort_at desc, id desc
  limit least(page_size, 101);
$$;

revoke execute on function public.timeline_page(integer, timestamp, uuid, text)
  from public, anon;
grant execute on function public.timeline_page(integer, timestamp, uuid, text)
  to authenticated;
