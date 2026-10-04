-- Deleting a plan from Home: the caller's intent goes, and its objects, relationships, events,
-- workspace and runs cascade with it. Refused while a run on it is still working, like create_run,
-- so a run never writes to a plan that's gone. A run older than 6 minutes has stopped
-- (RUN_STALE_MS in apps/api/src/lib/runs/store.ts).

create function public.delete_intent(p_intent_id uuid)
returns void
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

  perform 1
  from public.intents i
  where i.id = p_intent_id and i.user_id = caller
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if exists (
    select 1
    from public.runs r
    where r.intent_id = p_intent_id
      and r.user_id = caller
      and r.status in ('queued', 'running', 'stopping')
      and r.created_at > now() - interval '6 minutes'
  ) then
    raise exception 'A run is still working on this intent' using errcode = 'NXU12';
  end if;

  delete from public.intents i
  where i.id = p_intent_id and i.user_id = caller;
end;
$$;

revoke execute on function public.delete_intent(uuid) from public, anon;
grant execute on function public.delete_intent(uuid) to authenticated;
