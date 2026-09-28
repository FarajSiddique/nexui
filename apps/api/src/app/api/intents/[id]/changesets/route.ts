import { changesetRequestSchema, commitResponseSchema, fromUserOps, idSchema } from '@nexui/types';

import { commitChangeset } from '../../../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

interface ChangesetRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * The user's direct edits (for example a place's days). Derived changes ride in the same
 * changeset; the response carries the logged event and the updated intent.
 */
export async function POST(request: Request, { params }: ChangesetRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = changesetRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError('That change is not valid.', 400, headers);
  }

  try {
    const result = await commitChangeset(getUserClient(user.accessToken), {
      intentId: id,
      actor: 'user',
      ops: fromUserOps(parsed.data.ops),
    });

    return Response.json(commitResponseSchema.parse(result), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[changesets]', 'Could not save that change', headers);
  }
}
