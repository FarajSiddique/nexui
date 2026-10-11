import { z } from 'zod';

import {
  applyOps,
  changesetOpSchema,
  type ChangesetOp,
  type GraphSnapshot,
  type ObjectSource,
  type RunProgressEntry,
} from '@nexui/types';

import {
  buildRefTable,
  CapabilityError,
  claimRefs,
  type Capability,
  type CapabilityActor,
  type CapabilityResult,
  type RefTable,
} from '#lib/capabilities';
import { ChangesetInvalidError, validateOps } from '#lib/graph';
import { templateFor, UNSUPPORTED_GOAL, type TemplateDefinition } from '#lib/templates';

export interface StagerOptions {
  capabilities: readonly Capability[];
  snapshot: GraphSnapshot;
  actor: CapabilityActor;
  runId: string | null;
  /** The run's request, handed to capabilities (a proposal shows it as "You asked …"). */
  request?: string;
  newId: () => string;
  clock?: () => Date;
}

/** A progress entry before the run knows which step it belongs to. */
export type StagedEntry = Omit<RunProgressEntry, 'step'>;

/**
 * Runs capabilities against a staged copy of one intent and collects their ops until the caller
 * commits them. One stager serves one run (or one button press).
 */
export interface Stager {
  readonly refs: RefTable;
  graph(): GraphSnapshot;
  /** Runs one capability. Throws `CapabilityError` with a message safe for the model and user. */
  call(name: string, input: unknown): Record<string, unknown>;
  /**
   * Records a call the model SDK refused before it ran (its input broke the tool's schema), so
   * the run's progress shows it with the schema's reason. Stages nothing.
   */
  recordRefused(name: string, input: unknown): void;
  /** The ops staged since the last take, to commit as one changeset. */
  takeOps(): ChangesetOp[];
  /** The calls made since the last take, for the run's progress. */
  takeEntries(): StagedEntry[];
  /**
   * Continues from a committed snapshot, which includes derived changes. Refs are kept, and this
   * snapshot becomes restage's new base: its refs and recorded calls reset here too.
   */
  reset(snapshot: GraphSnapshot): void;
  /**
   * Rebuilds the ops staged since the last reset over a newer snapshot, when the intent changed
   * underneath the step. Calls replay with the same ids and refs; a call whose patch would change
   * a field the user changed since then is dropped. Null when nothing changed.
   */
  restage(current: GraphSnapshot): ChangesetOp[] | null;
  /** The entry indexes of calls `restage` dropped since the last take, for the run's progress. */
  takeSkipped(): number[];
  /** The entry indexes `restage` has dropped since the last take, without taking them. */
  peekSkipped(): readonly number[];
}

// Progress keeps each call's input, so a run can be recorded as a fixture, up to this size.
const MAX_ENTRY_INPUT = 8_000;
const UNEXPECTED = 'That change could not be made.';

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return 'That input is not valid.';
  }

  const field = issue.path.join('.');

  return (field ? `${field}: ${issue.message}` : issue.message).slice(0, 300);
}

// The message to hand back for a refused call, or null for a bug.
function safeMessage(error: unknown): string | null {
  if (error instanceof CapabilityError || error instanceof ChangesetInvalidError) {
    return error.message.slice(0, 300);
  }

  if (error instanceof z.ZodError) {
    return describeIssue(error);
  }

  return null;
}

function entryInput(input: unknown): RunProgressEntry['input'] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }

  const json = JSON.stringify(input);

  return json.length <= MAX_ENTRY_INPUT ? (JSON.parse(json) as RunProgressEntry['input']) : null;
}

const elapsed = (started: number): number => Math.max(0, Math.round(performance.now() - started));

// A plain narrowing wouldn't survive into `stage`, a function declaration TypeScript treats as
// callable before the check runs; returning it with an explicit type does.
function requireAnchor(snapshot: GraphSnapshot): string {
  const anchorId = snapshot.workspace?.doc.anchorId;

  if (!anchorId) {
    throw new CapabilityError(UNSUPPORTED_GOAL);
  }

  return anchorId;
}

/**
 * The template whose capabilities may change this intent. Refused for an intent Nexui can't plan
 * yet, which has no template and no workspace.
 */
