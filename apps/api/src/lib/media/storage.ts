import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { PHOTO_TYPES, type PhotoSource, type StoredPhoto } from './rules.ts';
import { downloadImage, type ImageFile } from './wikipedia.ts';

/** The public bucket every place photo is copied into (spec section 3). */
export const PHOTO_BUCKET = 'place-photos';

const ONE_YEAR_SECONDS = '31536000';

/** Storage refused an upload. `message` holds only the HTTP status, for the log. */
export class PhotoStorageError extends Error {
  constructor(status: number | undefined) {
    super(`Could not store a photo${status === undefined ? '' : ` (${status})`}.`);
  }
}

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/**
 * Where one size of a photo lives (spec section 2). The path names its content, so a refresh
 * writes new files and old URLs stay valid.
 *
 * @example
 * photoPath('berlin|DE|52.5|13.4', image, 960) // '<16 hex of the key>/<12 hex of the bytes>-960.jpg'
 */
export function photoPath(key: string, image: ImageFile, width: 960 | 500): string {
  return `${sha256(key).slice(0, 16)}/${sha256(image.bytes).slice(0, 12)}-${width}.${image.type}`;
}

async function upload(db: SupabaseClient, path: string, image: ImageFile): Promise<void> {
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, image.bytes, {
    contentType: PHOTO_TYPES[image.type],
    cacheControl: ONE_YEAR_SECONDS,
    upsert: true,
  });

  if (error) {
    throw new PhotoStorageError(error.status);
  }
}

/**
 * Copies a photo's two sizes into our bucket and returns where they are. Null when either
 * download isn't an image we accept. A failed download or upload throws, so the lookup is
 * cached `failed` and tried again, and a photo URL never points at a missing file.
 */
export async function copyPhoto(
  db: SupabaseClient,
  contact: string,
  key: string,
  source: PhotoSource,
): Promise<StoredPhoto | null> {
  const [large, small] = await Promise.all([
    downloadImage(source.url, contact),
    downloadImage(source.thumbUrl, contact),
  ]);

  if (!large || !small) {
    return null;
  }

  const path = photoPath(key, large, 960);
  const thumbPath = photoPath(key, small, 500);

  await Promise.all([upload(db, path, large), upload(db, thumbPath, small)]);

  return { path, thumbPath, width: source.width, height: source.height };
}

/** A stored photo's public URL, served through Supabase's CDN. */
export function publicPhotoUrl(db: SupabaseClient, path: string): string {
  return db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
