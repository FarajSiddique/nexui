import { AiConfigurationError } from '../ai/config.ts';
import { jsonError } from '../http/responses.ts';
import { SupabaseConfigurationError } from '../supabase/clients.ts';
import { ChangesetConflictError, ChangesetInvalidError, GraphNotFoundError } from './errors.ts';

// Only a short code such as a SQLSTATE or `PGRST202` is logged, never an error's message.
function errorCode(error: unknown): string | null {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;

  return typeof code === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(code) ? code : null;
}

/** The log line for an error: a configuration error's message, or `fallback` and a short code. */
export function logLine(error: unknown, fallback: string): string {
  if (error instanceof SupabaseConfigurationError || error instanceof AiConfigurationError) {
    return error.message;
  }

  const code = errorCode(error);

  return code ? `${fallback} (${code}).` : `${fallback}.`;
}

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

  console.error(tag, logLine(error, fallback));

  return jsonError(`${fallback}. Try again.`, 500, headers);
}
