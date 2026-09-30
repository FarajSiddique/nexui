-- Writers for AI runs (spec sections C and F). The API creates a run for each AI request with
-- the user's token, records each model step as it commits, and finishes the run. Clients still
-- only read `runs`, through RLS. A queued or running run older than 15 minutes has stopped (its
-- function instance ended); the API reports it as failed with the same cutoff.

-- Starts a run on one of the caller's intents. Refuses with NXU12 while another run on the
-- intent is still working, so two runs never race on one graph.
create function public.create_run(p_intent_id uuid, p_kind text, p_input jsonb)
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
      and r.created_at > now() - interval '15 minutes'
  ) then
    raise exception 'A run is already working on this intent' using errcode = 'NXU12';
  end if;

  insert into public.runs (user_id, intent_id, kind, input)
  values (caller, p_intent_id, p_kind, p_input)
  returning * into created;

  return to_jsonb(created);
end;
$$;

-- Marks the run running and appends one step's progress entries and token usage. Returns the
-- run's status, so the executor stops after a cancel. Progress keeps its first 100 entries.
create function public.record_run_step(p_run_id uuid, p_entries jsonb, p_usage jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  found_run public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
    or p_usage is null or jsonb_typeof(p_usage) <> 'object'
  then
    raise exception 'That step is not valid' using errcode = 'NXU22';
  end if;

  select * into found_run
  from public.runs r
  where r.id = p_run_id and r.user_id = caller
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if found_run.status not in ('queued', 'running') then
    return found_run.status;
  end if;

  update public.runs r set
    status = 'running',
    started_at = coalesce(r.started_at, now()),
    progress = case
      when jsonb_array_length(r.progress) + jsonb_array_length(p_entries) > 100 then r.progress
      else r.progress || p_entries
    end,
    model_usage = jsonb_strip_nulls(jsonb_build_object(
      'inputTokens', coalesce((r.model_usage ->> 'inputTokens')::bigint, 0)
        + coalesce((p_usage ->> 'inputTokens')::bigint, 0),
      'outputTokens', coalesce((r.model_usage ->> 'outputTokens')::bigint, 0)
        + coalesce((p_usage ->> 'outputTokens')::bigint, 0),
      'model', coalesce(p_usage ->> 'model', r.model_usage ->> 'model')
    ))
  where r.id = p_run_id and r.user_id = caller;

  return 'running';
end;
$$;

-- Ends a run as succeeded or failed. A cancelled run stays cancelled; its finish time is kept.
create function public.finish_run(p_run_id uuid, p_status text, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  finished public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'That status is not valid' using errcode = 'NXU22';
  end if;

  update public.runs r set
    status = case when r.status in ('queued', 'running') then p_status else r.status end,
    error = case
      when r.status in ('queued', 'running') and p_status = 'failed' then left(p_error, 300)
      else r.error
    end,
    finished_at = coalesce(r.finished_at, now())
  where r.id = p_run_id and r.user_id = caller
  returning * into finished;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  return to_jsonb(finished);
end;
$$;

-- Stops a run between steps (spec section F): what it already committed stays and can be
-- undone. A run that already finished is returned unchanged.
create function public.cancel_run(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  stopped public.runs;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  update public.runs r set status = 'cancelled', finished_at = now()
  where r.id = p_run_id
    and r.user_id = caller
    and r.status in ('queued', 'running', 'awaiting_approval')
  returning * into stopped;

  if not found then
    select * into stopped
    from public.runs r
    where r.id = p_run_id and r.user_id = caller;

    if not found then
      raise exception 'Not found' using errcode = 'NXU04';
    end if;
  end if;

  return to_jsonb(stopped);
end;
$$;

revoke execute on function public.create_run(uuid, text, jsonb) from public, anon;
grant execute on function public.create_run(uuid, text, jsonb) to authenticated;
revoke execute on function public.record_run_step(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.record_run_step(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.finish_run(uuid, text, text) from public, anon;
grant execute on function public.finish_run(uuid, text, text) to authenticated;
revoke execute on function public.cancel_run(uuid) from public, anon;
grant execute on function public.cancel_run(uuid) to authenticated;
