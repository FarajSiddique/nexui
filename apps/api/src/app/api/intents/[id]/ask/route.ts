import { askRequestSchema, askResponseSchema, idSchema } from '@nexui/types';

import { sessionOpener } from '../../../../../lib/ai/session.ts';
import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { readJsonBody } from '../../../../../lib/http/json-body.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { startAsk } from '../../../../../lib/orchestrator/orchestrate.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

// The run continues in `after()` once the 202 is sent.
export const maxDuration = 300;

interface AskRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Asks Nexui to change a plan (spec section F). Jev routes the request, and the run works after
 * the response; follow it with `GET /api/runs/[id]` or Realtime on `runs`.
 */
export async function POST(request: Request, { params }: AskRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  const read = await readJsonBody(request, headers);

  if (read instanceof Response) {
    return read;
  }

  const parsed = askRequestSchema.safeParse(read.body);

  if (!parsed.success) {
    return jsonError('Ask in 2 to 1000 characters.', 400, headers);
  }

  try {
    const started = await startAsk(
      { db: getUserClient(user.accessToken), openSession: sessionOpener() },
      id,
      parsed.data.text,
    );

    return Response.json(askResponseSchema.parse(started), { status: 202, headers });
  } catch (error) {
    return graphErrorResponse(error, '[ask]', 'Could not start that', headers);
  }
}
