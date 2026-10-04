-- Paste into the Supabase SQL editor (or run with psql). Checks the run functions, the worker's
-- queue functions, discard_intent and delete_intent as two throwaway users and the service role,
-- and rolls everything back. now() is fixed inside the transaction, so lapsed leases and old
-- runs are made by moving timestamps as the table owner.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'runs-a@example.test'),
  ('00000000-0000-4000-8000-0000000000c2', 'runs-b@example.test');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select public.create_intent(
  '20000000-0000-4000-8000-000000000001',
  'Plan Japan in December',
  'travel',
  jsonb_build_array(jsonb_build_object('op', 'insert_object',
    'id', '20000000-0000-4000-8000-000000000002', 'kind', 'trip', 'kindVersion', 1,
    'title', 'Japan', 'status', null,
    'data', '{"destinations":["Japan"],"currency":"USD"}'::jsonb,
    'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'))
);

-- Two trips no run ever started on: one to discard, one the other user tries to discard.
select public.create_intent(
  '20000000-0000-4000-8000-000000000003',
  'Plan Lisbon in May',
  'travel',
  jsonb_build_array(jsonb_build_object('op', 'insert_object',
    'id', '20000000-0000-4000-8000-000000000004', 'kind', 'trip', 'kindVersion', 1,
    'title', 'Lisbon', 'status', null,
    'data', '{"destinations":["Lisbon"],"currency":"EUR"}'::jsonb,
    'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'))
);

select public.create_intent(
  '20000000-0000-4000-8000-000000000005',
  'Plan Oslo in June',
  'travel',
  jsonb_build_array(jsonb_build_object('op', 'insert_object',
    'id', '20000000-0000-4000-8000-000000000006', 'kind', 'trip', 'kindVersion', 1,
    'title', 'Oslo', 'status', null,
    'data', '{"destinations":["Oslo"],"currency":"NOK"}'::jsonb,
    'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'))
);

-- The user starts a run. Only the worker may claim, record or finish it.
do $$
declare
  made jsonb;
begin
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Make it slower","route":"reasoning","perception":"model"}');
  assert made ->> 'status' = 'queued', 'a new run is queued';
  assert (made ->> 'attempts')::int = 0 and made ->> 'lease_id' is null, 'nobody holds it yet';
  perform set_config('smoke.run', made ->> 'id', true);

  begin
    perform public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
      '{"text":"Again","route":"edit","perception":"model"}');
    assert false, 'a second active run is refused';
  exception when sqlstate 'NXU12' then
    null;
  end;

  begin
    perform public.claim_runs(null, 1, 330, 100);
    assert false, 'users can''t claim runs';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.run_record_step(current_setting('smoke.run')::uuid, null, '[]', '{}');
    assert false, 'users can''t record steps';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.reap_runs();
    assert false, 'users can''t reap runs';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- The worker claims the run, records steps and commits as it.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  claimed jsonb;
  lease uuid;
  made jsonb;
  step_status text;
  logged jsonb;
