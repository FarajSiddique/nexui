import { isDeepStrictEqual } from 'node:util';

import {
  applyOps,
  formatDateRange,
  placeMediaKey,
  tripFigures,
  tripParts,
  type ChangesetOp,
  type DecisionData,
  type GraphObject,
  type GraphSnapshot,
  type InsightAction,
  type InsightData,
  type IntentSummary,
  type PlaceData,
  type TripData,
  type TripDerived,
} from '@nexui/types';

export const UNALLOCATED_KEY = 'trip.unallocatedDays';
export const LENGTH_KEY = 'trip.length';

/** A place the user just gave fewer days, for the "give it back" action. */
export interface ShortenedPlace {
  placeId: string;
  name: string;
  previousDays: number;
  days: number;
}

const days = (count: number): string => `${count} ${count === 1 ? 'day' : 'days'}`;

/** The first place in `ops` whose days went down, compared with `before`. */
export function findShortenedPlace(
  before: GraphSnapshot,
  ops: readonly ChangesetOp[],
): ShortenedPlace | null {
  for (const op of ops) {
    if (op.op !== 'update_object' || !op.patch.data) {
      continue;
    }

    const current = before.objects.find((object) => object.id === op.id);

    if (current?.kind !== 'place') {
      continue;
    }

    const previous = (current.data as PlaceData).days;
    const next = (op.patch.data as PlaceData).days;

    if (next < previous) {
      return {
        placeId: current.id,
        name: (current.data as PlaceData).name,
        previousDays: previous,
        days: next,
      };
    }
  }

  return null;
}

function linkToTrip(id: string, tripId: string, newId: () => string): ChangesetOp {
  return {
    op: 'insert_relationship',
    id: newId(),
    sourceType: 'object',
    sourceId: id,
    targetType: 'object',
    targetId: tripId,
    type: 'part_of',
    metadata: null,
    origin: 'derived',
  };
}

function removeWithLinks(staged: GraphSnapshot, object: GraphObject): ChangesetOp[] {
  const links = staged.relationships.filter(
    (edge) => edge.sourceId === object.id || edge.targetId === object.id,
  );

  return [
    { op: 'delete_object', id: object.id, origin: 'derived' },
    ...links.map((edge): ChangesetOp => ({
      op: 'delete_relationship',
      id: edge.id,
      origin: 'derived',
    })),
  ];
}

function unallocatedInsight(
  unallocated: number,
  shortened: ShortenedPlace | null,
  previous: InsightData | undefined,
): InsightData {
  if (unallocated < 0) {
    return {
      text: `${days(-unallocated)} more than the trip has`,
      detail: 'Shorten a stop or make the trip longer.',
      severity: 'attention',
      derivedKey: UNALLOCATED_KEY,
      actions: [],
    };
  }

  const actions: InsightAction[] = [
    {
      type: 'ask',
      label: 'Ask Nexui for ideas',
      prompt: `How should I use the ${days(unallocated)} I have free?`,
    },
  ];
  const giveBack: InsightAction | undefined = shortened
    ? {
        type: 'capability',
        label: `Give it back to ${shortened.name}`.slice(0, 40),
        name: 'trip.setPlaceDays',
        input: { placeId: shortened.placeId, days: shortened.previousDays },
      }
    : previous?.actions.find((action) => action.type === 'capability');

  if (giveBack) {
    actions.push(giveBack);
  }

  const insight: InsightData = {
    text: `You have ${days(unallocated)} unallocated`,
    severity: 'attention',
    derivedKey: UNALLOCATED_KEY,
    actions,
  };
  const detail = shortened
    ? `${shortened.name} went from ${shortened.previousDays} to ${days(shortened.days)}.`
    : previous?.detail;

  if (detail) {
    insight.detail = detail;
  }

  return insight;
}

function unallocatedInsightOps(
  staged: GraphSnapshot,
  tripId: string,
  figures: TripDerived,
  shortened: ShortenedPlace | null,
  newId: () => string,
): ChangesetOp[] {
  const existing = tripParts(staged, tripId).insights.find(
    (insight) => insight.data.derivedKey === UNALLOCATED_KEY,
  );
  const unallocated = figures.unallocatedDays;

  if (unallocated === null || unallocated === 0) {
    return existing ? removeWithLinks(staged, existing) : [];
  }

  const data = unallocatedInsight(
    unallocated,
    shortened,
    existing?.data as InsightData | undefined,
  );

  if (existing) {
    return isDeepStrictEqual(existing.data, data)
      ? []
      : [
          {
            op: 'update_object',
            id: existing.id,
            patch: { title: data.text, data },
            origin: 'derived',
          },
        ];
  }

  const id = newId();

  return [
    {
      op: 'insert_object',
      id,
      kind: 'insight',
      kindVersion: 1,
      title: data.text,
      status: null,
      data,
      source: { type: 'derived' },
      position: null,
      origin: 'derived',
    },
    linkToTrip(id, tripId, newId),
  ];
}

