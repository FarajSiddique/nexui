import { UnauthorizedError } from './authenticated-fetch.ts';

/** A failed API call. `message` is safe to show; `status` is 0 when the server wasn't reached. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Anything with a Zod-style `parse`, such as `graphSnapshotSchema`. */
export interface Parser<T> {
  parse(value: unknown): T;
}

export type Send = (url: string, init: RequestInit) => Promise<Response>;

export const UNREACHABLE_MESSAGE =
  "Nexui can't reach its server. Check your connection and try again.";

const SIGNED_OUT_MESSAGE = 'Sign in again to continue.';
const FAILED_MESSAGE = 'Something went wrong. Try again.';

function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body;

    return typeof error === 'string' && error.length > 0 ? error : null;
  }

  return null;
}

/**
 * Sends one API request and parses its answer. It gives up after `timeoutMs`. An error answer
 * becomes an `ApiError` carrying the server's message, and a caller's own abort passes through
 * so TanStack Query can tell a cancel from a failure.
 *
 * @example
 * await requestJson(send, `${apiUrl}/api/intents/${id}`, { signal }, graphSnapshotSchema);
 */
export async function requestJson<T>(
  send: Send,
  url: string,
  init: RequestInit,
  parser: Parser<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  const timer = setTimeout(cancel, timeoutMs);

  init.signal?.addEventListener('abort', cancel);

  if (init.signal?.aborted) {
    cancel();
  }

  try {
    let response: Response;

    try {
      response = await send(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new ApiError(SIGNED_OUT_MESSAGE, 401);
      }

      if (init.signal?.aborted) {
        throw error;
      }

      throw new ApiError(UNREACHABLE_MESSAGE, 0);
    }

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new ApiError(serverMessage(body) ?? FAILED_MESSAGE, response.status);
    }

    return parser.parse(body);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', cancel);
  }
}
