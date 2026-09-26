import { tasksResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getOpenTasks } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * The user's open tasks for the Tasks tab, due first and no date last. Prototype limit: at
 * most 300 tasks in one response, with no cursor.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const items = await getOpenTasks(getUserClient(user.accessToken));

    return Response.json(tasksResponseSchema.parse({ items }), { headers });
  } catch (error) {
    console.error(
      '[tasks]',
      error instanceof SupabaseConfigurationError ? error.message : 'Loading tasks failed.',
    );

    return jsonError('Could not load your tasks. Try again.', 500, headers);
  }
}
