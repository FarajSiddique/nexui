-- Paste into the Supabase SQL editor (or run with psql). Creates two throwaway users, checks
-- create, change, undo, redo and isolation, and rolls everything back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'graph-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'graph-b@example.test');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

select public.create_intent(
  '10000000-0000-4000-8000-000000000001',
  'Plan a weekend in Chicago',
  'travel',
  jsonb_build_array(
    jsonb_build_object('op', 'insert_object', 'id', '10000000-0000-4000-8000-000000000002',
      'kind', 'trip', 'kindVersion', 1, 'title', 'Chicago', 'status', null,
      'data', '{"destinations":["Chicago"],"currency":"USD","totalDays":3}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', null, 'origin', 'direct'),
    jsonb_build_object('op', 'insert_object', 'id', '10000000-0000-4000-8000-000000000003',
      'kind', 'place', 'kindVersion', 1, 'title', 'The Loop', 'status', null,
      'data', '{"name":"The Loop","country":"US","placeType":"area","lat":41.88,"lng":-87.63,"days":2}'::jsonb,
      'source', '{"type":"user"}'::jsonb, 'position', 1, 'origin', 'direct'),
    jsonb_build_object('op', 'insert_relationship', 'id', '10000000-0000-4000-8000-000000000004',
      'sourceType', 'object', 'sourceId', '10000000-0000-4000-8000-000000000003',
      'targetType', 'object', 'targetId', '10000000-0000-4000-8000-000000000002',
      'type', 'part_of', 'metadata', null, 'origin', 'direct'),
    jsonb_build_object('op', 'set_workspace', 'origin', 'direct', 'doc',
      '{"version":1,"anchorId":"10000000-0000-4000-8000-000000000002","sections":[]}'::jsonb)
  )
);

do $$
declare
  snapshot jsonb := public.get_intent_snapshot('10000000-0000-4000-8000-000000000001');
  changed jsonb;
  undone jsonb;
  redone jsonb;
begin
  assert jsonb_array_length(snapshot -> 'objects') = 2, 'owner sees the trip and the place';
  assert jsonb_array_length(snapshot -> 'relationships') = 1, 'owner sees the link';
  assert snapshot -> 'workspace' is not null, 'the workspace exists';

  changed := public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
    jsonb_build_array(jsonb_build_object('op', 'update_object',
      'id', '10000000-0000-4000-8000-000000000003', 'origin', 'direct',
      'patch', jsonb_build_object('data',
        '{"name":"The Loop","country":"US","placeType":"area","lat":41.88,"lng":-87.63,"days":1}'::jsonb))));
  assert (changed #>> '{ops,0,after,data,days}')::int = 1, 'the change is logged with after';
  assert (changed #>> '{ops,0,before,data,days}')::int = 2, 'the change is logged with before';

  undone := public.revert_event((changed ->> 'id')::uuid);
  assert (undone ->> 'reverts_event_id') = (changed ->> 'id'), 'the undo points at the change';
  assert (select (data ->> 'days')::int from public.objects
    where id = '10000000-0000-4000-8000-000000000003') = 2, 'undo restores 2 days';

  begin
    perform public.revert_event((changed ->> 'id')::uuid);
    assert false, 'a second undo must fail';
  exception when sqlstate 'NXU10' then
    null;
  end;

  redone := public.revert_event((undone ->> 'id')::uuid);
  assert (select (data ->> 'days')::int from public.objects
    where id = '10000000-0000-4000-8000-000000000003') = 1, 'redo applies the change again';

  begin
    perform public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
      jsonb_build_array(jsonb_build_object('op', 'update_object',
        'id', '10000000-0000-4000-8000-000000000003', 'origin', 'direct',
        'expectedUpdatedAt', '2000-01-01T00:00:00Z', 'patch', '{"title":"Loop"}'::jsonb)));
    assert false, 'a stale expectedUpdatedAt must fail';
  exception when sqlstate 'NXU08' then
    null;
  end;

  begin
    insert into public.objects (intent_id, kind, data)
    values ('10000000-0000-4000-8000-000000000001', 'thing', '{}');
    assert false, 'clients must not insert directly';
  exception when insufficient_privilege then
    null;
  end;

  assert jsonb_array_length(public.changes_page(10)) = 4,
    'Changes lists create, change, undo and redo';
end;
$$;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
begin
  assert public.get_intent_snapshot('10000000-0000-4000-8000-000000000001') is null,
    'another user cannot read the intent';
  assert (select count(*) from public.objects) = 0, 'another user sees no objects';
  assert jsonb_array_length(public.changes_page(10)) = 0, 'another user sees no changes';

  begin
    perform public.apply_changeset('10000000-0000-4000-8000-000000000001', 'user', null,
      '[{"op":"delete_object","id":"10000000-0000-4000-8000-000000000003","origin":"direct"}]');
    assert false, 'another user cannot change the intent';
  exception when sqlstate 'NXU04' then
    null;
  end;
end;
$$;

rollback;
