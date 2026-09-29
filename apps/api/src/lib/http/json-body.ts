import { jsonError } from './responses.ts';

/** The largest request body the graph write routes accept, in characters. */
export const MAX_JSON_BODY_LENGTH = 65_536;

/**
 * Reads a JSON request body of at most `limit` characters. Returns `{ body }`, or the response
 * to send: 413 when it's too large, 400 `Invalid JSON` when it doesn't parse.
 *
 * @example
 * const read = await readJsonBody(request, headers);
 *
 * if (read instanceof Response) {
 *   return read;
 * }
 */
export async function readJsonBody(
  request: Request,
  headers: HeadersInit,
  limit: number = MAX_JSON_BODY_LENGTH,
): Promise<{ body: unknown } | Response> {
  try {
    const text = await request.text();

    if (text.length > limit) {
      return jsonError('That change is too large.', 413, headers);
    }

    return { body: JSON.parse(text) as unknown };
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }
}