begin
  assert jsonb_array_length(public.claim_runs(null, 10, 330, 100)) = 0,
    'the cron leaves a run younger than 10 seconds to its request';

  claimed := public.claim_runs(run_id, 1, 330, 100);
  assert jsonb_array_length(claimed) = 1, 'the request claims its run';
  lease := (claimed -> 0 ->> 'lease_id')::uuid;
  assert (claimed -> 0 ->> 'attempts')::int = 1, 'a claim is an attempt';
  assert (claimed -> 0 ->> 'lease_expires_at')::timestamptz = now() + interval '330 seconds',
    'the lease runs 330 seconds';
  assert jsonb_array_length(public.claim_runs(run_id, 1, 330, 100)) = 0, 'a claim is exclusive';
  perform set_config('smoke.lease', lease::text, true);

  begin
    perform public.run_record_step(run_id, gen_random_uuid(), '[]', '{}');
    assert false, 'another lease is refused';
  exception when sqlstate 'NXU13' then
    null;
  end;

  begin
    perform public.run_apply_changeset(run_id, lease, '[]', null);
    assert false, 'a run commits only once it has started';
  exception when sqlstate 'NXU13' then
    null;
  end;

  step_status := public.run_record_step(run_id, lease,
    '[{"step":0,"capability":"object.update","label":"Updated Japan","ok":true,"ms":2,"input":{"ref":"trip"}}]',
    '{"inputTokens":100,"outputTokens":20,"model":"anthropic/claude-sonnet-5.5"}');
  assert step_status = 'running', 'a step marks the run running';

  perform public.run_record_step(run_id, lease, '[]', '{"inputTokens":50,"outputTokens":5}');
  made := (select to_jsonb(r) from public.runs r where r.id = run_id);
  assert jsonb_array_length(made -> 'progress') = 1, 'progress keeps the step';
  assert (made -> 'model_usage' ->> 'inputTokens')::int = 150, 'usage adds up';
  assert made -> 'model_usage' ->> 'model' = 'anthropic/claude-sonnet-5.5', 'the model is kept';
  assert made ->> 'started_at' is not null, 'the start is recorded';

  logged := public.run_apply_changeset(run_id, lease,
    jsonb_build_array(jsonb_build_object('op', 'update_object',
      'id', '20000000-0000-4000-8000-000000000002', 'patch', '{"title":"Japan, slowly"}'::jsonb,
      'origin', 'direct')),
    null);
  assert logged ->> 'actor' = 'ai' and (logged ->> 'run_id')::uuid = run_id,
    'the commit is the run''s';
  assert (logged ->> 'user_id')::uuid = '00000000-0000-4000-8000-0000000000c1',
    'the commit belongs to the run''s user';

  begin
    perform public.run_apply_changeset(run_id, lease, '[]', now() - interval '1 day');
    assert false, 'a stale snapshot is refused';
  exception when sqlstate 'NXU08' then
    null;
  end;
end $$;

-- Stop lets a running run finish the step it is taking.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
declare
  made jsonb;
begin
  made := public.cancel_run(current_setting('smoke.run')::uuid);
  assert made ->> 'status' = 'stopping', 'stop moves a running run to stopping';
  assert made ->> 'finished_at' is null, 'a stopping run has not finished';

  begin
    perform public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
      '{"text":"Too soon","route":"edit","perception":"model"}');
    assert false, 'no new run while one is stopping';
  exception when sqlstate 'NXU12' then
    null;
  end;

  made := public.cancel_run(current_setting('smoke.run')::uuid);
  assert made ->> 'status' = 'stopping', 'a second stop changes nothing';
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  lease uuid := current_setting('smoke.lease')::uuid;
  made jsonb;
  step_status text;
begin
  step_status := public.run_record_step(run_id, lease,
    '[{"step":1,"capability":"object.update","label":"Updated Tokyo","ok":true,"ms":3,"input":{"ref":"tokyo"}}]',
    '{"inputTokens":10,"outputTokens":2}');
  assert step_status = 'stopping', 'the last step sees the stop';
  made := (select to_jsonb(r) from public.runs r where r.id = run_id);
  assert made ->> 'status' = 'stopping', 'recording keeps the run stopping';
  assert jsonb_array_length(made -> 'progress') = 2, 'the last step''s entries are kept';
  assert (made -> 'model_usage' ->> 'inputTokens')::int = 160, 'the last step''s usage adds up';

  made := public.run_finish(run_id, lease, 'succeeded', null);
  assert made ->> 'status' = 'cancelled', 'a stopping run finishes cancelled';
  assert made ->> 'finished_at' is not null, 'the finish is recorded';
  assert made ->> 'lease_expires_at' is null, 'a finished run holds no lease';
  assert public.run_record_step(run_id, lease, '[]', '{}') = 'cancelled', 'steps see the cancel';

  made := public.run_finish(run_id, lease, 'failed', 'Too late');
  assert made ->> 'status' = 'cancelled' and made ->> 'error' is null,
    'finishing again keeps the cancel';

  begin
    perform public.run_apply_changeset(run_id, lease, '[]', null);
    assert false, 'a finished run commits nothing';
  exception when sqlstate 'NXU13' then
    null;
  end;
