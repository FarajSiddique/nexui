-- Live updates move from postgres_changes to Broadcast (spec 2026-10-04 broadcast and run queue,
-- section 1). postgres_changes decoded every written row and checked RLS once per subscriber;
-- now one message goes to a private `intent:<id>` topic per changeset and per run write, and
-- Realtime checks who may join a topic once per channel.

-- Every graph write goes through private.apply_ops or revert_event, which each log exactly one
-- `events` row, so the events trigger fires once per changeset. The payload is only a signal:
-- clients refetch through the API. realtime.send turns its own failure into a warning, so a
-- broadcast never rolls back the write.
create function private.broadcast_intent_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('table', tg_table_name),
    'changed',
    'intent:' || new.intent_id::text,
    true
  );

  return null;
end;
$$;

revoke execute on function private.broadcast_intent_change() from public, anon, authenticated;

create trigger events_broadcast after insert on public.events
  for each row when (new.intent_id is not null)
  execute function private.broadcast_intent_change();

create trigger runs_broadcast after insert or update on public.runs
  for each row when (new.intent_id is not null)
  execute function private.broadcast_intent_change();

-- A signed-in user may join `intent:<id>` only for one of their own intents. The topic is matched
-- by pattern inside a `case` before the cast, so a malformed topic can't raise. There is no
-- insert policy, so clients can't broadcast on these topics.
create policy "Owners join their intent topics" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.intents i
      where i.user_id = (select auth.uid())
        and i.id = (
          select case
            when realtime.topic() ~ '^intent:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then substr(realtime.topic(), 8)::uuid
          end
        )
    )
  );

alter publication supabase_realtime drop table
  public.objects, public.relationships, public.workspaces, public.events, public.runs;
