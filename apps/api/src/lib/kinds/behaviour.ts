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
  /**
   * `object.update` may change one: every object of the kind, or those a predicate accepts (a
   * document, except the resume). An anchor is editable but never creatable.
   */
  editable: boolean | ((object: GraphObject) => boolean);
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
  /**
   * Data fields too long to send on every step, such as a document's body: the prompt shows each
   * as its length, and the template's prompt says how to read it (readiness doc, section 3.6).
   */
  heavyFields?: readonly string[];
  /**
   * Data fields `object.update` refuses, like `derived`: what code owns, such as a search's
   * status and pass reasons, which `jobs.*` and the scans set (Decision 21).
   */
  readOnlyFields?: readonly string[];
  /**
   * The data field the object's title follows when `object.update` changes it, as a place's title
   * follows `name` (the default). A role's is `title`.
   */
  nameField?: string;
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
  search: {
    creatable: false,
    editable: true,
    positioned: false,
    links: [],
    readOnlyFields: ['status', 'roleChecks', 'passReasons', 'forwardFrom', 'forwarding'],
    plural: 'searches',
    modelHelp:
      'roles [string] (1 to 5 job titles), locations [string] (0 to 5 cities or regions), ' +
      'workModes [remote|hybrid|onsite] (at least one), salaryFloor? {amount, currency}, ' +
      'industries [string] (0 to 5), excludeCompanies [string] (up to 20 never to show).',
  },
  company: {
    creatable: true,
    editable: true,
    positioned: false,
    links: [],
    plural: 'companies',
    modelHelp:
      'name, domain? (such as stripe.com), target (true when the user named it), about? (one ' +
      'or two sentences).',
    createNote: 'A company the user names gets target true.',
  },
  // Roles are added and moved by `jobs.*`, which link them to their company and stamp dates; a
  // user (or a model, when asked) may rename one or correct where it is (Decision 2).
  opportunity: {
    creatable: false,
    editable: true,
    positioned: false,
    links: [],
    nameField: 'title',
    readOnlyFields: [
      'url',
      'source',
      'fit',
      'postedAt',
      'lastSeenLiveAt',
      'postingClosedAt',
      'stage',
      'outcome',
      'appliedAt',
      'lastContactAt',
      'followUps',
    ],
    plural: 'roles',
    modelHelp:
      'title (the role as the user names it), location?, workMode? (remote|hybrid|onsite), ' +
      'salary? {min?, max?, currency}. Stages, dates, links and fit are set by the jobs tools.',
  },
  interview: {
    creatable: false,
    editable: true,
    positioned: false,
    links: [],
    plural: 'interviews',
    modelHelp:
      'at (ISO date-time with offset, or a date YYYY-MM-DD), label (such as Recruiter screen), ' +
      'with? (who), link? (https URL), notes?.',
  },
  person: {
    creatable: true,
    editable: true,
    positioned: false,
    links: [
      { input: 'for', type: 'for', to: 'opportunity', help: 'People only: the role they are for' },
    ],
    plural: 'people',
    modelHelp: 'name, role (recruiter|hiring_manager|referral|interviewer|other), email?, notes?.',
    createNote: 'A person needs the role they are for.',
    linkNote: 'for: a person, draft or interview belongs to a role.',
  },
  document: {
    creatable: false,
    editable: (object) => object.data.docType !== 'resume',
    positioned: false,
    links: [],
    heavyFields: ['body'],
    plural: 'documents',
    modelHelp:
      'subject?, to? (email address), body (the text, up to 8,000 characters). Change a draft ' +
      'only when asked.',
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
