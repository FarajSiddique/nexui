-- The runs table becomes the run queue (spec 2026-10-04 broadcast and run queue, section 2).
-- A worker with the service-role key claims a run with a lease and writes only as that run: the
-- user and intent come from the run row, never from the caller. A run lost before it committed a
-- step is retried once; one lost after a commit fails and keeps its steps. Every run must finish
-- within 15 minutes of creation (two 330-second leases plus cron slack); RUN_STALE_MS in
-- apps/api/src/lib/runs/store.ts uses the same cutoff.

-- Owners can read lease_id through "Owners read runs". That is safe only because every function
-- that takes a lease is granted to service_role alone; never grant one to a client role.
alter table public.runs
  add column attempts integer not null default 0,
  add column lease_id uuid,
  add column lease_expires_at timestamptz;

create index runs_active_idx on public.runs (created_at)
  where status in ('queued', 'running', 'stopping');
-- create_run counts each user's working runs.
create index runs_user_active_idx on public.runs (user_id)
  where status in ('queued', 'running', 'stopping');
-- reap_runs checks whether a run committed anything.
create index events_run_idx on public.events (run_id) where run_id is not null;

-- Only the worker records steps and finishes runs now, and only the API queues runs: a run
-- queued straight from a client would skip the API's validation and perception, then execute.
drop function public.record_run_step(uuid, jsonb, jsonb);
drop function public.finish_run(uuid, text, text);
drop function public.create_run(uuid, text, jsonb);