export function templateOf(snapshot: GraphSnapshot): TemplateDefinition {
  const template = templateFor(snapshot.intent.template);

  if (!template || !snapshot.workspace) {
    throw new CapabilityError(UNSUPPORTED_GOAL);
  }

  return template;
}

interface StagedCall {
  name: string;
  input: unknown;
  /** The ids the call generated, handed back in order when it replays. */
  ids: string[];
  /** The index of this call's entry in the step's progress, marked if a replay drops it. */
  entryIndex: number;
}

/** A step's call that no longer applies to the intent as it now is. */
class SupersededError extends Error {}

const COLUMNS = ['title', 'status', 'position'] as const;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function copyRefs(table: RefTable): RefTable {
  return { anchor: table.anchor, byRef: new Map(table.byRef), byId: new Map(table.byId) };
}

function restoreRefs(table: RefTable, saved: RefTable): void {
  table.byRef.clear();
  table.byId.clear();
  saved.byRef.forEach((id, ref) => table.byRef.set(ref, id));
  saved.byId.forEach((ref, id) => table.byId.set(id, ref));
}

// The fields of each object that changed between two snapshots: columns by name, data keys as
// `data.<key>`, and `*` for an object that is gone. `derived` is recalculated on every commit,
// so it never counts as a user's change.
function editedFields(base: GraphSnapshot, current: GraphSnapshot): Map<string, Set<string>> {
  const edited = new Map<string, Set<string>>();

  for (const before of base.objects) {
    const after = current.objects.find((object) => object.id === before.id);
    const fields = new Set<string>();

    if (!after) {
      fields.add('*');
    } else {
      for (const column of COLUMNS) {
        if (!sameValue(before[column], after[column])) {
          fields.add(column);
        }
      }

      const keys = new Set([...Object.keys(before.data), ...Object.keys(after.data)]);

      for (const key of keys) {
        if (key !== 'derived' && !sameValue(before.data[key], after.data[key])) {
          fields.add(`data.${key}`);
        }
      }
    }

    if (fields.size > 0) {
      edited.set(before.id, fields);
    }
  }

  return edited;
}

// True when an op would change something the user changed since the step began.
function touchesEdited(
  op: ChangesetOp,
  staged: GraphSnapshot,
  edited: Map<string, Set<string>>,
  workspaceMoved: boolean,
): boolean {
  if (op.op === 'set_workspace') {
    return workspaceMoved;
  }

  if (op.op === 'delete_object') {
    return edited.has(op.id);
  }

  if (op.op !== 'update_object') {
    return false;
  }

  const fields = edited.get(op.id);

  if (!fields) {
    return false;
  }

  if (fields.has('*')) {
    return true;
  }

  const object = staged.objects.find((candidate) => candidate.id === op.id);

  if (!object) {
    return false;
  }

  const columnClash = COLUMNS.some(
    (column) =>
      op.patch[column] !== undefined &&
      !sameValue(op.patch[column], object[column]) &&
      fields.has(column),
  );
  const data = op.patch.data ?? {};
  const dataClash = Object.keys(data).some(
    (key) => !sameValue(data[key], object.data[key]) && fields.has(`data.${key}`),
  );

  return columnClash || dataClash;
}

/**
 * @example
 * const { capabilities } = templateOf(snapshot);
 * const stager = createStager({ capabilities, snapshot, actor: 'ai', runId, newId });
 * stager.call('trip.setPlaceDays', { placeId: 'o2', days: 3 });
 * await commitChangeset(db, { intentId, actor: 'ai', runId, ops: stager.takeOps() });
 */
