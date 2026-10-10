import type { GraphObject, GraphSnapshot, KindName } from '@nexui/types';

/** A link `object.create` makes from one of its inputs, such as a leg's `from` place. */
export interface KindLink {
  /** The `object.create` input that names the linked object. */
  input: string;
  /** The relationship it makes. */
  type: string;
  /** The kind the linked object must be. */
  to: KindName;
  /** The input's help for models. */
  help: string;
}

/**
 * How the generic `object.*`, `relationship.*` and `workspace.addSection` capabilities treat one
 * kind (readiness doc, section 3.2). A template's capability scope lists its kinds
 * (`CapabilityScope.kinds`); the capabilities read the rest here, so a new kind declares its
 * behaviour beside its schema and needs no capability code.
 */
export interface KindBehaviour {
  /** `object.create` may make one, and `object.delete` may remove one. */
  creatable: boolean;
  /** `object.update` may change one. An anchor is editable but never creatable. */
  editable: boolean;
  /** A new one joins the end of its kind's ordered list, as a place joins the route. */
  positioned: boolean;
  /** Links `object.create` makes from its inputs. A kind with links needs every one. */
  links: readonly KindLink[];
  /** Its title when `object.create` gets none, from the objects its links name, in link order. */
  title?: (linked: readonly GraphObject[]) => string;
  /** What else `object.delete` removes with it. */
  dependents?: (graph: GraphSnapshot, object: GraphObject) => GraphObject[];
  /** The plural capability descriptions use. */
  plural: string;
  /** Its data fields as models read them: in `object.create`, or `object.update` for an anchor. */
  modelHelp?: string;
  /** A sentence `object.create`'s description adds about this kind. */
  createNote?: string;
  /** A sentence `object.delete`'s description adds about this kind. */
  deleteNote?: string;
  /** A sentence `relationship.create`'s description adds about this kind's links. */
  linkNote?: string;
}

// Duplicates `capabilities/helpers.ts`'s `nameOf` on purpose: `lib/kinds` imports no other
// domain, and importing it would make a cycle.
const nameOf = (object: GraphObject): string => object.title ?? object.kind;

// A place's legs, at either end, and the stays in it.
function placeDependents(graph: GraphSnapshot, place: GraphObject): GraphObject[] {
  const legIds = new Set(
    graph.relationships
      .filter(
        (edge) =>
          (edge.type === 'leg_from' || edge.type === 'leg_to') && edge.targetId === place.id,
      )
      .map((edge) => edge.sourceId),
  );

  return graph.objects.filter(
    (candidate) =>
      legIds.has(candidate.id) ||
      (candidate.kind === 'stay' && candidate.data.placeId === place.id),
  );
}

/** How the generic capabilities treat each kind, beside its schema in `KIND_REGISTRY`. */
export const KIND_BEHAVIOUR: Record<KindName, KindBehaviour> = {
  trip: {
    creatable: false,
    editable: true,
    positioned: false,
    links: [],
    plural: 'trips',
    modelHelp:
      'destinations? [string], startDate?/endDate? (ISO date YYYY-MM-DD, both or neither), ' +
      'totalDays? (1-365), travelers? (1-50), budget? {amount, currency}, pace? ' +
      '(slow|balanced|fast), currency? (3-letter ISO 4217 such as JPY).',
  },
  place: {
    creatable: true,
    editable: true,
    positioned: true,
    links: [],
    dependents: placeDependents,
    plural: 'places',
    modelHelp:
      'name, country (ISO 3166-1 alpha-2 such as JP), placeType (city|region|town|area|site), ' +
      'lat (-90 to 90), lng (-180 to 180), days (whole days, 0 to 365), estDailyCost? ' +
      '{amount, currency}, why? (one short sentence).',
    createNote: 'Places join the end of the route.',
    deleteNote: 'Removing a place also removes its legs and stays.',
  },
  leg: {
    creatable: true,
    editable: true,
    positioned: false,
    links: [
      { input: 'from', type: 'leg_from', to: 'place', help: 'Legs only: the place it leaves from' },
      { input: 'to', type: 'leg_to', to: 'place', help: 'Legs only: the place it arrives at' },
    ],
    title: (linked) => linked.map(nameOf).join(' → '),
    plural: 'legs',
    modelHelp:
      'mode (flight|train|bus|car|ferry|other), estHours? (0 to 200), estCost? {amount, ' +
      'currency}.',
    createNote: 'A leg needs from and to places.',
    linkNote: 'leg_from and leg_to: a leg leaves from or arrives at a place.',
  },
  stay: {
    creatable: true,
    editable: true,
    positioned: false,
    links: [],
    plural: 'stays',
    modelHelp:
      'name, placeId (a place ref), nights (1 to 365), estNightly? {amount, currency}, url? ' +
      '(absolute URL).',
  },
  decision: {
    creatable: false,
    editable: false,
    positioned: false,
    links: [],
    plural: 'decisions',
  },
  option: { creatable: false, editable: false, positioned: false, links: [], plural: 'options' },
  insight: { creatable: false, editable: false, positioned: false, links: [], plural: 'insights' },
  thing: {
    creatable: true,
    editable: true,
    positioned: false,
    links: [],
    plural: 'things',
    modelHelp: 'fields [{label, value}].',
  },
};
