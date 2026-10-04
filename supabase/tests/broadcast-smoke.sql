-- Paste into the Supabase SQL editor (or run with psql). Checks that a changeset and each run
-- write broadcast one signal on the intent's private topic, and that only the intent's owner
-- may join that topic. Realtime authorizes a join by reading realtime.messages with
-- `realtime.topic` set, as the user; this does the same. Rolls everything back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'broadcast-a@example.test'),
  ('00000000-0000-4000-8000-0000000000d2', 'broadcast-b@example.test');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true);

-- One changeset with two objects sends one message, not one per row.
select public.create_intent(
  '30000000-0000-4000-8000-000000000001',
  'Plan Peru in March',
  'travel',
  jsonb_build_array(
    jsonb_build_object('op', 'insert_object',
      'id', '30000000-0000-4000-8000-000000000002', 'kind', 'trip', 'kindVersion', 1,
      'title', 'Peru', 'status', null,
      'data', '{"destinations":["Peru"],"currency":"USD"}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'),
    jsonb_build_object('op', 'insert_object',
      'id', '30000000-0000-4000-8000-000000000003', 'kind', 'note', 'kindVersion', 1,
      'title', 'Visa', 'status', null,
      'data', '{"text":"Check entry rules"}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'))
);

reset role;
select public.create_run('00000000-0000-4000-8000-0000000000d1', '30000000-0000-4000-8000-000000000001', 'ask',
  '{"text":"Add Cusco","route":"fast","perception":"model"}');

reset role;

do $$
declare
  intent_topic text := 'intent:30000000-0000-4000-8000-000000000001';
begin
  assert (
    select count(*) from realtime.messages m
    where m.topic = intent_topic and m.payload ->> 'table' = 'events'
  ) = 1, 'the changeset sent one message';
  assert (
    select count(*) from realtime.messages m
    where m.topic = intent_topic and m.payload ->> 'table' = 'runs'
  ) = 1, 'the new run sent one message';
  assert (
    select bool_and(m.private and m.extension = 'broadcast' and m.event = 'changed')
    from realtime.messages m
    where m.topic = intent_topic
  ), 'messages are private broadcasts';
  assert not exists (
    select 1 from realtime.messages m where m.topic = intent_topic and m.payload ? 'data'
  ), 'messages carry no plan data';
end $$;

-- The owner may join their topic.
set local role authenticated;
select set_config('realtime.topic', 'intent:30000000-0000-4000-8000-000000000001', true);

do $$
begin
  assert exists (select 1 from realtime.messages), 'the owner can join';
end $$;

-- A malformed topic matches nothing, without an error.
select set_config('realtime.topic', 'intent:not-a-uuid', true);

do $$
begin
  assert not exists (select 1 from realtime.messages), 'a malformed topic is refused';
end $$;

-- Another user can't join the owner's topic.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}', true);
select set_config('realtime.topic', 'intent:30000000-0000-4000-8000-000000000001', true);

do $$
begin
  assert not exists (select 1 from realtime.messages), 'another user can''t join';
end $$;

-- And no one may send on it.
do $$
begin
  insert into realtime.messages (topic, extension, event, payload, private)
  values ('intent:30000000-0000-4000-8000-000000000001', 'broadcast', 'changed', '{}', true);
  assert false, 'clients can''t broadcast';
exception when insufficient_privilege then
  null;
end $$;

-- postgres_changes is off for the graph tables.
reset role;

do $$
begin
  assert not exists (
    select 1 from pg_publication_tables p
    where p.pubname = 'supabase_realtime' and p.schemaname = 'public'
      and p.tablename in ('objects', 'relationships', 'workspaces', 'events', 'runs')
  ), 'the graph tables left the publication';
end $$;

rollback;
