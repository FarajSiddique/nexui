import {
  evaluateQuery,
  readField,
  tripFigures,
  type DecisionData,
  type DerivedKey,
  type GraphObject,
  type GraphSnapshot,
  type Money,
  type OptionData,
  type PlaceData,
  type Section,
  type TripDerived,
  type WorkspaceDoc,
} from '@nexui/types';

import { placeName } from '#lib';

import { aiMarkFor } from './ai-mark.ts';

export interface MapPin {
  id: string;
  label: string;
  lat: number;
  lng: number;
  order: number;
  ai: boolean;
}

export interface RouteStop {
  place: GraphObject;
  order: number;
  /** The leg from this stop to the next one, if the graph has it. */
  legAfter: GraphObject | null;
}

export interface MetricValue {
  label: string;
  value: number | Money | null;
  format: 'days' | 'currency' | 'count';
  /** Filled with the accent: `emphasis: 'whenPositive'` and a value above 0. */
  hot: boolean;
}

export interface AllocationPart {
  id: string;
  label: string;
  value: number;
  ai: boolean;
}

export interface DecisionOption {
  option: GraphObject;
  /** The candidate place the option would add, if any. */
  place: GraphObject | null;
}

export type SectionData =
  | { type: 'map'; pins: MapPin[] }
  | {
      type: 'route';
      stops: RouteStop[];
      totalDays: number | null;
      allocatedDays: number;
      unallocatedDays: number | null;
    }
  | { type: 'metric'; metrics: MetricValue[] }
  | {
      type: 'allocation';
      parts: AllocationPart[];
      total: number | null;
      free: number;
      over: number;
    }
  | { type: 'objectList'; objects: GraphObject[] }
  | { type: 'comparison'; objects: GraphObject[] }
  | { type: 'decision'; decision: GraphObject | null; options: DecisionOption[] }
  | { type: 'insight'; insights: GraphObject[] };

export type SectionDataOf<T extends Section['type']> = Extract<SectionData, { type: T }>;

export interface SectionEntry {
  section: Section;
  data: SectionData;
}

export type WorkspaceBlock =
  { kind: 'section'; entry: SectionEntry } | { kind: 'open'; entries: SectionEntry[] };

const NO_FIGURES: TripDerived = {
  totalDays: null,
  allocatedDays: 0,
  unallocatedDays: null,
  estCost: null,
  costIncomplete: false,
};

/**
 * The anchor trip's figures, recomputed from the snapshot rather than read from
 * `data.derived`. An optimistic edit changes them before the server answers; the server's
 * answer then carries the same numbers.
 */
export function workspaceFigures(snapshot: GraphSnapshot): TripDerived {
  const anchorId = snapshot.workspace?.doc.anchorId;

  return anchorId ? tripFigures(snapshot, anchorId) : NO_FIGURES;
}

function derivedValue(figures: TripDerived, key: DerivedKey): number | Money | null {
  switch (key) {
    case 'trip.totalDays':
      return figures.totalDays;
    case 'trip.unallocatedDays':
      return figures.unallocatedDays;
    case 'trip.estCost':
      return figures.estCost;
  }
}

/** The leg from one stop to another, if the graph has one. */
export function legBetween(
  snapshot: GraphSnapshot,
  fromId: string,
  toId: string,
): GraphObject | null {
  const end = (legId: string, type: 'leg_from' | 'leg_to'): string | undefined =>
    snapshot.relationships.find((edge) => edge.sourceId === legId && edge.type === type)?.targetId;

  return (
    snapshot.objects.find(
      (object) =>
        object.kind === 'leg' &&
        end(object.id, 'leg_from') === fromId &&
        end(object.id, 'leg_to') === toId,
    ) ?? null
  );
}

function mapPins(places: GraphObject[]): MapPin[] {
  return places
    .filter((place) => {
      const data = place.data as Partial<PlaceData>;

      return typeof data.lat === 'number' && typeof data.lng === 'number';
    })
    .map((place, index) => {
      const data = place.data as PlaceData;

      return {
        id: place.id,
        label: placeName(place),
        lat: data.lat,
        lng: data.lng,
        order: index + 1,
        ai: aiMarkFor(place).highlight,
      };
    });
}

