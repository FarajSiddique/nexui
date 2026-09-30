-- A run executes inside one function instance, which Vercel stops after 300 seconds. A queued
-- or running run older than 6 minutes has therefore stopped; the API reports it as failed with
-- the same cutoff (RUN_STALE_MS). Replaces the 15-minute cutoff from 20260929000000_runs.sql.

create or replace function public.create_run(p_intent_id uuid, p_kind text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  created public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_kind is null or p_kind not in ('create_intent', 'ask')
    or p_input is null or jsonb_typeof(p_input) <> 'object'
  then
    raise exception 'That run is not valid' using errcode = 'NXU22';
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
      and r.status in ('queued', 'running')
      and r.created_at > now() - interval '6 minutes'
  ) then
    raise exception 'A run is already working on this intent' using errcode = 'NXU12';
  end if;

  insert into public.runs (user_id, intent_id, kind, input)
  values (caller, p_intent_id, p_kind, p_input)
  returning * into created;

  return to_jsonb(created);
end;
$$;