end $$;

-- A stopping run whose last step failed ends failed, with that error. A queued run has no step to
-- finish, so Stop cancels it at once, and the worker sees the cancel.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Stop this one too","route":"edit","perception":"model"}') ->> 'id', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  claimed jsonb := public.claim_runs(current_setting('smoke.run')::uuid, 1, 330, 100);
begin
  perform set_config('smoke.lease', claimed -> 0 ->> 'lease_id', true);
  perform public.run_record_step(current_setting('smoke.run')::uuid,
    current_setting('smoke.lease')::uuid, '[]', '{}');
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
begin
  assert public.cancel_run(current_setting('smoke.run')::uuid) ->> 'status' = 'stopping',
    'the second run is stopping';
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  made jsonb := public.run_finish(current_setting('smoke.run')::uuid,
    current_setting('smoke.lease')::uuid, 'failed', 'Nexui couldn''t finish this.');
begin
  assert made ->> 'status' = 'failed' and made ->> 'error' = 'Nexui couldn''t finish this.',
    'a stopping run that failed ends failed with its error';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
declare
  made jsonb;
begin
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Never mind","route":"fast","perception":"model"}');
  perform set_config('smoke.run', made ->> 'id', true);
  made := public.cancel_run((made ->> 'id')::uuid);
  assert made ->> 'status' = 'cancelled', 'stop cancels a queued run at once';
  assert made ->> 'finished_at' is not null, 'a cancelled queued run has finished';
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
begin
  assert jsonb_array_length(public.claim_runs(current_setting('smoke.run')::uuid, 1, 330, 100))
    = 0, 'a cancelled run is never claimed';
end $$;

-- A run lost before it committed is retried once, then fails.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Lose me","route":"fast","perception":"model"}') ->> 'id', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  first_lease uuid;
  second jsonb;
  made jsonb;
begin
  first_lease := (public.claim_runs(run_id, 1, 330, 100) -> 0 ->> 'lease_id')::uuid;
  perform public.run_record_step(run_id, first_lease,
    '[{"step":0,"capability":"object.update","label":"Refused","ok":false,"ms":1,"input":{},"error":"Nope"}]',
    '{"inputTokens":7,"outputTokens":1}');
  perform set_config('smoke.lease', first_lease::text, true);
end $$;

reset role;
update public.runs set lease_expires_at = now() - interval '1 second'
where id = current_setting('smoke.run')::uuid;
set local role service_role;

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  made jsonb;
  second_lease uuid;
begin
  assert public.reap_runs() = 1, 'the lapsed run is reaped';
  made := (select to_jsonb(r) from public.runs r where r.id = run_id);
  assert made ->> 'status' = 'queued' and made ->> 'lease_id' is null, 'it is back in the queue';
  assert jsonb_array_length(made -> 'progress') = 0 and made ->> 'started_at' is null,
    'its progress starts over';
  assert (made -> 'model_usage' ->> 'inputTokens')::int = 7, 'its spent tokens are kept';

  begin
    perform public.run_record_step(run_id, current_setting('smoke.lease')::uuid, '[]', '{}');
    assert false, 'the lost worker can''t write';
  exception when sqlstate 'NXU13' then
    null;
  end;

  second_lease := (public.claim_runs(run_id, 1, 330, 100) -> 0 ->> 'lease_id')::uuid;
  assert second_lease is not null, 'the retry is claimed';
  assert (select r.attempts from public.runs r where r.id = run_id) = 2, 'that is attempt two';
end $$;

reset role;
update public.runs set lease_expires_at = now() - interval '1 second'
where id = current_setting('smoke.run')::uuid;
set local role service_role;

do $$
declare
  made jsonb;
