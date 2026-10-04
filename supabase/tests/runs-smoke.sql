-- Paste into the Supabase SQL editor (or run with psql). Checks the run functions,
-- discard_intent and delete_intent as two throwaway users and rolls everything back.
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

do $$
declare
  made jsonb;
  made_id uuid;
  step_status text;
begin
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Make it slower","route":"reasoning","perception":"model"}');
  made_id := (made ->> 'id')::uuid;
  assert made ->> 'status' = 'queued', 'a new run is queued';

  begin
    perform public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
      '{"text":"Again","route":"edit","perception":"model"}');
    assert false, 'a second active run is refused';
  exception when sqlstate 'NXU12' then
    null;
  end;

  step_status := public.record_run_step(made_id,
    '[{"step":0,"capability":"object.update","label":"Updated Japan","ok":true,"ms":2,"input":{"ref":"trip"}}]',
    '{"inputTokens":100,"outputTokens":20,"model":"anthropic/claude-sonnet-5.5"}');
  assert step_status = 'running', 'a step marks the run running';

  perform public.record_run_step(made_id, '[]', '{"inputTokens":50,"outputTokens":5}');
  made := (select to_jsonb(r) from public.runs r where r.id = made_id);
  assert jsonb_array_length(made -> 'progress') = 1, 'progress keeps the step';
  assert (made -> 'model_usage' ->> 'inputTokens')::int = 150, 'usage adds up';
  assert made -> 'model_usage' ->> 'model' = 'anthropic/claude-sonnet-5.5', 'the model is kept';
  assert made ->> 'started_at' is not null, 'the start is recorded';

  -- Stop lets a running run finish the step it is taking.
  made := public.cancel_run(made_id);
  assert made ->> 'status' = 'stopping', 'stop moves a running run to stopping';
  assert made ->> 'finished_at' is null, 'a stopping run has not finished';

  begin
    perform public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
      '{"text":"Too soon","route":"edit","perception":"model"}');
    assert false, 'no new run while one is stopping';
  exception when sqlstate 'NXU12' then
    null;
  end;

  step_status := public.record_run_step(made_id,
    '[{"step":1,"capability":"object.update","label":"Updated Tokyo","ok":true,"ms":3,"input":{"ref":"tokyo"}}]',
    '{"inputTokens":10,"outputTokens":2}');
  assert step_status = 'stopping', 'the last step sees the stop';
  made := (select to_jsonb(r) from public.runs r where r.id = made_id);
  assert made ->> 'status' = 'stopping', 'recording keeps the run stopping';
  assert jsonb_array_length(made -> 'progress') = 2, 'the last step''s entries are kept';
  assert (made -> 'model_usage' ->> 'inputTokens')::int = 160, 'the last step''s usage adds up';

  made := public.cancel_run(made_id);
  assert made ->> 'status' = 'stopping', 'a second stop changes nothing';

  made := public.finish_run(made_id, 'succeeded', null);
  assert made ->> 'status' = 'cancelled', 'a stopping run finishes cancelled';
  assert made ->> 'finished_at' is not null, 'the finish is recorded';
  assert public.record_run_step(made_id, '[]', '{}') = 'cancelled', 'steps see the cancel';

  made := public.finish_run(made_id, 'failed', 'Too late');
  assert made ->> 'status' = 'cancelled' and made ->> 'error' is null,
    'finishing again keeps the cancel';

  -- A stopping run whose last step failed ends failed, with that error.
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Stop this one too","route":"edit","perception":"model"}');
  made_id := (made ->> 'id')::uuid;
  perform public.record_run_step(made_id, '[]', '{}');
  made := public.cancel_run(made_id);
  assert made ->> 'status' = 'stopping', 'the second run is stopping';
  made := public.finish_run(made_id, 'failed', 'Nexui couldn''t finish this.');
  assert made ->> 'status' = 'failed' and made ->> 'error' = 'Nexui couldn''t finish this.',
    'a stopping run that failed ends failed with its error';

  -- A queued run has no step to finish, so Stop cancels it at once.
  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Never mind","route":"fast","perception":"model"}');
  made := public.cancel_run((made ->> 'id')::uuid);
  assert made ->> 'status' = 'cancelled', 'stop cancels a queued run at once';
  assert made ->> 'finished_at' is not null, 'a cancelled queued run has finished';

  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Now it can run","route":"fast","perception":"model"}');
  made := public.finish_run((made ->> 'id')::uuid, 'failed', 'Nexui couldn''t finish this.');
  assert made ->> 'status' = 'failed' and made ->> 'error' = 'Nexui couldn''t finish this.',
    'a failed run keeps its error';

  -- discard_intent deletes a trip no run started on, with its graph.
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
