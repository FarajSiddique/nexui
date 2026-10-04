import type { GraphSnapshot, IntentMedia, PlaceAbout, PlaceMedia, PlacePhoto } from '@nexui/types';

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

/** How far the media query has got: still loading, and how many answers it has had. */
export interface MediaQueryState {
  loading: boolean;
  answers: number;
}

/** What a photo slot shows: the photo, `'pending'` while it may still come, or null. */
export type PhotoState = PlacePhoto | 'pending' | null;

type ReadyMedia = Extract<PlaceMedia, { status: 'ready' }>;

// One place's answer through `pick`. A ready answer shows. A pending lookup shows as pending
// while the app is still polling, and nothing once the polls run out. With no answer yet, it's
// pending while the request loads.
function placeEntry<T>(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
  pick: (entry: ReadyMedia) => T,
): T | 'pending' | null {
  const entry = media?.places[placeId];

  if (entry?.status === 'ready') {
    return pick(entry);
  }

  if (entry?.status === 'pending') {
    return mediaPollInterval(media, query.answers) === false ? null : 'pending';
  }

  return query.loading ? 'pending' : null;
}

/**
 * What the stop sheet's About shows for one place: its introduction, `'pending'` while the
 * answer loads or the lookup runs and the app is still polling, or null (no article, a failed
 * lookup, a failed request, or polls that ran out).
 */
export function placeAbout(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
): PlaceAbout | 'pending' | null {
  return placeEntry(media, placeId, query, (entry) => entry.about);
}

/** One place's photo slot, by the same rules as `placeAbout`. */
export function placePhoto(
  media: IntentMedia | undefined,
  placeId: string,
  query: MediaQueryState,
): PhotoState {
  return placeEntry(media, placeId, query, (entry) => entry.photo);
}

/** Every place's photo slot by id, for the workspace's sections and the stop sheet. */
export function placePhotos(
  media: IntentMedia | undefined,
  placeIds: readonly string[],
  query: MediaQueryState,
): Record<string, PhotoState> {
  return Object.fromEntries(placeIds.map((id) => [id, placePhoto(media, id, query)]));
}
