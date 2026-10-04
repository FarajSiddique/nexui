import type { GraphSnapshot, IntentMedia, PlaceAbout } from '@nexui/types';

/** How many times the app asks again while a lookup is still pending (spec section 5). */
export const MEDIA_POLLS = 10;

const FRESH_MS = 5 * 60_000;

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

/**
 * How long an answer stays fresh: five minutes, or not at all while a lookup is pending, so
 * opening the plan again asks again once the polls have run out.
 */
export function mediaStaleTime(media: IntentMedia | undefined): number {
  return hasPendingMedia(media) ? 0 : FRESH_MS;
}

/**
 * What the stop sheet's About shows for one place: its introduction, `'pending'` while the
 * answer loads or the lookup runs and the app is still polling, or null (no article, a failed
 * lookup, a failed request, or polls that ran out).
 */
export function placeAbout(
  media: IntentMedia | undefined,
  placeId: string,
  query: { loading: boolean; answers: number },
): PlaceAbout | 'pending' | null {
  const entry = media?.places[placeId];

  if (entry?.status === 'ready') {
    return entry.about;
  }

  if (entry?.status === 'pending') {
    return mediaPollInterval(media, query.answers) === false ? null : 'pending';
  }

  return query.loading ? 'pending' : null;
}