// While the length is unknown, "How long is the trip?" is an open, pinned decision.
function lengthDecisionOps(
  staged: GraphSnapshot,
  tripId: string,
  figures: TripDerived,
  newId: () => string,
): ChangesetOp[] {
  const doc = staged.workspace?.doc;
  const existing = tripParts(staged, tripId).decisions.find(
    (decision) =>
      decision.data.derivedKey === LENGTH_KEY && (decision.data as DecisionData).status === 'open',
  );

  if (figures.totalDays === null) {
    if (existing || !doc) {
      return [];
    }

    const id = newId();
    const data: DecisionData = {
      question: 'How long is the trip?',
      status: 'open',
      derivedKey: LENGTH_KEY,
    };

    return [
      {
        op: 'insert_object',
        id,
        kind: 'decision',
        kindVersion: 1,
        title: data.question,
        status: null,
        data,
        source: { type: 'derived' },
        position: null,
        origin: 'derived',
      },
      linkToTrip(id, tripId, newId),
      {
        op: 'set_workspace',
        doc: {
          ...doc,
          sections: [
            ...doc.sections,
            { id: `decision-${id}`, type: 'decision', decisionId: id, fields: [], pin: 'open' },
          ],
        },
        origin: 'derived',
      },
    ];
  }

  if (!existing) {
    return [];
  }

  const ops: ChangesetOp[] = [
    {
      op: 'update_object',
      id: existing.id,
      patch: { data: { ...existing.data, status: 'resolved' } },
      origin: 'derived',
    },
  ];

  if (doc) {
    ops.push({
      op: 'set_workspace',
      doc: {
        ...doc,
        sections: doc.sections.filter(
          (section) => !(section.type === 'decision' && section.decisionId === existing.id),
        ),
      },
      origin: 'derived',
    });
  }

  return ops;
}

function tripSummary(
  staged: GraphSnapshot,
  trip: GraphObject,
  figures: TripDerived,
): IntentSummary {
  const data = trip.data as TripData;
  const { places, decisions } = tripParts(staged, trip.id);
  const open = decisions.filter((decision) => (decision.data as DecisionData).status === 'open');
  const parts: string[] = [];

  if (data.startDate && data.endDate) {
    parts.push(formatDateRange(data.startDate, data.endDate));
  }

  if (figures.totalDays !== null) {
    parts.push(days(figures.totalDays));
  }

  parts.push(`${places.length} ${places.length === 1 ? 'stop' : 'stops'}`);

  if (open.length > 0) {
    parts.push(`${open.length} open ${open.length === 1 ? 'decision' : 'decisions'}`);
  }

  const summary: IntentSummary = { line: parts.join(', ').slice(0, 200) };
  const unallocated = figures.unallocatedDays;

  if (unallocated === null) {
    summary.badge = { text: 'Length not set', tone: 'attention' };
  } else if (unallocated > 0) {
    summary.badge = { text: `${days(unallocated)} unallocated`, tone: 'attention' };
  } else if (unallocated < 0) {
    summary.badge = { text: `${days(-unallocated)} over`, tone: 'attention' };
  } else if (places.length > 0) {
    summary.badge = { text: 'Every day planned', tone: 'ok' };
  }

  if (places.length > 0) {
    summary.strip = places.slice(0, 12).map((place) => {
      const data = place.data as PlaceData;

      return {
        label: data.name.slice(0, 100),
        ai: place.source?.type === 'ai' && !place.source.reviewedAt,
        key: placeMediaKey(data),
      };
    });
  }

  return summary;
}

// Stages derived ops so the summary counts a decision this changeset opened or closed. The
// timestamp doesn't matter here: the staged snapshot is only read.
function applyDerived(staged: GraphSnapshot, ops: readonly ChangesetOp[]): GraphSnapshot {
  return applyOps(staged, ops, staged.intent.updatedAt);
}

/**
 * `derive.trip`: recalculates the trip's figures and everything that depends on them, as
 * derived ops for the same changeset. Deterministic; no model call (spec section B).
 */
export function deriveTrip(
  staged: GraphSnapshot,
  tripId: string,
  shortened: ShortenedPlace | null,
  newId: () => string,
): ChangesetOp[] {
  const trip = staged.objects.find((object) => object.id === tripId && object.kind === 'trip');

  if (!trip) {
    return [];
  }

  const ops: ChangesetOp[] = [];
  const figures = tripFigures(staged, tripId);

  if (!isDeepStrictEqual(trip.data.derived, figures)) {
    ops.push({
      op: 'update_object',
      id: tripId,
      patch: { data: { ...trip.data, derived: figures } },
      origin: 'derived',
    });
  }

  ops.push(...unallocatedInsightOps(staged, tripId, figures, shortened, newId));
  ops.push(...lengthDecisionOps(staged, tripId, figures, newId));

  // The summary counts the decision this changeset may have just opened or closed.
  const settled = applyDerived(staged, ops);
  const summary = tripSummary(settled, trip, figures);

  if (!isDeepStrictEqual(staged.intent.summary, summary)) {
    ops.push({ op: 'update_intent', patch: { summary }, origin: 'derived' });
  }

  return ops;
}
