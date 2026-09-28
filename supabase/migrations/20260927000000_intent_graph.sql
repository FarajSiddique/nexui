-- Nexui intent graph: intents, their objects and relationships, the event log of changesets,
-- workspace docs and AI runs. Clients only read (owner-only RLS). Every write goes through
-- the security definer functions at the end, which check auth.uid() and scope each statement
-- to the caller. See docs/architecture/intent-graph.md.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 500),
  template text check (template in ('travel', 'job_search')),
  status text not null default 'exploring'
    check (status in ('exploring', 'active', 'blocked', 'completed', 'archived')),
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  summary jsonb not null default '{"line":""}' check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid not null references public.intents (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z_]{1,40}$'),
  kind_version integer not null default 1 check (kind_version >= 1),
  title text check (char_length(title) <= 200),
  status text check (char_length(status) <= 40),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  source jsonb check (source is null or jsonb_typeof(source) = 'object'),
  position double precision,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `intent_id` is the owning intent, used for loading. Endpoints may later point into other
-- intents; they're checked against the caller's own rows when written.
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid not null references public.intents (id) on delete cascade,
  source_type text not null check (source_type in ('object', 'intent')),
  source_id uuid not null,
  target_type text not null check (target_type in ('object', 'intent')),
  target_id uuid not null,
  type text not null check (type ~ '^[a-z][a-z_]{0,39}$'),
  metadata jsonb check (metadata is null or jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Append-only. A changeset row keeps [{op, table, id, before, after, origin}] so Undo can
-- restore `before`; an Undo is itself a changeset with `reverts_event_id` set.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete cascade,
  seq bigint generated always as identity,
  type text not null check (char_length(type) between 1 and 40),
  actor text not null check (actor in ('user', 'derived', 'ai', 'system')),
  run_id uuid,
  reverts_event_id uuid references public.events (id) on delete cascade,
  ops jsonb check (ops is null or jsonb_typeof(ops) = 'array'),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.workspaces (
  intent_id uuid primary key references public.intents (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  version integer not null default 1,
  doc jsonb not null check (jsonb_typeof(doc) = 'object'),
  updated_at timestamptz not null default now()
);

-- Long AI work (intelligence plan). Created now so Realtime and RLS are in place.
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  intent_id uuid references public.intents (id) on delete cascade,
  kind text not null check (kind in ('create_intent', 'ask')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null,
  progress jsonb not null default '[]',
  error text,
  model_usage jsonb not null default '{}',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create trigger intents_set_updated_at before update on public.intents
  for each row execute function public.set_updated_at();
create trigger objects_set_updated_at before update on public.objects
  for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

create index intents_user_activity_idx on public.intents (user_id, status, last_activity_at desc);
create index objects_intent_kind_idx on public.objects (intent_id, kind) where deleted_at is null;
create index relationships_intent_idx on public.relationships (intent_id) where deleted_at is null;
create index relationships_source_idx on public.relationships (source_id, type);
create index relationships_target_idx on public.relationships (target_id, type);
create unique index relationships_live_unique
  on public.relationships (source_id, target_id, type) where deleted_at is null;
create index events_user_seq_idx on public.events (user_id, seq desc);
create index events_intent_seq_idx on public.events (intent_id, seq desc);
-- One Undo per event; also the backstop for two Undos racing.
create unique index events_reverts_unique on public.events (reverts_event_id)
  where reverts_event_id is not null;
create index runs_intent_idx on public.runs (intent_id, created_at desc);

alter table public.intents enable row level security;
alter table public.objects enable row level security;
alter table public.relationships enable row level security;
alter table public.events enable row level security;
alter table public.workspaces enable row level security;
alter table public.runs enable row level security;

revoke all on
  public.intents, public.objects, public.relationships, public.events, public.workspaces, public.runs
  from anon, authenticated;

grant select on
  public.intents, public.objects, public.relationships, public.events, public.workspaces, public.runs
  to authenticated;

create policy "Owners read intents" on public.intents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read objects" on public.objects for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read relationships" on public.relationships for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read events" on public.events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read workspaces" on public.workspaces for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners read runs" on public.runs for select to authenticated
  using (user_id = (select auth.uid()));

alter publication supabase_realtime add table
  public.objects, public.relationships, public.workspaces, public.events, public.runs;

-- A relationship endpoint must be one of the caller's live objects or intents.
create function private.check_endpoint(p_user uuid, p_type text, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_type = 'object' then
    perform 1 from public.objects where id = p_id and user_id = p_user and deleted_at is null;
  elsif p_type = 'intent' then
    perform 1 from public.intents where id = p_id and user_id = p_user;
  else
    raise exception 'Unknown endpoint type' using errcode = 'NXU22';
  end if;

  if not found then
    raise exception 'That item no longer exists' using errcode = 'NXU04';
  end if;
end;
$$;

-- A provided `source` must be JSON null or an object naming who made the change.
create function private.check_source(p_source jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_source is null or jsonb_typeof(p_source) = 'null' then
    return;
  end if;

  if jsonb_typeof(p_source) <> 'object'
    or (p_source ->> 'type') not in ('user', 'ai', 'derived', 'external')
  then
    raise exception 'Invalid source' using errcode = 'NXU22';
  end if;
end;
$$;

-- Applies one changeset for p_user and logs it. The callers have already locked the intent
-- and checked that p_user owns it. A row may appear only once per changeset.
create function private.apply_ops(
  p_user uuid,
  p_intent_id uuid,
  p_actor text,
  p_run_id uuid,
  p_ops jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  op jsonb;
  op_kind text;
  patch jsonb;
  target_table text;
  row_id uuid;
  before_row jsonb;
  after_row jsonb;
  stored jsonb := '[]'::jsonb;
  touched text[] := '{}';
  logged public.events;
begin
  if p_actor not in ('user', 'derived', 'ai', 'system') then
    raise exception 'Unknown actor' using errcode = 'NXU22';
  end if;

  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'A changeset needs at least one change' using errcode = 'NXU22';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    op_kind := op ->> 'op';
    patch := op -> 'patch';
    before_row := null;
    after_row := null;

    if op ? 'origin' and (op ->> 'origin') not in ('direct', 'derived') then
      raise exception 'Invalid origin' using errcode = 'NXU22';
    end if;

    target_table := case
      when op_kind in ('insert_object', 'update_object', 'delete_object') then 'objects'
      when op_kind in ('insert_relationship', 'delete_relationship') then 'relationships'
      when op_kind = 'set_workspace' then 'workspaces'
      when op_kind = 'update_intent' then 'intents'
    end;

    if target_table is null then
      raise exception 'Unknown change' using errcode = 'NXU22';
    end if;

    row_id := case
      when target_table in ('workspaces', 'intents') then p_intent_id
      else (op ->> 'id')::uuid
    end;

    if (target_table || ':' || row_id) = any (touched) then
      raise exception 'A row can change only once per changeset' using errcode = 'NXU22';
    end if;

    touched := touched || (target_table || ':' || row_id);

    case op_kind
      when 'insert_object' then
        perform private.check_source(op -> 'source');

        insert into public.objects as o
          (id, user_id, intent_id, kind, kind_version, title, status, data, source, position)
        values (
          row_id,
          p_user,
          p_intent_id,
          op ->> 'kind',
          coalesce((op ->> 'kindVersion')::integer, 1),
          op ->> 'title',
          op ->> 'status',
          op -> 'data',
          nullif(op -> 'source', 'null'::jsonb),
          (op ->> 'position')::double precision
        )
        returning to_jsonb(o.*) into after_row;

      when 'update_object', 'delete_object' then
        select to_jsonb(o.*) into before_row
        from public.objects o
        where o.id = row_id and o.user_id = p_user and o.intent_id = p_intent_id
          and o.deleted_at is null
        for update;

        if before_row is null then
          raise exception 'That item no longer exists' using errcode = 'NXU04';
        end if;

        if op_kind = 'delete_object' then
          update public.objects o set deleted_at = now()
          where o.id = row_id
          returning to_jsonb(o.*) into after_row;
        else
          if patch ? 'source' then
            perform private.check_source(patch -> 'source');
          end if;

          if op ? 'expectedUpdatedAt'
            and (before_row ->> 'updated_at')::timestamptz <> (op ->> 'expectedUpdatedAt')::timestamptz
          then
            raise exception 'This changed while you were editing' using errcode = 'NXU08';
          end if;

          update public.objects o set
            title = case when patch ? 'title' then patch ->> 'title' else o.title end,
            status = case when patch ? 'status' then patch ->> 'status' else o.status end,
            data = case when patch ? 'data' then patch -> 'data' else o.data end,
            source = case when patch ? 'source' then nullif(patch -> 'source', 'null'::jsonb) else o.source end,
            position = case
              when patch ? 'position' then (patch ->> 'position')::double precision
              else o.position
            end
          where o.id = row_id
          returning to_jsonb(o.*) into after_row;
        end if;

      when 'insert_relationship' then
        perform private.check_endpoint(p_user, op ->> 'sourceType', (op ->> 'sourceId')::uuid);
        perform private.check_endpoint(p_user, op ->> 'targetType', (op ->> 'targetId')::uuid);

        insert into public.relationships as r
          (id, user_id, intent_id, source_type, source_id, target_type, target_id, type, metadata)
        values (
          row_id,
          p_user,
          p_intent_id,
          op ->> 'sourceType',
          (op ->> 'sourceId')::uuid,
          op ->> 'targetType',
          (op ->> 'targetId')::uuid,
          op ->> 'type',
          nullif(op -> 'metadata', 'null'::jsonb)
        )
        returning to_jsonb(r.*) into after_row;

      when 'delete_relationship' then
        select to_jsonb(r.*) into before_row
        from public.relationships r
        where r.id = row_id and r.user_id = p_user and r.intent_id = p_intent_id
          and r.deleted_at is null
        for update;

        if before_row is null then
          raise exception 'That link no longer exists' using errcode = 'NXU04';
        end if;

        update public.relationships r set deleted_at = now()
        where r.id = row_id
        returning to_jsonb(r.*) into after_row;

      when 'set_workspace' then
        select to_jsonb(w.*) into before_row
        from public.workspaces w
        where w.intent_id = p_intent_id and w.user_id = p_user
        for update;

        insert into public.workspaces as w (intent_id, user_id, doc)
        values (p_intent_id, p_user, op -> 'doc')
        on conflict (intent_id) do update set doc = excluded.doc, version = w.version + 1
        returning to_jsonb(w.*) into after_row;

      when 'update_intent' then
        select to_jsonb(i.*) into before_row
        from public.intents i
        where i.id = p_intent_id and i.user_id = p_user
        for update;

        update public.intents i set
          status = case when patch ? 'status' then patch ->> 'status' else i.status end,
          summary = case when patch ? 'summary' then patch -> 'summary' else i.summary end,
          context = case when patch ? 'context' then patch -> 'context' else i.context end
        where i.id = p_intent_id
        returning to_jsonb(i.*) into after_row;
    end case;

    stored := stored || jsonb_build_array(jsonb_build_object(
      'op', op_kind,
      'table', target_table,
      'id', row_id,
      'before', before_row,
      'after', after_row,
      'origin', coalesce(op ->> 'origin', 'direct')
    ));
  end loop;

  insert into public.events (user_id, intent_id, type, actor, run_id, ops)
  values (p_user, p_intent_id, 'changeset', p_actor, p_run_id, stored)
  returning * into logged;

  update public.intents set last_activity_at = now() where id = p_intent_id;

  return to_jsonb(logged);
end;
$$;

-- Creates an intent and applies its template's seed changeset in one transaction.
create function public.create_intent(p_intent_id uuid, p_goal text, p_template text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  insert into public.intents (id, user_id, goal, template)
  values (p_intent_id, caller, p_goal, p_template);

  return private.apply_ops(caller, p_intent_id, 'system', null, p_ops);
end;
$$;

-- Applies a changeset to one of the caller's intents and logs it (spec section C).
create function public.apply_changeset(p_intent_id uuid, p_actor text, p_run_id uuid, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  perform 1 from public.intents where id = p_intent_id and user_id = caller for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  return private.apply_ops(caller, p_intent_id, p_actor, p_run_id, p_ops);
end;
$$;

-- Undo: writes each row's `before` back, newest first, as a new changeset. Refuses when a
-- row changed since or the event was already undone. Redo is revert_event on the Undo event.
create function public.revert_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  original public.events;
  item jsonb;
  row_id uuid;
  prior jsonb;
  later jsonb;
  current_row jsonb;
  restored jsonb;
  stored jsonb := '[]'::jsonb;
  logged public.events;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  select * into original from public.events where id = p_event_id and user_id = caller;

  if not found or original.type <> 'changeset' or original.intent_id is null then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if original.actor = 'system' then
    raise exception 'That can''t be undone' using errcode = 'NXU22';
  end if;

  perform 1 from public.intents where id = original.intent_id and user_id = caller for update;

  if exists (select 1 from public.events where reverts_event_id = p_event_id) then
    raise exception 'Already undone' using errcode = 'NXU10';
  end if;

  for item in
    select value from jsonb_array_elements(original.ops) with ordinality as t(value, n)
    order by n desc
  loop
    row_id := (item ->> 'id')::uuid;
    prior := nullif(item -> 'before', 'null'::jsonb);
    later := nullif(item -> 'after', 'null'::jsonb);
    current_row := null;
    restored := null;

    case item ->> 'table'
      when 'objects' then
        select to_jsonb(o.*) into current_row
        from public.objects o where o.id = row_id and o.user_id = caller for update;

        if (current_row ->> 'updated_at')::timestamptz
          is distinct from (later ->> 'updated_at')::timestamptz
        then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        if prior is null then
          update public.objects o set deleted_at = now()
          where o.id = row_id returning to_jsonb(o.*) into restored;
        else
          update public.objects o set
            title = prior ->> 'title',
            status = prior ->> 'status',
            data = prior -> 'data',
            source = nullif(prior -> 'source', 'null'::jsonb),
            position = (prior ->> 'position')::double precision,
            kind_version = (prior ->> 'kind_version')::integer,
            deleted_at = (prior ->> 'deleted_at')::timestamptz
          where o.id = row_id returning to_jsonb(o.*) into restored;
        end if;

      when 'relationships' then
        select to_jsonb(r.*) into current_row
        from public.relationships r where r.id = row_id and r.user_id = caller for update;

        if current_row is null
          or (current_row ->> 'deleted_at')::timestamptz
            is distinct from (later ->> 'deleted_at')::timestamptz
        then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        -- Reviving a link: both endpoints must still be live, or this revert can't be applied.
        if prior is not null and prior ->> 'deleted_at' is null then
          begin
            perform private.check_endpoint(
              caller, current_row ->> 'source_type', (current_row ->> 'source_id')::uuid);
            perform private.check_endpoint(
              caller, current_row ->> 'target_type', (current_row ->> 'target_id')::uuid);
          exception when sqlstate 'NXU04' then
            raise exception 'Changed since' using errcode = 'NXU09';
          end;
        end if;

        begin
          update public.relationships r set
            deleted_at = case when prior is null then now() else (prior ->> 'deleted_at')::timestamptz end,
            metadata = case when prior is null then r.metadata else nullif(prior -> 'metadata', 'null'::jsonb) end
          where r.id = row_id returning to_jsonb(r.*) into restored;
        exception when unique_violation then
          raise exception 'Changed since' using errcode = 'NXU09';
        end;

      when 'workspaces' then
        select to_jsonb(w.*) into current_row
        from public.workspaces w where w.intent_id = row_id and w.user_id = caller for update;

        if current_row -> 'doc' is distinct from later -> 'doc' then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        if prior is null then
          delete from public.workspaces w where w.intent_id = row_id;
        else
          insert into public.workspaces as w (intent_id, user_id, doc)
          values (row_id, caller, prior -> 'doc')
          on conflict (intent_id) do update set doc = excluded.doc, version = w.version + 1
          returning to_jsonb(w.*) into restored;
        end if;

      when 'intents' then
        select to_jsonb(i.*) into current_row
        from public.intents i where i.id = row_id and i.user_id = caller for update;

        if current_row -> 'summary' is distinct from later -> 'summary'
          or current_row -> 'status' is distinct from later -> 'status'
          or current_row -> 'context' is distinct from later -> 'context'
        then
          raise exception 'Changed since' using errcode = 'NXU09';
        end if;

        update public.intents i set
          summary = prior -> 'summary',
          status = prior ->> 'status',
          context = prior -> 'context'
        where i.id = row_id returning to_jsonb(i.*) into restored;
    end case;

    stored := stored || jsonb_build_array(jsonb_build_object(
      'op', 'revert',
      'table', item ->> 'table',
      'id', row_id,
      'before', current_row,
      'after', restored,
      'origin', coalesce(item ->> 'origin', 'direct')
    ));
  end loop;

  -- A restored soft-delete must not leave a live link dangling onto it.
  if exists (
    select 1
    from public.relationships r
    join public.objects o on
      (r.source_type = 'object' and r.source_id = o.id)
      or (r.target_type = 'object' and r.target_id = o.id)
    where r.user_id = caller and r.intent_id = original.intent_id
      and r.deleted_at is null and o.deleted_at is not null
  ) then
    raise exception 'Changed since' using errcode = 'NXU09';
  end if;

  insert into public.events (user_id, intent_id, type, actor, reverts_event_id, ops)
  values (caller, original.intent_id, 'changeset', 'user', p_event_id, stored)
  returning * into logged;

  update public.intents set last_activity_at = now() where id = original.intent_id;

  return to_jsonb(logged);
end;
$$;

-- The intent, its workspace and its live objects and relationships, in one call. Reads run
-- as the caller, so RLS applies.
create function public.get_intent_snapshot(p_intent_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'intent', to_jsonb(i.*),
    'workspace', (select to_jsonb(w.*) from public.workspaces w where w.intent_id = i.id),
    'objects', coalesce((
      select jsonb_agg(to_jsonb(o.*) order by o.position nulls last, o.created_at)
      from public.objects o
      where o.intent_id = i.id and o.deleted_at is null
    ), '[]'::jsonb),
    'relationships', coalesce((
      select jsonb_agg(to_jsonb(r.*) order by r.created_at)
      from public.relationships r
      where r.intent_id = i.id and r.deleted_at is null
    ), '[]'::jsonb)
  )
  from public.intents i
  where i.id = p_intent_id;
$$;

-- One page of the Changes feed, newest first, with each event's intent goal and its Undo.
create function public.changes_page(
  p_limit integer,
  p_before_seq bigint default null,
  p_intent_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(page.item order by page.seq desc), '[]'::jsonb)
  from (
    select
      e.seq,
      to_jsonb(e.*) || jsonb_build_object(
        'intent_goal', i.goal,
        'reverted_by_event_id', (select r.id from public.events r where r.reverts_event_id = e.id)
      ) as item
    from public.events e
    left join public.intents i on i.id = e.intent_id
    where (p_before_seq is null or e.seq < p_before_seq)
      and (p_intent_id is null or e.intent_id = p_intent_id)
    order by e.seq desc
    limit least(greatest(p_limit, 1), 100)
  ) page;
$$;

revoke execute on function public.create_intent(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_intent(uuid, text, text, jsonb) to authenticated;
revoke execute on function public.apply_changeset(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.apply_changeset(uuid, text, uuid, jsonb) to authenticated;
revoke execute on function public.revert_event(uuid) from public, anon;
grant execute on function public.revert_event(uuid) to authenticated;
revoke execute on function public.get_intent_snapshot(uuid) from public, anon;
grant execute on function public.get_intent_snapshot(uuid) to authenticated;
revoke execute on function public.changes_page(integer, bigint, uuid) from public, anon;
grant execute on function public.changes_page(integer, bigint, uuid) to authenticated;
