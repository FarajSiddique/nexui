import { z } from 'zod';

import type { PlaceData } from './kinds/travel.ts';
import { idSchema } from './primitives.ts';

/** Every place photo lives under this path in our Supabase Storage (spec section 4). */
export const PLACE_PHOTO_PATH = '/storage/v1/object/public/place-photos/';

/**
 * A place name as the media cache compares it: case and accents dropped, and each run of
 * punctuation or whitespace turned into one space, so a key is safe in a PostgREST filter.
 *
 * @example
 * normalizePlaceName('  Český   Krumlov ') // 'cesky krumlov'
 * normalizePlaceName('Washington, D.C.') // 'washington d c'
 */
export function normalizePlaceName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .slice(0, 150)
    .trim();
}

/**
 * A coordinate rounded to 0.1° (about 11 km), as the media key holds it. Adding 0 turns -0
 * into 0.
 *
 * @example roundCoordinate(48.8127) // 48.8
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10 + 0;
}

/**
 * The media cache key for a place: its normalized name, country and coordinates rounded to
 * 0.1°, so the same place in any plan shares one Wikipedia lookup.
 *
 * @example
 * placeMediaKey({ name: 'Český Krumlov', country: 'CZ', lat: 48.8127, lng: 14.3175 });
 * // 'cesky krumlov|CZ|48.8|14.3'
 */
export function placeMediaKey(place: Pick<PlaceData, 'name' | 'country' | 'lat' | 'lng'>): string {
  return [
    normalizePlaceName(place.name),
    place.country,
    roundCoordinate(place.lat).toFixed(1),
    roundCoordinate(place.lng).toFixed(1),
  ].join('|');
}

// The URL arrives normalized, so `..` and `%2e%2e` segments are already resolved.
function isPlacePhotoUrl(url: string): boolean {
  return url.replace(/^https:\/\/[^/?#]+/, '').startsWith(PLACE_PHOTO_PATH);
}

/** A URL in our `place-photos` bucket. Nothing else may appear as a photo. */
export const storageUrlSchema = z
  .url({ protocol: /^https$/, normalize: true })
  .max(2000)
  .refine(isPlacePhotoUrl, 'Not a place photo URL.');

/** The Wikipedia introduction the stop sheet shows under "About". */
export const aboutSchema = z.strictObject({
  title: z.string().max(200),
  extract: z.string().max(600),
  // The article, which "Read more on Wikipedia" opens.
  url: z.url({ protocol: /^https$/, hostname: /^en\.wikipedia\.org$/ }),
});

/** Who made a photo and under which licence, shown under it in the stop sheet. */
export const photoCreditSchema = z.strictObject({
  author: z.string().max(120),
  license: z.string().max(60),
  licenseUrl: z.url({ protocol: /^https?$/ }).optional(),
  // The file's page on Commons.
  sourceUrl: z.url({ protocol: /^https$/, hostname: /^commons\.wikimedia\.org$/ }),
});

export const photoSchema = z.strictObject({
  url: storageUrlSchema, // 960px
  thumbUrl: storageUrlSchema, // 500px
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  credit: photoCreditSchema,
});

/** One place's media: `pending` while its lookup hasn't finished. */
export const placeMediaSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    about: aboutSchema.nullable(),
    photo: photoSchema.nullable(),
  }),
  z.strictObject({ status: z.literal('pending') }),
]);

// GET /api/intents/:id/media: every place in the plan by id, decision candidates included.
export const intentMediaSchema = z.strictObject({
  places: z.record(idSchema, placeMediaSchema),
});

export type PlaceAbout = z.infer<typeof aboutSchema>;
export type PlacePhoto = z.infer<typeof photoSchema>;
export type PhotoCredit = z.infer<typeof photoCreditSchema>;
export type PlaceMedia = z.infer<typeof placeMediaSchema>;
export type IntentMedia = z.infer<typeof intentMediaSchema>;