begin
  assert public.reap_runs() = 1, 'the retry is reaped too';
  made := (select to_jsonb(r) from public.runs r where r.id = current_setting('smoke.run')::uuid);
  assert made ->> 'status' = 'failed' and made ->> 'error' = 'This run stopped unexpectedly.',
    'two lost attempts fail the run';
end $$;

-- A run lost after it committed a step fails at once and keeps the step.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Commit then vanish","route":"fast","perception":"model"}') ->> 'id', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  lease uuid := (public.claim_runs(run_id, 1, 330, 100) -> 0 ->> 'lease_id')::uuid;
begin
  perform public.run_record_step(run_id, lease, '[]', '{}');
  perform public.run_apply_changeset(run_id, lease,
    jsonb_build_array(jsonb_build_object('op', 'update_object',
      'id', '20000000-0000-4000-8000-000000000002', 'patch', '{"title":"Japan, briefly"}'::jsonb,
      'origin', 'direct')),
    null);
end $$;

reset role;
update public.runs set lease_expires_at = now() - interval '1 second'
where id = current_setting('smoke.run')::uuid;
set local role service_role;

do $$
declare
  made jsonb;
begin
  assert public.reap_runs() = 1, 'the lapsed run is reaped';
  made := (select to_jsonb(r) from public.runs r where r.id = current_setting('smoke.run')::uuid);
  assert made ->> 'status' = 'failed' and (made ->> 'attempts')::int = 1,
    'a run that committed is never retried';
  assert exists (
    select 1 from public.objects o
    where o.id = '20000000-0000-4000-8000-000000000002' and o.title = 'Japan, briefly'
  ), 'its committed step stays';
end $$;

-- A lapsed stopping run is cancelled, and a run nobody claimed fails at the deadline.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Stop then vanish","route":"fast","perception":"model"}') ->> 'id', true);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  run_id uuid := current_setting('smoke.run')::uuid;
  lease uuid := (public.claim_runs(run_id, 1, 330, 100) -> 0 ->> 'lease_id')::uuid;
begin
  perform public.run_record_step(run_id, lease, '[]', '{}');
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
select public.cancel_run(current_setting('smoke.run')::uuid);

reset role;
update public.runs set lease_expires_at = now() - interval '1 second'
where id = current_setting('smoke.run')::uuid;
set local role service_role;

do $$
begin
  assert public.reap_runs() = 1, 'the lapsed stopping run is reaped';
  assert (select r.status from public.runs r where r.id = current_setting('smoke.run')::uuid)
    = 'cancelled', 'a lapsed stopping run is cancelled';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Nobody came","route":"fast","perception":"model"}') ->> 'id', true);

reset role;
update public.runs set created_at = now() - interval '16 minutes'
where id = current_setting('smoke.run')::uuid;
set local role service_role;

do $$
begin
  assert jsonb_array_length(public.claim_runs(null, 10, 330, 100)) = 0,
    'a run past the deadline is never claimed';
  assert public.reap_runs() = 1, 'the expired run is reaped';
  assert (select r.status from public.runs r where r.id = current_setting('smoke.run')::uuid)
    = 'failed', 'a run past the deadline fails';
end $$;

-- The cron claims a run its request left, unless the cap is reached.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

