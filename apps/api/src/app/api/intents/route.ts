import {
  createIntentRequestSchema,
  createIntentResponseSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { sessionOpener } from '../../../lib/ai/session.ts';
import { graphErrorResponse } from '../../../lib/graph/respond.ts';
import { listIntents } from '../../../lib/graph/lists.ts';
import { readJsonBody } from '../../../lib/http/json-body.ts';
import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { startIntent } from '../../../lib/orchestrator/orchestrate.ts';
import { getUserClient } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

// The run that fills in a new trip continues in `after()` once the response is sent.
export const maxDuration = 300;

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

/**
 * Starts a plan from a goal (spec section F): Jev picks the template, the trip and workspace are
 * seeded at once, and a run fills them in after the response. Answers `{ snapshot, runId }`.
 */
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
    const started = await startIntent(
      { db: getUserClient(user.accessToken), openSession: sessionOpener() },
      parsed.data.goal,
    );

    return Response.json(createIntentResponseSchema.parse(started), { status: 201, headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
}
