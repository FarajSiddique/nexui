import { idSchema, runRecordSchema } from '@nexui/types';

import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { cancelRun } from '../../../../../lib/runs/store.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization']);

interface CancelRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Stops a run after its current step (spec section F). What it already committed stays and can be
 * undone from Changes. Takes no body.
 */
export async function POST(request: Request, { params }: CancelRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const run = await cancelRun(getUserClient(user.accessToken), id);

    return Response.json(runRecordSchema.parse(run), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[runs]', 'Could not stop that run', headers);
  }
}