function decisionData(snapshot: GraphSnapshot, decisionId: string): SectionDataOf<'decision'> {
  const decision =
    snapshot.objects.find((object) => object.id === decisionId && object.kind === 'decision') ??
    null;

  if (!decision) {
    return { type: 'decision', decision: null, options: [] };
  }

  const options = evaluateQuery(snapshot, {
    from: 'objects',
    kind: 'option',
    related: { type: 'option_of', to: { objectId: decision.id }, direction: 'out' },
    sort: 'position',
  }).map((option) => {
    const placeId = (option.data as Partial<OptionData>).placeId;
    const place = placeId ? snapshot.objects.find((object) => object.id === placeId) : undefined;

    return { option, place: place ?? null };
  });

  return { type: 'decision', decision, options };
}

function sectionData(section: Section, snapshot: GraphSnapshot, figures: TripDerived): SectionData {
  switch (section.type) {
    case 'map':
      return { type: 'map', pins: mapPins(evaluateQuery(snapshot, section.places)) };
    case 'route': {
      const places = evaluateQuery(snapshot, section.query);
      const stops = places.map((place, index) => {
        const next = places[index + 1];

        return {
          place,
          order: index + 1,
          legAfter: next ? legBetween(snapshot, place.id, next.id) : null,
        };
      });

      return {
        type: 'route',
        stops,
        totalDays: figures.totalDays,
        allocatedDays: figures.allocatedDays,
        unallocatedDays: figures.unallocatedDays,
      };
    }

    case 'metric':
      return {
        type: 'metric',
        metrics: section.metrics.map((metric) => {
          const value = derivedValue(figures, metric.derived);

          return {
            label: metric.label,
            value,
            format: metric.format,
            hot: metric.emphasis === 'whenPositive' && typeof value === 'number' && value > 0,
          };
        }),
      };
    case 'allocation': {
      const parts = evaluateQuery(snapshot, section.parts).map((object) => {
        const value = readField(object, section.valueField);
        const label = readField(object, section.labelField);

        return {
          id: object.id,
          label: typeof label === 'string' && label.length > 0 ? label : placeName(object),
          value: typeof value === 'number' && value > 0 ? value : 0,
          ai: aiMarkFor(object).highlight,
        };
      });
      const totalValue = derivedValue(figures, section.total);
      const total = typeof totalValue === 'number' ? totalValue : null;
      const used = parts.reduce((sum, part) => sum + part.value, 0);

      return {
        type: 'allocation',
        parts,
        total,
        free: total === null ? 0 : Math.max(0, total - used),
        over: total === null ? 0 : Math.max(0, used - total),
      };
    }

    case 'objectList':
      return { type: 'objectList', objects: evaluateQuery(snapshot, section.query) };
    case 'comparison':
      return { type: 'comparison', objects: evaluateQuery(snapshot, section.query) };
    case 'decision':
      return decisionData(snapshot, section.decisionId);
    case 'insight':
      return { type: 'insight', insights: evaluateQuery(snapshot, section.query) };
  }
}

// Spec section D: a decision is unresolved while open; an insight while its query has rows.
function isUnresolved(data: SectionData): boolean {
  switch (data.type) {
    case 'decision':
      return (data.decision?.data as Partial<DecisionData> | undefined)?.status === 'open';
    case 'insight':
      return data.insights.length > 0;
    default:
      return true;
  }
}

/**
 * The workspace in render order. Sections follow the doc, except those pinned `open`: while
 * unresolved they are lifted into one Open band directly under the first metric section (or at
 * the top without one), and once resolved they are hidden.
 */
export function layoutWorkspace(doc: WorkspaceDoc, snapshot: GraphSnapshot): WorkspaceBlock[] {
  const figures = workspaceFigures(snapshot);
  const blocks: WorkspaceBlock[] = [];
  const open: SectionEntry[] = [];

  for (const section of doc.sections) {
    const entry: SectionEntry = { section, data: sectionData(section, snapshot, figures) };

    if (section.pin === 'open') {
      if (isUnresolved(entry.data)) {
        open.push(entry);
      }
    } else {
      blocks.push({ kind: 'section', entry });
    }
  }

  if (open.length === 0) {
    return blocks;
  }

  const metricAt = blocks.findIndex(
    (block) => block.kind === 'section' && block.entry.section.type === 'metric',
  );

  blocks.splice(metricAt + 1, 0, { kind: 'open', entries: open });

  return blocks;
}
