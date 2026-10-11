import {
  type CreateIntentResponse,
  createIntentRequestSchema,
  createIntentResponseSchema,
  intentListResponseSchema,
} from '@nexui/types';

import { sessionOpener } from '#lib/ai';
import { graphErrorResponse, listIntents } from '#lib/graph';
import { readJsonBody, corsHeaders, jsonError, preflight } from '#lib/http';
import { withHomePhotos } from '#lib/media';
import { startIntent } from '#lib/orchestrator';
import { PerceptionFailedError } from '#lib/perception';
import { runWorker } from '#lib/runs';
import { getAdminClient, getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['GET', 'POST'], ['Authorization', 'Content-Type']);

// Each outcome's status (job search spec, section 2). A new outcome must name its own.
const CREATE_STATUS: Record<CreateIntentResponse['outcome'], number> = {
  started: 201,
  unsupported: 201,
};

// The worker claims the run that fills in a new trip in `after()`, once the response is sent.
export const maxDuration = 300;

export function OPTIONS(): Response {
  return preflight(headers);
}

/** Home's cards, with their stops' cached photos. */
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  try {
    const listed = await listIntents(getUserClient(user.accessToken));
    // The user's own summaries name the keys; the secret-key client reads the shared cache.
    const items = await withHomePhotos(getAdminClient, listed);

    return Response.json(intentListResponseSchema.parse({ items }), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[intents]', 'Could not load your plans', headers);
  }
}

/**
 * Starts a plan from a goal (spec section F; job search spec, section 2). Jev picks the
 * template: a trip is seeded at once and a run fills it in after the response (`started`), and
 * a goal no template fits is saved with no plan (`unsupported`). If Jev can't read the goal, it
 * answers 503 and writes nothing.
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
      {
        db: getUserClient(user.accessToken),
        userId: user.userId,
        openSession: sessionOpener(),
        worker: runWorker(),
      },
      parsed.data.goal,
    );

    const body = createIntentResponseSchema.parse(started);

    return Response.json(body, { status: CREATE_STATUS[body.outcome], headers });
  } catch (error) {
    // Nexui doesn't guess a template; the + sheet keeps the goal so a retry is one tap.
    if (error instanceof PerceptionFailedError) {
      return jsonError(error.message, 503, headers);
    }

    return graphErrorResponse(error, '[intents]', 'Could not start that plan', headers);
  }
}
