import { deleteAccountRequestSchema, deleteAccountResponseSchema } from '@nexui/types';

import { deleteAccount } from '#lib/account';
import { corsHeaders, jsonError, preflight } from '#lib/http';
import { SupabaseConfigurationError, verifyRequest } from '#lib/supabase';

const headers = corsHeaders(['DELETE'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Permanently deletes the signed-in user's account (required by App Store rules). An Apple user
// on iOS sends Apple's authorization code so Nexui's Apple access is revoked too.
export async function DELETE(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = deleteAccountRequestSchema.safeParse(body);

  if (!parsed.success) {
    return jsonError('Invalid request.', 400, headers);
  }

  try {
    const result = await deleteAccount(user.userId, parsed.data.appleAuthorizationCode);

    return Response.json(deleteAccountResponseSchema.parse(result), { headers });
  } catch (error) {
    console.error(
      '[account]',
      error instanceof SupabaseConfigurationError ? error.message : 'Account deletion failed.',
    );

    return jsonError('Could not delete your account. Try again later.', 500, headers);
  }
}
