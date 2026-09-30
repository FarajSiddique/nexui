import type { KindName } from './registry.ts';

/** How a field reads on a card or in a comparison. */
export type FieldFormat = 'currency' | 'days' | 'hours' | 'text';

/** Which fields make up an object's card: a title and a one-line subtitle (spec section D). */
export interface CardSpec {
  title: string;
  subtitle: { field: string; format?: FieldFormat }[];
}

// Field paths use the same form as workspace queries: a column, or `data.<key>`.
export const KIND_CARDS: Record<KindName, CardSpec> = {
  trip: { title: 'title', subtitle: [{ field: 'data.totalDays', format: 'days' }] },
  place: {
    title: 'data.name',
    subtitle: [{ field: 'data.days', format: 'days' }, { field: 'data.why' }],
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
  decision: { title: 'data.question', subtitle: [{ field: 'data.tradeoff' }] },
  option: { title: 'data.label', subtitle: [{ field: 'data.summary' }] },
  insight: { title: 'data.text', subtitle: [{ field: 'data.detail' }] },
  thing: { title: 'title', subtitle: [] },
};
