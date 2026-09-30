-- Paste into the Supabase SQL editor (or run with psql). Checks the run functions as two
-- throwaway users and rolls everything back.
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

  made := public.cancel_run(made_id);
  assert made ->> 'status' = 'cancelled', 'cancel stops a running run';
  assert public.record_run_step(made_id, '[]', '{}') = 'cancelled', 'steps see the cancel';

  made := public.finish_run(made_id, 'succeeded', null);
  assert made ->> 'status' = 'cancelled', 'finishing keeps the cancel';

  made := public.create_run('20000000-0000-4000-8000-000000000001', 'ask',
    '{"text":"Now it can run","route":"fast","perception":"model"}');
  made := public.finish_run((made ->> 'id')::uuid, 'failed', 'Nexui couldn''t finish this.');
  assert made ->> 'status' = 'failed' and made ->> 'error' = 'Nexui couldn''t finish this.',
    'a failed run keeps its error';
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
end $$;

rollback;
