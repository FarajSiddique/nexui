import { jsonError } from '../http/responses.ts';
import { SupabaseConfigurationError } from '../supabase/clients.ts';
import { ChangesetConflictError, ChangesetInvalidError, GraphNotFoundError } from './errors.ts';

/**
 * The response for an error from the graph code: 404, 400 or 409 with the error's user-safe
 * message, or a logged 500 with `fallback` for anything else.
 *
 * @example
 * return graphErrorResponse(error, '[changes]', 'Could not load changes', headers);
 */
export function graphErrorResponse(
  error: unknown,
  tag: string,
  fallback: string,
  headers: HeadersInit,
): Response {
  if (error instanceof GraphNotFoundError) {
    return jsonError('Not found.', 404, headers);
  }

  if (error instanceof ChangesetInvalidError) {
    return jsonError(error.message, 400, headers);
  }

  if (error instanceof ChangesetConflictError) {
    return jsonError(error.message, 409, headers);
  }

  console.error(
    tag,
    error instanceof SupabaseConfigurationError ? error.message : `${fallback} failed.`,
  );

  return jsonError(`${fallback}. Try again.`, 500, headers);
}
