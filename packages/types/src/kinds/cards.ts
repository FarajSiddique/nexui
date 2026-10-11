import type { KindName } from './registry.ts';

/**
 * How a field reads on a card or in a comparison. `dateTime` is a date with its time (an
 * interview's `at`); `estimate` is an amount marked "≈".
 */
export type FieldFormat = 'currency' | 'days' | 'hours' | 'text' | 'dateTime' | 'estimate';

/** A row a decision adds for an option's candidate object, such as a place's daily cost. */
export interface CompareField {
  field: string;
  label: string;
  format?: FieldFormat;
}

/** Which fields make up an object's card: a title and a one-line subtitle (spec section D). */
export interface CardSpec {
  title: string;
  subtitle: { field: string; format?: FieldFormat }[];
  /** Rows a decision compares across its options' candidates of this kind. */
  compare?: CompareField[];
}

// Field paths use the same form as workspace queries: a column, or `data.<key>`.
export const KIND_CARDS: Record<KindName, CardSpec> = {
  trip: { title: 'title', subtitle: [{ field: 'data.totalDays', format: 'days' }] },
  place: {
    title: 'data.name',
    subtitle: [{ field: 'data.days', format: 'days' }, { field: 'data.why' }],
    compare: [{ field: 'data.estDailyCost', label: 'Per day', format: 'estimate' }],
  },
  leg: {
    title: 'title',
    subtitle: [
      { field: 'data.mode' },
      { field: 'data.estHours', format: 'hours' },
      { field: 'data.estCost', format: 'currency' },
    ],
  },
  stay: { title: 'data.name', subtitle: [{ field: 'data.estNightly', format: 'currency' }] },
  search: { title: 'title', subtitle: [{ field: 'data.status' }] },
  company: { title: 'data.name', subtitle: [{ field: 'data.about' }] },
  opportunity: {
    title: 'data.title',
    subtitle: [{ field: 'data.location' }, { field: 'data.workMode' }],
  },
  interview: { title: 'data.label', subtitle: [{ field: 'data.at', format: 'dateTime' }] },
  person: { title: 'data.name', subtitle: [{ field: 'data.role' }] },
  document: { title: 'title', subtitle: [{ field: 'data.docType' }] },
  decision: { title: 'data.question', subtitle: [{ field: 'data.tradeoff' }] },
  option: { title: 'data.label', subtitle: [{ field: 'data.summary' }] },
  insight: { title: 'data.text', subtitle: [{ field: 'data.detail' }] },
  thing: { title: 'title', subtitle: [] },
};
