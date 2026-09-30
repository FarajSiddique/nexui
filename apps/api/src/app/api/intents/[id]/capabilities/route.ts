import { capabilityRequestSchema, commitResponseSchema, idSchema } from '@nexui/types';

import { invokeCapability } from '../../../../../lib/capabilities/invoke.ts';
import { graphErrorResponse } from '../../../../../lib/graph/respond.ts';
import { readJsonBody } from '../../../../../lib/http/json-body.ts';
import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { getUserClient } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

interface CapabilityRouteContext {
  params: Promise<{ id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

/**
 * A button in the app, such as an insight's "Give it back to Tokyo" or picking a decision's
 * option. Runs one user-callable capability and answers like a changeset.
 */
export async function POST(
  request: Request,
  { params }: CapabilityRouteContext,
): Promise<Response> {
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

  const parsed = capabilityRequestSchema.safeParse(read.body);

  if (!parsed.success) {
    return jsonError('That action is not valid.', 400, headers);
  }

  try {
    const result = await invokeCapability(getUserClient(user.accessToken), id, parsed.data);

    return Response.json(commitResponseSchema.parse(result), { headers });
  } catch (error) {
    return graphErrorResponse(error, '[capabilities]', 'Could not do that', headers);
  }
}
