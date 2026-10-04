import type { GraphSnapshot, IntentMedia } from '@nexui/types';

/** How many times the app asks again while a lookup is still pending (spec section 5). */
export const MEDIA_POLLS = 10;

/** Every place in a snapshot, decision candidates included: what the media route answers. */
export function mediaPlaceIds(snapshot: GraphSnapshot): string[] {
  return snapshot.objects.filter((object) => object.kind === 'place').map((object) => object.id);
}

/** The media query's key part: sorted place ids, so a stop the model adds starts a fetch. */
export function mediaKeyIds(placeIds: readonly string[]): string {
  return [...placeIds].sort().join(',');
}

/** True while any place's lookup hasn't finished. */
export function hasPendingMedia(media: IntentMedia | undefined): boolean {
  return media ? Object.values(media.places).some((place) => place.status === 'pending') : false;
}

/**
 * Every 2 seconds while a lookup is pending, for ten refetches after the first answer; then
 * stop. `answers` is how many answers the query has had (TanStack's `dataUpdateCount`).
 */
export function mediaPollInterval(media: IntentMedia | undefined, answers: number): number | false {
  return hasPendingMedia(media) && answers <= MEDIA_POLLS ? 2_000 : false;
}