-- Claims runs for a worker. With p_run_id, only that run (the request that created it); without,
-- up to p_limit of the oldest runs nobody claimed for 10 seconds (the cron). Only queued, unleased
-- runs inside the deadline are claimed, and never more than p_max_active leases at once.
-- Claimers take a transaction lock so two of them can't both count the same free slot.
create function public.claim_runs(
  p_run_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_max_active integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  free integer;
  claimed jsonb;
begin
  if p_limit is null or p_limit < 1
    or p_lease_seconds is null or p_lease_seconds < 1
    or p_max_active is null or p_max_active < 1
  then
    raise exception 'That claim is not valid' using errcode = 'NXU22';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.claim_runs'));

  select p_max_active - count(*) into free
  from public.runs r
  where r.status in ('queued', 'running', 'stopping')
    and r.lease_expires_at > now();

  if free <= 0 then
    return '[]'::jsonb;
  end if;

  with picked as (
    select r.id
    from public.runs r
    where r.status = 'queued'
      and r.lease_id is null
      and r.created_at > now() - interval '15 minutes'
      and case
        when p_run_id is null then r.created_at <= now() - interval '10 seconds'
        else r.id = p_run_id
      end
    order by r.created_at
    limit least(p_limit, free)
    for update skip locked
  ),
  updated as (
    update public.runs r set
      lease_id = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempts = r.attempts + 1
    from picked
    where r.id = picked.id
    returning r.*
  )
  select coalesce(jsonb_agg(to_jsonb(u.*) order by u.created_at), '[]'::jsonb) into claimed
  from updated u;

  return claimed;
end;
$$;

-- Marks the run running and appends one step's progress entries and token usage, like the
-- record_run_step it replaces. A lease that isn't the run's, or has lapsed, is NXU13: the run
-- was reaped or claimed again, so this worker must stop without writing.
create function public.run_record_step(
  p_run_id uuid,
  p_lease_id uuid,
  p_entries jsonb,
  p_usage jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_run public.runs;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
    or p_usage is null or jsonb_typeof(p_usage) <> 'object'
  then
    raise exception 'That step is not valid' using errcode = 'NXU22';
  end if;

  select * into found_run
  from public.runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if p_lease_id is null
    or found_run.lease_id is distinct from p_lease_id
    or found_run.lease_expires_at <= now()
  then
    raise exception 'This run moved on' using errcode = 'NXU13';
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
  where r.id = p_run_id;

  return case when found_run.status = 'stopping' then 'stopping' else 'running' end;
end;
$$;

-- Ends a run, with finish_run's rules: a stopping run ends cancelled, or failed when its last
-- step failed, and a finished run keeps its status. Clears the lease's expiry.
create function public.run_finish(
  p_run_id uuid,
  p_lease_id uuid,
  p_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_run public.runs;
  finished public.runs;
begin
  if p_status is null or p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'That status is not valid' using errcode = 'NXU22';
  end if;

  select * into found_run
  from public.runs r
  where r.id = p_run_id
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if p_lease_id is null
    or found_run.lease_id is distinct from p_lease_id
    or found_run.lease_expires_at <= now()
  then
    raise exception 'This run moved on' using errcode = 'NXU13';
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
    finished_at = coalesce(r.finished_at, now()),
    lease_expires_at = null
  where r.id = p_run_id
  returning * into finished;

  return to_jsonb(finished);
end;
$$;

-- Applies one step's changeset as the run: apply_changeset's checks, with the user, intent and
-- actor taken from the run row. Only a running or stopping run holding this lease may commit.
-- Locks the intent before the run, in the same order as apply_changeset and delete_intent.
create function public.run_apply_changeset(
  p_run_id uuid,
  p_lease_id uuid,
  p_ops jsonb,
  p_expected_activity_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_intent uuid;
  found_run public.runs;
  activity_at timestamptz;
begin
  select r.intent_id into run_intent
  from public.runs r
  where r.id = p_run_id;

  if run_intent is null then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  select i.last_activity_at into activity_at
  from public.intents i
  where i.id = run_intent
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  select * into found_run
  from public.runs r
  where r.id = p_run_id
  for update;

  if p_lease_id is null
    or found_run.lease_id is distinct from p_lease_id
    or found_run.lease_expires_at <= now()
    or found_run.status not in ('running', 'stopping')
  then
    raise exception 'This run moved on' using errcode = 'NXU13';
  end if;

  if p_expected_activity_at is not null and activity_at <> p_expected_activity_at then
    raise exception 'This changed while you were editing' using errcode = 'NXU08';
  end if;

  return private.apply_ops(found_run.user_id, found_run.intent_id, 'ai', found_run.id, p_ops);
end;
$$;

-- Settles runs whose worker is gone (lease lapsed) or that passed the deadline. A stopping run
-- is cancelled. One that committed a step, ran out of attempts or passed the deadline fails with
-- the error the API shows for a stale run. Anything else goes back to the queue with its
-- progress cleared; its token usage stays, since those tokens were spent. Returns how many it
-- settled; at most 200 per call.
create function public.reap_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_run public.runs;
  reaped integer := 0;
begin
  for found_run in
    select *
    from public.runs r
    where r.status in ('queued', 'running', 'stopping')
      and (r.lease_expires_at <= now() or r.created_at <= now() - interval '15 minutes')
    order by r.created_at
    limit 200
    for update skip locked
  loop
    if found_run.status = 'stopping' then
      update public.runs r set
        status = 'cancelled',
        finished_at = coalesce(r.finished_at, now()),
        lease_expires_at = null
      where r.id = found_run.id;
    elsif found_run.created_at <= now() - interval '15 minutes'
      or found_run.attempts >= 2
      or exists (select 1 from public.events e where e.run_id = found_run.id)
    then
      update public.runs r set
        status = 'failed',
        error = 'This run stopped unexpectedly.',
        finished_at = coalesce(r.finished_at, now()),
        lease_expires_at = null
      where r.id = found_run.id;
    else
      update public.runs r set
        status = 'queued',
        started_at = null,
        progress = '[]'::jsonb,
        lease_id = null,
        lease_expires_at = null
      where r.id = found_run.id;
    end if;

    reaped := reaped + 1;
  end loop;

  return reaped;
end;
$$;

-- Queues a run for the API, on behalf of the user it verified. Refuses with NXU12 while another
-- run on the intent is working, and with NXU14 while the user has 3 runs working across all
-- their intents, so one account can't fill the shared cap. The input is checked here too, since
-- the worker trusts it: a known route and 1 to 1000 characters of text.
create function public.create_run(p_user_id uuid, p_intent_id uuid, p_kind text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.runs;
begin
  if p_user_id is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  if p_kind is null or p_kind not in ('create_intent', 'ask')
    or p_input is null or jsonb_typeof(p_input) <> 'object'
    or jsonb_typeof(p_input -> 'text') is distinct from 'string'
    or char_length(p_input ->> 'text') not between 1 and 1000
    or (p_input ->> 'route') is null
    or (p_input ->> 'route') not in ('edit', 'fast', 'reasoning')
  then
    raise exception 'That run is not valid' using errcode = 'NXU22';
  end if;

  perform 1
  from public.intents i
  where i.id = p_intent_id and i.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if exists (
    select 1
    from public.runs r
    where r.intent_id = p_intent_id
      and r.user_id = p_user_id
      and r.status in ('queued', 'running', 'stopping')
      and r.created_at > now() - interval '15 minutes'
  ) then
    raise exception 'A run is already working on this intent' using errcode = 'NXU12';
  end if;

  if (
    select count(*)
    from public.runs r
    where r.user_id = p_user_id
      and r.status in ('queued', 'running', 'stopping')
      and r.created_at > now() - interval '15 minutes'
  ) >= 3 then
    raise exception 'Too many runs are working' using errcode = 'NXU14';
  end if;

  insert into public.runs (user_id, intent_id, kind, input)
  values (p_user_id, p_intent_id, p_kind, p_input)
  returning * into created;

  return to_jsonb(created);
end;
$$;

-- delete_intent counts a run as working until the 15-minute deadline, like create_run.
create or replace function public.delete_intent(p_intent_id uuid)
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
      and r.created_at > now() - interval '15 minutes'
  ) then
    raise exception 'A run is still working on this intent' using errcode = 'NXU12';
  end if;

  delete from public.intents i
  where i.id = p_intent_id and i.user_id = caller;
end;
$$;

revoke execute on function public.create_run(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_run(uuid, uuid, text, jsonb) to service_role;
revoke execute on function public.claim_runs(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_runs(uuid, integer, integer, integer) to service_role;
revoke execute on function public.run_record_step(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.run_record_step(uuid, uuid, jsonb, jsonb) to service_role;
revoke execute on function public.run_finish(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.run_finish(uuid, uuid, text, text) to service_role;
revoke execute on function public.run_apply_changeset(uuid, uuid, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.run_apply_changeset(uuid, uuid, jsonb, timestamptz)
  to service_role;
revoke execute on function public.reap_runs() from public, anon, authenticated;
grant execute on function public.reap_runs() to service_role;
