import { z } from 'zod';

import {
  applyOps,
  changesetOpSchema,
  type ChangesetOp,
  type GraphSnapshot,
  type ObjectSource,
  type RunProgressEntry,
} from '@nexui/types';

import { ChangesetInvalidError } from '../graph/errors.ts';
import { validateOps } from '../graph/prepare.ts';
import { buildRefTable, claimRefs, type RefTable } from './refs.ts';
import {
  CapabilityError,
  type Capability,
  type CapabilityActor,
  type CapabilityResult,
} from './types.ts';

export interface StagerOptions {
  capabilities: readonly Capability[];
  snapshot: GraphSnapshot;
  actor: CapabilityActor;
  runId: string | null;
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
  /** The ops staged since the last take, to commit as one changeset. */
  takeOps(): ChangesetOp[];
  /** The calls made since the last take, for the run's progress. */
  takeEntries(): StagedEntry[];
  /** Continues from a committed snapshot, which includes derived changes. Refs are kept. */
  reset(snapshot: GraphSnapshot): void;
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
    throw new CapabilityError('Nexui can only change trips so far.');
  }

  return anchorId;
}

/**
 * @example
 * const stager = createStager({ capabilities: CAPABILITIES, snapshot, actor: 'ai', runId, newId });
 * stager.call('trip.setPlaceDays', { placeId: 'o2', days: 3 });
 * await commitChangeset(db, { intentId, actor: 'ai', runId, ops: stager.takeOps() });
 */
export function createStager(options: StagerOptions): Stager {
  const clock = options.clock ?? ((): Date => new Date());
  const anchorId = requireAnchor(options.snapshot);
  const refs = buildRefTable(options.snapshot, anchorId);
  const source: ObjectSource =
    options.actor === 'ai' && options.runId
      ? { type: 'ai', runId: options.runId }
      : { type: 'user' };
  let staged = options.snapshot;
  let pending: ChangesetOp[] = [];
  let entries: StagedEntry[] = [];

  // Parses and validates everything before keeping anything, so a refused call leaves only its
  // progress entry behind.
  function stage(name: string, input: unknown): CapabilityResult {
    const capability = options.capabilities.find((candidate) => candidate.name === name);

    if (!capability) {
      throw new CapabilityError("That action isn't available.");
    }

    const parsed = capability.input.safeParse(input);

    if (!parsed.success) {
      throw new CapabilityError(describeIssue(parsed.error));
    }

    const result = capability.execute(parsed.data, {
      actor: options.actor,
      runId: options.runId,
      graph: staged,
      anchorId,
      refs,
      source,
      newId: options.newId,
    });
    const now = clock().toISOString();
    const ops = validateOps(
      staged,
      result.ops.map((op) => changesetOpSchema.parse(op)),
      now,
    );

    staged = applyOps(staged, ops, now);
    pending.push(...ops);
    claimRefs(refs, result.refs ?? {});

    return result;
  }

  return {
    refs,
    graph: () => staged,
    call(name, input) {
      const started = performance.now();

      try {
        const result = stage(name, input);

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
      pending = [];
    },
  };
}
