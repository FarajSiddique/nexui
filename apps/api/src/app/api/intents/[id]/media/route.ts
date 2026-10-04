import { idSchema, intentMediaSchema } from '@nexui/types';

import { graphErrorResponse, loadSnapshot } from '#lib/graph';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import {
  MediaConfigurationError,
  mediaPlaces,
  readMediaConfig,
  resolvePlaceMedia,
  scheduleMediaTask,
} from '#lib/media';
import { getAdminClient, getUserClient, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['GET'], ['Authorization']);

// Lookups that outlast the 6-second budget finish in `after()`.
export const maxDuration = 30;

interface MediaRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * Wikipedia details for every place in one of the caller's plans (spec section 4). Loading the
 * plan as the user is the ownership check; only then does the secret-key client read the shared
 * cache and look up what's missing.
 */
export async function GET(request: Request, { params }: MediaRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    return jsonError('Not found.', 404, headers);
  }

  try {
    const { contact } = readMediaConfig();
    const snapshot = await loadSnapshot(getUserClient(user.accessToken), id);
    const places = await resolvePlaceMedia(
      { db: getAdminClient(), contact, defer: scheduleMediaTask },
      mediaPlaces(snapshot),
    );

    return Response.json(intentMediaSchema.parse({ places }), { headers });
  } catch (error) {
    if (error instanceof MediaConfigurationError) {
      console.error('[media]', error.message);

      return jsonError('Could not load place details. Try again.', 500, headers);
    }

    return graphErrorResponse(error, '[media]', 'Could not load place details', headers);
  }
}
