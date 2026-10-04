import { graphSnapshotSchema, idSchema } from '@nexui/types';

import { deleteIntent } from '../../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../../lib/graph/respond.ts';
import { loadSnapshot } from '../../../../lib/graph/snapshot.ts';
import { corsHeaders, jsonError, preflight } from '../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET', 'DELETE'], ['Authorization']);

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

/** Deletes one of the caller's plans with everything under it. Refused while a run is working. */
export async function DELETE(request: Request, { params }: IntentRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    await deleteIntent(getUserClient(user.accessToken), id);

    return new Response(null, { status: 204, headers });
  } catch (error) {
    return graphErrorResponse(error, '[intent]', 'Could not delete that plan', headers);
  }
}
