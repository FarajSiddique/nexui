import type { IntentListItem } from '@nexui/types';

/** A Home card's photo band: its photos, and how many more stops the plan has (the "+N"). */
export interface PhotoBand {
  photos: string[];
  more: number;
}

/**
 * The band for a card (spec section 5): the photos the API sent, and "+N" for the plan's stops
 * beyond them. A card with no photos has no band. The summary's strip holds at most 12 stops.
 *
 * @example
 * photoBand({ photos: [berlin, prague, vienna], summary }) // { photos: [...], more: 1 } for 4 stops
 */
export function photoBand(item: Pick<IntentListItem, 'photos' | 'summary'>): PhotoBand {
  if (item.photos.length === 0) {
    return { photos: [], more: 0 };
  }

  const stops = item.summary.strip?.length ?? 0;

  return { photos: item.photos, more: Math.max(0, stops - item.photos.length) };
}
