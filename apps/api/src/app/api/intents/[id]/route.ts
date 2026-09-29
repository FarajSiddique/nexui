import { graphSnapshotSchema, idSchema } from '@nexui/types';

import { graphErrorResponse } from '../../../../lib/graph/respond.ts';
import { loadSnapshot } from '../../../../lib/graph/snapshot.ts';
import { corsHeaders, jsonError, preflight } from '../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

interface IntentRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/** One intent with its workspace, objects and relationships. */
export async function GET(request: Request, { params }: IntentRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const snapshot = await loadSnapshot(getUserClient(user.accessToken), id);

    return Response.json(graphSnapshotSchema.parse(snapshot), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intent]', 'Could not load that plan', headers);
  }
}
