import { changesQuerySchema, changesResponseSchema } from '@nexui/types';

import { graphErrorResponse, listChanges } from '#lib/graph';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import { getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

/** The Changes feed: every changeset and Undo, newest first. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const search = new URL(request.url).searchParams;
  const parsed = changesQuerySchema.safeParse({
    limit: search.get('limit') ?? undefined,
    cursor: search.get('cursor') ?? undefined,
    intentId: search.get('intentId') ?? undefined,
  });

  if (!parsed.success) {
    return jsonError('Invalid changes query.', 400, headers);
  }

  try {
    const page = await listChanges(getUserClient(user.accessToken), parsed.data);

    return Response.json(changesResponseSchema.parse(page), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[changes]', 'Could not load changes', headers);
  }
}
