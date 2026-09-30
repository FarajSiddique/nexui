import { idSchema, runRecordSchema } from '@nexui/types';

import { graphErrorResponse } from '../../../../lib/graph/respond.ts';
import { corsHeaders, jsonError, preflight } from '../../../../lib/http/responses.ts';
import { getRun } from '../../../../lib/runs/store.ts';
import { getUserClient } from '../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

interface RunRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/** One of the user's runs, with its progress so far. */
export async function GET(request: Request, { params }: RunRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const run = await getRun(getUserClient(user.accessToken), id);

    return Response.json(runRecordSchema.parse(run), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[runs]', 'Could not load that run', headers);
  }
}