select set_config('smoke.run', public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Left behind","route":"fast","perception":"model"}') ->> 'id', true);

reset role;
update public.runs set created_at = now() - interval '11 seconds'
where id = current_setting('smoke.run')::uuid;
-- A live lease elsewhere, on an intent of the other user's, fills the cap of one.
insert into public.runs (user_id, intent_id, kind, input, lease_id, lease_expires_at)
values ('00000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-000000000005', 'ask',
  '{"text":"Busy","route":"fast","perception":"model"}', gen_random_uuid(),
  now() + interval '1 minute');
set local role service_role;

do $$
declare
  claimed jsonb;
begin
  assert jsonb_array_length(public.claim_runs(null, 10, 330, 1)) = 0, 'a full cap claims nothing';
  claimed := public.claim_runs(null, 10, 330, 2);
  assert jsonb_array_length(claimed) = 1
    and (claimed -> 0 ->> 'id')::uuid = current_setting('smoke.run')::uuid,
    'the cron claims the left-behind run when there is room';
  perform public.run_finish(current_setting('smoke.run')::uuid,
    (claimed -> 0 ->> 'lease_id')::uuid, 'failed', 'Nexui couldn''t finish this.');
  assert (select r.error from public.runs r where r.id = current_setting('smoke.run')::uuid)
    = 'Nexui couldn''t finish this.', 'a failed run keeps its error';
end $$;

reset role;
delete from public.runs where intent_id = '20000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

-- discard_intent deletes a trip no run started on, with its graph.
do $$
begin
  perform public.discard_intent('20000000-0000-4000-8000-000000000003');
  assert not exists (
    select 1 from public.intents i where i.id = '20000000-0000-4000-8000-000000000003'
  ), 'a run-less intent is discarded';
  assert not exists (
    select 1 from public.objects o where o.intent_id = '20000000-0000-4000-8000-000000000003'
  ), 'its graph goes with it';

  begin
    perform public.discard_intent('20000000-0000-4000-8000-000000000001');
    assert false, 'an intent with a run is never discarded';
  exception when sqlstate 'NXU04' then
    null;
  end;

  assert exists (
    select 1 from public.intents i where i.id = '20000000-0000-4000-8000-000000000001'
  ), 'the intent with runs is kept';
end $$;

-- The other user sees none of it and can't touch it.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}', true);

do $$
declare
  foreign_run uuid := (select r.id from public.runs r limit 1);
begin
  assert foreign_run is null, 'RLS hides the other user''s runs';

  begin
    perform public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
      '{"text":"Not mine","route":"fast","perception":"model"}');
    assert false, 'no runs on another user''s intent';
  exception when sqlstate 'NXU04' then
    null;
  end;

  begin
    perform public.discard_intent('20000000-0000-4000-8000-000000000005');
    assert false, 'no discarding another user''s intent';
  exception when sqlstate 'NXU04' then
    null;
  end;

  begin
    perform public.delete_intent('20000000-0000-4000-8000-000000000005');
    assert false, 'no deleting another user''s intent';
  exception when sqlstate 'NXU04' then
    null;
  end;
end $$;

-- The first user's run-less trip survived the other user's discard and delete.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);

do $$
begin
  assert exists (
    select 1 from public.intents i where i.id = '20000000-0000-4000-8000-000000000005'
  ), 'another user''s discard or delete leaves the intent';
end $$;

-- delete_intent waits out a working run, then deletes the plan with its graph, runs and events.
do $$
declare
  made jsonb;
begin
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"One more thing","route":"fast","perception":"model"}');

  begin
    perform public.delete_intent('20000000-0000-4000-8000-000000000001');
    assert false, 'no deleting a plan a run is working on';
  exception when sqlstate 'NXU12' then
    null;
  end;

  perform public.cancel_run((made ->> 'id')::uuid);
  perform public.delete_intent('20000000-0000-4000-8000-000000000001');

  assert not exists (
    select 1 from public.intents i where i.id = '20000000-0000-4000-8000-000000000001'
  ), 'the plan is deleted';
  assert not exists (
    select 1 from public.objects o where o.intent_id = '20000000-0000-4000-8000-000000000001'
  ), 'its objects go with it';
  assert not exists (
    select 1 from public.runs r where r.intent_id = '20000000-0000-4000-8000-000000000001'
  ), 'its runs go with it';
  assert not exists (
    select 1 from public.events e where e.intent_id = '20000000-0000-4000-8000-000000000001'
  ), 'its changes go with it';

  begin
    perform public.delete_intent('20000000-0000-4000-8000-000000000001');
    assert false, 'a deleted plan is gone';
  exception when sqlstate 'NXU04' then
    null;
  end;
end $$;

rollback;
