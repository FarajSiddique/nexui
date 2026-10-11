import { verifyRequest, type AuthUser } from '#lib/supabase';

/**
 * A route handler that runs only for a signed-in user (readiness doc, section 3.10). It
 * verifies the request and hands the handler the user, or answers the 401 or 503 itself. The
 * handler keeps its own `try` and error mapping, in the order `apps/api/AGENTS.md` sets.
 *
 * @example
 * export const POST = withUser(headers, async (request, user, context: IntentRouteContext) => {
 *   …
 * });
 */
export function withUser<C>(
  headers: HeadersInit,
  handler: (request: Request, user: AuthUser, context: C) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    const user = await verifyRequest(request, headers);

    if (user instanceof Response) {
      return user;
    }

    return handler(request, user, context);
  };
}
