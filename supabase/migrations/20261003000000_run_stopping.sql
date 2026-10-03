-- Stop lets a running run finish the step it is taking (spec addendum 2026-10-03, section 1).
-- cancel_run moves a running run to `stopping`; the executor commits that step, records it and
-- finishes the run as cancelled. Meanwhile create_run refuses a new run, so a stopped run's last
-- commit can never land under a newer run. A stopping run older than 6 minutes has stopped, like
-- a running one (RUN_STALE_MS in apps/api/src/lib/runs/store.ts).

alter table public.runs drop constraint runs_status_check;
alter table public.runs add constraint runs_status_check
  check (status in ('queued', 'running', 'stopping', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'));

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
      and r.status in ('queued', 'running', 'stopping')
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

-- Appends one step's progress entries and token usage, and returns the run's status. A stopping
-- run keeps its last step's entries and stays stopping, so the executor stops after it.
create or replace function public.record_run_step(p_run_id uuid, p_entries jsonb, p_usage jsonb)
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

  if found_run.status not in ('queued', 'running', 'stopping') then
    return found_run.status;
  end if;

  update public.runs r set
    status = case when r.status = 'stopping' then 'stopping' else 'running' end,
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

  return case when found_run.status = 'stopping' then 'stopping' else 'running' end;
end;
$$;

-- Ends a run. A stopping run ends cancelled, or failed if its last step failed. A finished run
-- keeps its status; its finish time is kept.
create or replace function public.finish_run(p_run_id uuid, p_status text, p_error text default null)
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

  if p_status is null or p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'That status is not valid' using errcode = 'NXU22';
  end if;

  update public.runs r set
    status = case
      when r.status in ('queued', 'running') then p_status
      when r.status = 'stopping' and p_status = 'failed' then 'failed'
      when r.status = 'stopping' then 'cancelled'
      else r.status
    end,
    error = case
      when r.status in ('queued', 'running', 'stopping') and p_status = 'failed'
        then left(p_error, 300)
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

-- Stops a run (spec section F): a running run finishes the step it is taking first; anything
-- else not yet finished is cancelled at once. What a run committed stays and can be undone. A
-- run that already finished, or is already stopping, is returned unchanged.
create or replace function public.cancel_run(p_run_id uuid)
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

  update public.runs r set
    status = case when r.status = 'running' then 'stopping' else 'cancelled' end,
    finished_at = case when r.status = 'running' then r.finished_at else now() end
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
