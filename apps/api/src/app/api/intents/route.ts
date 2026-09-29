import {
  createIntentRequestSchema,
  graphSnapshotSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { createIntent } from '../../../lib/graph/commit.ts';
import { graphErrorResponse } from '../../../lib/graph/respond.ts';
import { listIntents } from '../../../lib/graph/lists.ts';
import { readJsonBody } from '../../../lib/http/json-body.ts';
import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getUserClient } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Home's cards. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const items = await listIntents(getUserClient(user.accessToken));

    return Response.json(intentListResponseSchema.parse({ items }), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not load your plans', headers);
  }
}

/** Starts a plan from a goal: the travel template's trip, workspace and derived state. */
export async function POST(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const read = await readJsonBody(request, headers);

  if (read instanceof Response) {
    return read;
  }

  const parsed = createIntentRequestSchema.safeParse(read.body);

  if (!parsed.success) {
    return jsonError('Describe what you are planning in 3 to 500 characters.', 400, headers);
  }

  try {
    const snapshot = await createIntent(getUserClient(user.accessToken), parsed.data.goal);

    return Response.json(graphSnapshotSchema.parse(snapshot), { status: 201, headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
}
