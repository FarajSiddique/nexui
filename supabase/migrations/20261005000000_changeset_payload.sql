-- A changeset's event carries a payload for the Changes feed: `label`, the sentence of the change
-- that made it ("Set Kyoto to 3 days"), and `figures`, the anchor figures its derivation moved
-- ([{label, before, after}]). The feed can then show a change without knowing any kind
-- (docs/superpowers/specs/2026-10-04-architecture-readiness.md, section 3.4).
--
-- private.apply_ops still logs the event. Each commit function then sets the event's payload in
-- the same transaction, before anyone can read it. Both take the payload as a new last argument
-- with a default, so a caller that doesn't send one keeps working. Undo events keep '{}'.

-- Sets the payload of the event apply_ops just logged, and returns the event. A payload is a JSON
-- object of at most 4 000 characters; anything else is NXU22 and rolls the changeset back. An
-- empty payload changes nothing.
create function private.set_event_payload(p_event jsonb, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  logged public.events;
begin
  if p_payload is null or p_payload = '{}'::jsonb then
    return p_event;
  end if;

  if jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 4000 then
    raise exception 'That change is not valid' using errcode = 'NXU22';
  end if;

  update public.events e set payload = p_payload
  where e.id = (p_event ->> 'id')::uuid
  returning * into logged;

  return to_jsonb(logged);
end;
$$;

revoke execute on function private.set_event_payload(jsonb, jsonb)
  from public, anon, authenticated;

drop function public.apply_changeset(uuid, text, uuid, jsonb, timestamptz);

-- apply_changeset as before, with the event's payload last.
create function public.apply_changeset(
  p_intent_id uuid,
  p_actor text,
  p_run_id uuid,
  p_ops jsonb,
  p_expected_activity_at timestamptz default null,
  p_payload jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  activity_at timestamptz;
begin
  if caller is null then
    raise exception 'Sign in to continue' using errcode = 'NXU04';
  end if;

  select i.last_activity_at into activity_at
  from public.intents i
  where i.id = p_intent_id and i.user_id = caller
  for update;

  if not found then
    raise exception 'Not found' using errcode = 'NXU04';
  end if;

  if p_expected_activity_at is not null and activity_at <> p_expected_activity_at then
    raise exception 'This changed while you were editing' using errcode = 'NXU08';
  end if;

  if p_run_id is not null
    and not exists (select 1 from public.runs r where r.id = p_run_id and r.user_id = caller)
  then
    raise exception 'Unknown run' using errcode = 'NXU22';
  end if;

  return private.set_event_payload(
    private.apply_ops(caller, p_intent_id, p_actor, p_run_id, p_ops),
    p_payload
  );
end;
$$;

revoke execute on function public.apply_changeset(uuid, text, uuid, jsonb, timestamptz, jsonb)
  from public, anon;
grant execute on function public.apply_changeset(uuid, text, uuid, jsonb, timestamptz, jsonb)
  to authenticated;

drop function public.run_apply_changeset(uuid, uuid, jsonb, timestamptz);

-- run_apply_changeset as before, with the event's payload last.
create function public.run_apply_changeset(
  p_run_id uuid,
  p_lease_id uuid,
  p_ops jsonb,
  p_expected_activity_at timestamptz default null,
  p_payload jsonb default '{}'
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

  return private.set_event_payload(
    private.apply_ops(found_run.user_id, found_run.intent_id, 'ai', found_run.id, p_ops),
    p_payload
  );
end;
$$;

revoke execute on function public.run_apply_changeset(uuid, uuid, jsonb, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.run_apply_changeset(uuid, uuid, jsonb, timestamptz, jsonb)
  to service_role;
