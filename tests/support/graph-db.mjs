import { randomUUID } from 'node:crypto';

import { mapSnapshotRow } from '../../apps/api/src/lib/graph/mappers.ts';
import { applyOps } from '../../packages/types/src/apply-ops.ts';
import { pgError, postgrest } from './graph-api.mjs';
import { eventRow, runRow, USER_ID } from './graph.mjs';

/** A contract-shaped snapshot as `get_intent_snapshot` returns it. */
export function toSnapshotRow(snapshot) {
  const { intent, workspace } = snapshot;

  return {
    intent: {
      id: intent.id,
      user_id: USER_ID,
      goal: intent.goal,
      template: intent.template,
      status: intent.status,
      context: intent.context,
      summary: intent.summary,
      created_at: intent.createdAt,
      updated_at: intent.updatedAt,
      last_activity_at: intent.lastActivityAt,
    },
    workspace: workspace
      ? {
          intent_id: workspace.intentId,
          user_id: USER_ID,
          version: workspace.version,
          doc: workspace.doc,
          updated_at: workspace.updatedAt,
        }
      : null,
    objects: snapshot.objects.map((object) => ({
      id: object.id,
      user_id: USER_ID,
      intent_id: object.intentId,
      kind: object.kind,
      kind_version: object.kindVersion,
      title: object.title,
      status: object.status,
      data: object.data,
      source: object.source,
      position: object.position,
      deleted_at: null,
      created_at: object.createdAt,
      updated_at: object.updatedAt,
    })),
    relationships: snapshot.relationships.map((edge) => ({
      id: edge.id,
      user_id: USER_ID,
      intent_id: edge.intentId,
      source_type: edge.sourceType,
      source_id: edge.sourceId,
      target_type: edge.targetType,
      target_id: edge.targetId,
      type: edge.type,
      metadata: edge.metadata,
      deleted_at: null,
      created_at: edge.createdAt,
    })),
  };
}

/**
 * Deletes an object and its links, as the user would from another device: the intent's
 * `lastActivityAt` moves, as `apply_changeset` would move it.
 */
export function removeObject(state, id) {
  const stamp = new Date(Date.now() + 1000).toISOString();

  state.snapshot = {
    ...state.snapshot,
    intent: { ...state.snapshot.intent, lastActivityAt: stamp },
    objects: state.snapshot.objects.filter((object) => object.id !== id),
    relationships: state.snapshot.relationships.filter(
      (edge) => edge.sourceId !== id && edge.targetId !== id,
    ),
  };
}

/**
 * Changes an object's data as the user would from another device: the object's `updatedAt` and
 * the intent's `lastActivityAt` move, as `apply_changeset` would move them.
 */
export function editObject(state, id, changes) {
  const stamp = new Date(Date.now() + 1000).toISOString();

  state.snapshot = {
    ...state.snapshot,
    intent: { ...state.snapshot.intent, lastActivityAt: stamp },
    objects: state.snapshot.objects.map((object) =>
      object.id === id
        ? { ...object, data: { ...object.data, ...changes }, updatedAt: stamp }
        : object,
    ),
  };
}

/**
 * A stateful PostgREST stand-in for one user and one intent. Commits apply their ops to the
 * in-memory intent, and the run functions keep one run with the SQL's statuses, including
 * `stopping`, so a whole run can execute against it.
 * `onApply(state, n)` runs after the nth commit and `onLoad(state, n)` before the nth snapshot
 * read, to simulate a cancel or an edit from elsewhere. `failApplyOnce` fails the first
 * `apply_changeset` call with that SQLSTATE (e.g. `'NXU08'`) instead of applying it, so a test can
 * exercise `commitChangeset`'s single automatic retry; every later call applies as normal.
 */
export function graphDb(
  initialRow = null,
  { run = runRow(), onApply, onLoad, failApplyOnce } = {},
) {
  const now = () => new Date().toISOString();
  const state = {
    snapshot: initialRow ? mapSnapshotRow(initialRow) : null,
    run: { ...run },
    applied: [],
    attempts: [],
    steps: [],
    loads: 0,
    created: null,
    createdRun: null,
    finished: null,
  };
  let pendingFailure = failApplyOnce ?? null;
  const active = () => ['queued', 'running', 'stopping'].includes(state.run.status);

  const fetch = postgrest({
    get_intent_snapshot: () => {
      state.loads += 1;
      onLoad?.(state, state.loads);

      return state.snapshot ? toSnapshotRow(state.snapshot) : null;
    },
    create_intent: (args) => {
      const stamp = now();

      state.created = args;
      state.snapshot = applyOps(
        {
          intent: {
            id: args.p_intent_id,
            goal: args.p_goal,
            template: args.p_template,
            status: 'exploring',
            context: {},
            summary: { line: '' },
            createdAt: stamp,
            updatedAt: stamp,
            lastActivityAt: stamp,
          },
          workspace: null,
          objects: [],
          relationships: [],
        },
        args.p_ops,
        stamp,
      );

      return {};
    },
    apply_changeset: (args) => {
      state.attempts.push(args);

      if (pendingFailure) {
        const code = pendingFailure;

        pendingFailure = null;

        return pgError(code);
      }

      const stamp = now();

      state.applied.push(args);
      state.snapshot = applyOps(state.snapshot, args.p_ops, stamp);
      state.snapshot = {
        ...state.snapshot,
        intent: { ...state.snapshot.intent, lastActivityAt: stamp },
      };
      onApply?.(state, state.applied.length);

      return {
        ...eventRow,
        id: randomUUID(),
        actor: args.p_actor,
        run_id: args.p_run_id,
        ops: null,
      };
    },
    create_run: (args) => {
      state.createdRun = args;
      state.run = {
        ...state.run,
        intent_id: args.p_intent_id,
        kind: args.p_kind,
        input: args.p_input,
        status: 'queued',
      };

      return state.run;
    },
    record_run_step: (args) => {
      state.steps.push(args);

      if (active()) {
        state.run = {
          ...state.run,
          status: state.run.status === 'stopping' ? 'stopping' : 'running',
          progress: [...state.run.progress, ...args.p_entries],
        };
      }

      return state.run.status;
    },
    finish_run: (args) => {
      state.finished = args;

      if (state.run.status === 'stopping') {
        const status = args.p_status === 'failed' ? 'failed' : 'cancelled';

        state.run = { ...state.run, status, error: status === 'failed' ? args.p_error : null };
      } else if (active()) {
        state.run = { ...state.run, status: args.p_status, error: args.p_error };
      }

      return state.run;
    },
    cancel_run: () => {
      if (state.run.status === 'running') {
        state.run = { ...state.run, status: 'stopping' };
      } else if (state.run.status === 'queued' || state.run.status === 'awaiting_approval') {
        state.run = { ...state.run, status: 'cancelled' };
      }

      return state.run;
    },
  });

  return { state, fetch };
}
