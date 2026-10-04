import { createHash, timingSafeEqual } from 'node:crypto';

import { jsonError } from './responses.ts';

type Env = Record<string, string | undefined>;

// Hashing first gives both sides one length, so the compare never leaks the secret's length.
const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** A shorter secret counts as unset, so a guessable one never protects the sweep. */
const MIN_SECRET_LENGTH = 32;

/**
 * Checks that a request comes from Vercel Cron, which sends `Authorization: Bearer
 * <CRON_SECRET>`. Returns null when it does, or a ready-to-send 401, or 503 when the secret
 * isn't configured (or is under 32 characters).
 */
export function verifyCronRequest(
  request: Request,
  headers: HeadersInit = {},
  env: Env = process.env,
): Response | null {
  const secret = env.CRON_SECRET?.trim();

  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error('[cron]', 'CRON_SECRET (32 characters or more) is required for scheduled jobs.');

    return jsonError('Scheduled jobs are not configured.', 503, headers);
  }

  const sent = request.headers.get('authorization')?.trim() ?? '';

  if (!timingSafeEqual(digest(sent), digest(`Bearer ${secret}`))) {
    return jsonError('Not allowed.', 401, headers);
  }

  return null;
}
