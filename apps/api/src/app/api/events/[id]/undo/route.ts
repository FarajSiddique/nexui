import { commitResponseSchema, idSchema } from '@nexui/types';

import { revertEvent, graphErrorResponse } from '#lib/graph';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import { getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['POST'], ['Authorization']);

interface UndoRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Undo a changeset. Redo is this same call on the Undo's own event. */
export async function POST(request: Request, { params }: UndoRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const result = await revertEvent(getUserClient(user.accessToken), id);

    return Response.json(commitResponseSchema.parse(result), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[undo]', 'Could not undo', headers);
  }
}
