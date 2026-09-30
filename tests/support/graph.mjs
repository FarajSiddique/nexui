export const USER_ID = '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11';
export const INTENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
export const TRIP_ID = 'a1b2c3d4-0000-4000-8000-000000000002';
export const TOKYO_ID = 'a1b2c3d4-0000-4000-8000-000000000003';
export const KYOTO_ID = 'a1b2c3d4-0000-4000-8000-000000000004';
export const TOKYO_REL_ID = 'a1b2c3d4-0000-4000-8000-000000000005';
export const KYOTO_REL_ID = 'a1b2c3d4-0000-4000-8000-000000000006';
export const EVENT_ID = 'a1b2c3d4-0000-4000-8000-000000000007';
export const STAMP = '2026-09-27T12:00:00.123456+00:00';
export const LATER = '2026-09-27T12:05:00.654321+00:00';

/** Deterministic ids for derived objects: b0000000-…-000000000001, …-000000000002, … */
export function idSequence() {
  let n = 0;

  return () => `b0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

export const tripData = {
  destinations: ['Japan'],
  startDate: '2026-12-12',
  endDate: '2026-12-20',
  currency: 'USD',
  derived: {
    totalDays: 8,
    allocatedDays: 8,
    unallocatedDays: 0,
    estCost: null,
    costIncomplete: false,
  },
};
export const tokyoData = {
  name: 'Tokyo',
  country: 'JP',
  placeType: 'city',
  lat: 35.68,
  lng: 139.69,
  days: 4,
};
export const kyotoData = {
  name: 'Kyoto',
  country: 'JP',
  placeType: 'city',
  lat: 35.01,
  lng: 135.77,
  days: 4,
};

export function objectRow(id, kind, data, extra = {}) {
  return {
    id,
    user_id: USER_ID,
    intent_id: INTENT_ID,
    kind,
    kind_version: 1,
    title: null,
    status: null,
    data,
    source: { type: 'user' },
    position: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

export function relationshipRow(id, sourceId, targetId, type = 'part_of') {
  return {
    id,
    user_id: USER_ID,
    intent_id: INTENT_ID,
    source_type: 'object',
    source_id: sourceId,
    target_type: 'object',
    target_id: targetId,
    type,
    metadata: null,
    deleted_at: null,
    created_at: STAMP,
  };
}

export const intentRow = {
  id: INTENT_ID,
  user_id: USER_ID,
  goal: 'Plan Japan in December',
  template: 'travel',
  status: 'exploring',
  context: {},
  summary: {
    line: 'Dec 12 – 20, 8 days, 2 stops',
    badge: { text: 'Every day planned', tone: 'ok' },
    strip: [
      { label: 'Tokyo', ai: false },
      { label: 'Kyoto', ai: false },
    ],
  },
  created_at: STAMP,
  updated_at: STAMP,
  last_activity_at: STAMP,
};

export const tripRow = objectRow(TRIP_ID, 'trip', tripData, { title: 'Plan Japan in December' });
export const tokyoRow = objectRow(TOKYO_ID, 'place', tokyoData, { title: 'Tokyo', position: 1 });
export const kyotoRow = objectRow(KYOTO_ID, 'place', kyotoData, { title: 'Kyoto', position: 2 });

/** What `get_intent_snapshot` returns for the fixture trip. `doc` is the travel template's. */
export function snapshotRow(doc, overrides = {}) {
  return {
    intent: intentRow,
    workspace: { intent_id: INTENT_ID, user_id: USER_ID, version: 1, doc, updated_at: STAMP },
    objects: [tripRow, tokyoRow, kyotoRow],
    relationships: [
      relationshipRow(TOKYO_REL_ID, TOKYO_ID, TRIP_ID),
      relationshipRow(KYOTO_REL_ID, KYOTO_ID, TRIP_ID),
    ],
    ...overrides,
  };
}

/** A logged changeset that shortened Tokyo from 4 to 3 days. */
export const eventRow = {
  id: EVENT_ID,
  user_id: USER_ID,
  intent_id: INTENT_ID,
  seq: 42,
  type: 'changeset',
  actor: 'user',
  run_id: null,
  reverts_event_id: null,
  ops: [
    {
      op: 'update_object',
      table: 'objects',
      id: TOKYO_ID,
      before: tokyoRow,
      after: { ...tokyoRow, data: { ...tokyoData, days: 3 }, updated_at: LATER },
      origin: 'direct',
    },
  ],
  payload: {},
  created_at: LATER,
};

export const RUN_ID = 'c0000000-0000-4000-8000-000000000001';

/** A `runs` row. It is created now, so it isn't stale unless a test says so. */
export function runRow(overrides = {}) {
  return {
    id: RUN_ID,
    user_id: USER_ID,
    intent_id: INTENT_ID,
    kind: 'create_intent',
    status: 'queued',
    input: {
      text: 'Plan Japan in December',
      route: 'reasoning',
      template: 'travel',
      perception: 'model',
    },
    progress: [],
    error: null,
    model_usage: {},
    started_at: null,
    finished_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}
