import { createClient, type FlagsClient } from '@vercel/flags-core';

/** Answers whether a boolean feature flag is on. */
export type FlagReader = (key: string) => Promise<boolean>;

type FlagSource = Pick<FlagsClient, 'evaluate'>;

let client: FlagsClient | null = null;
let replacement: FlagReader | null = null;

/**
 * Reads a boolean flag from Vercel Flags, as configured for the environment the API runs in
 * (Production, Preview or Development). Evaluate it inside a request handler: on Vercel the
 * client authenticates with the request's OIDC token. A flag Vercel can't read stays off.
 *
 * @example
 * await readFlag('job-search'); // true where the dashboard serves it on
 */
export async function readFlag(key: string): Promise<boolean> {
  if (replacement) {
    return replacement(key);
  }

  client ??= createClient();

  return readFrom(client, key);
}

/**
 * A flag from a Vercel Flags client: on only when it evaluates to `true`. A missing, archived or
 * unreadable flag is off, and the log names the flag but never the client's error.
 */
export async function readFrom(source: FlagSource, key: string): Promise<boolean> {
  try {
    const result = await source.evaluate<boolean>(key, false);

    if (result.reason === 'error') {
      console.error('[flags]', `Could not read the ${key} flag; it stays off.`);

      return false;
    }

    return result.value === true;
  } catch {
    console.error('[flags]', `Could not read the ${key} flag; it stays off.`);

    return false;
  }
}

/** For tests and scripts: answer flags without Vercel, or `null` to read Vercel again. */
export function setFlagReader(reader: FlagReader | null): void {
  replacement = reader;
}
