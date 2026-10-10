import {
  changeItemSchema,
  eventRecordSchema,
  graphSnapshotSchema,
  intentListItemSchema,
  upgradeWorkspace,
  type ChangeItem,
  type EventRecord,
  type GraphSnapshot,
  type IntentListItem,
} from '@nexui/types';

// Rows arrive from Postgres functions as `to_jsonb(row)`: snake_case columns.
type Row = Record<string, unknown>;

function mapIntent(row: Row): Row {
  return {
    id: row.id,
    goal: row.goal,
    template: row.template,
    status: row.status,
    context: row.context,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

function mapObject(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    kind: row.kind,
    kindVersion: row.kind_version,
    title: row.title,
    status: row.status,
    data: row.data,
    source: row.source,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRelationship(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    type: row.type,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/** `get_intent_snapshot`'s result in contract shape. */
export function mapSnapshotRow(row: unknown): GraphSnapshot {
  const snapshot = row as {
    intent: Row;
    workspace: Row | null;
    objects: Row[];
    relationships: Row[];
  };
  const workspace = snapshot.workspace;

  return graphSnapshotSchema.parse({
    intent: mapIntent(snapshot.intent),
    workspace: workspace
      ? {
          intentId: workspace.intent_id,
          version: workspace.version,
          doc: upgradeWorkspace(workspace.doc),
          updatedAt: workspace.updated_at,
        }
      : null,
    objects: snapshot.objects.map(mapObject),
    relationships: snapshot.relationships.map(mapRelationship),
  });
}

function eventFields(row: Row): Row {
  return {
    id: row.id,
    intentId: row.intent_id,
    seq: row.seq,
    type: row.type,
    actor: row.actor,
    runId: row.run_id,
    revertsEventId: row.reverts_event_id,
    ops: row.ops,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

/** One `events` row. */
export function mapEventRow(row: unknown): EventRecord {
  return eventRecordSchema.parse(eventFields(row as Row));
}

/** One `changes_page` item: an event plus its intent's goal and any Undo that reverted it. */
export function mapChangeRow(row: unknown): ChangeItem {
  const change = row as Row;

  return changeItemSchema.parse({
    ...eventFields(change),
    intentGoal: change.intent_goal ?? null,
    revertedByEventId: change.reverted_by_event_id ?? null,
  });
}

/** One row of the Home list query. */
export function mapIntentListRow(row: unknown): IntentListItem {
  const intent = row as Row;

  return intentListItemSchema.parse({
    id: intent.id,
    goal: intent.goal,
    template: intent.template,
    status: intent.status,
    summary: intent.summary,
    lastActivityAt: intent.last_activity_at,
    // Filled from the media cache by the list route (`withHomePhotos`).
    photos: [],
  });
}