export function createStager(options: StagerOptions): Stager {
  const clock = options.clock ?? ((): Date => new Date());
  const template = templateOf(options.snapshot);
  const anchorId = requireAnchor(options.snapshot);
  const refs = buildRefTable(options.snapshot, anchorId, template.anchorRef);
  const source: ObjectSource =
    options.actor === 'ai' && options.runId
      ? { type: 'ai', runId: options.runId }
      : { type: 'user' };
  let staged = options.snapshot;
  let base = options.snapshot;
  let baseRefs = copyRefs(refs);
  let pending: ChangesetOp[] = [];
  let entries: StagedEntry[] = [];
  let calls: StagedCall[] = [];
  let skipped: number[] = [];

  // Parses and validates everything before keeping anything, so a refused call leaves only its
  // progress entry behind.
  function stage(
    name: string,
    input: unknown,
    entryIndex: number,
    replay?: { ids: string[]; accept: (ops: ChangesetOp[]) => boolean },
  ): CapabilityResult {
    const capability = options.capabilities.find((candidate) => candidate.name === name);

    if (!capability) {
      throw new CapabilityError("That action isn't available.");
    }

    const parsed = capability.input.safeParse(input);

    if (!parsed.success) {
      throw new CapabilityError(describeIssue(parsed.error));
    }

    const replayIds = replay ? [...replay.ids] : [];
    const ids: string[] = [];
    const newId = (): string => {
      const id = replayIds.shift() ?? options.newId();

      ids.push(id);

      return id;
    };
    const result = capability.execute(parsed.data, {
      actor: options.actor,
      runId: options.runId,
      request: options.request ?? null,
      graph: staged,
      anchorId,
      refs,
      source,
      newId,
    });
    const now = clock().toISOString();
    const ops = validateOps(
      staged,
      result.ops.map((op) => changesetOpSchema.parse(op)),
      now,
    );

    if (replay && !replay.accept(ops)) {
      throw new SupersededError(`${name} no longer applies.`);
    }

    staged = applyOps(staged, ops, now);
    pending.push(...ops);
    claimRefs(refs, result.refs ?? {});
    calls.push({ name, input, ids, entryIndex });

    return result;
  }

  return {
    refs,
    graph: () => staged,
    call(name, input) {
      const started = performance.now();
      const entryIndex = entries.length;

      try {
        const result = stage(name, input, entryIndex);

        entries.push({
          capability: name,
          label: result.label.slice(0, 200),
          ok: true,
          ms: elapsed(started),
          input: entryInput(input),
        });

        return result.output;
      } catch (error) {
        const message = safeMessage(error);

        if (message === null) {
          console.error('[capabilities]', `${name} failed unexpectedly.`);
        }

        entries.push({
          capability: name,
          label: `Could not run ${name}`,
          ok: false,
          ms: elapsed(started),
          input: entryInput(input),
          error: message ?? UNEXPECTED,
        });

        throw new CapabilityError(message ?? UNEXPECTED);
      }
    },
    recordRefused(name, input) {
      const capability = options.capabilities.find((candidate) => candidate.name === name);
      const parsed = capability?.input.safeParse(input);
      let error = "That action isn't available.";

      if (capability) {
        error =
          parsed && !parsed.success ? describeIssue(parsed.error) : 'That input is not valid.';
      }

      entries.push({
        capability: name,
        label: `Could not run ${name}`,
        ok: false,
        ms: 0,
        input: entryInput(input),
        error,
      });
    },
    takeOps() {
      const taken = pending;

      pending = [];

      return taken;
    },
    takeEntries() {
      const taken = entries;

      entries = [];

      return taken;
    },
    reset(snapshot) {
      staged = snapshot;
      base = snapshot;
      baseRefs = copyRefs(refs);
      pending = [];
      calls = [];
      skipped = [];
    },
    restage(current) {
      if (current.intent.lastActivityAt === base.intent.lastActivityAt) {
        return null;
      }

      const replayed = calls;
      const edited = editedFields(base, current);
      const workspaceMoved = current.workspace?.version !== base.workspace?.version;

      staged = current;
      pending = [];
      calls = [];
      restoreRefs(refs, baseRefs);

      for (const call of replayed) {
        const before = staged;

        try {
          stage(call.name, call.input, call.entryIndex, {
            ids: call.ids,
            accept: (ops) => !ops.some((op) => touchesEdited(op, before, edited, workspaceMoved)),
          });
        } catch (error) {
          skipped.push(call.entryIndex);

          if (safeMessage(error) === null && !(error instanceof SupersededError)) {
            console.error('[capabilities]', `${call.name} failed unexpectedly on replay.`);
          }
        }
      }

      return [...pending];
    },
    takeSkipped() {
      const taken = skipped;

      skipped = [];

      return taken;
    },
    peekSkipped() {
      return [...skipped];
    },
  };
}
