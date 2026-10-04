import type { DeleteAccountResponse } from '@nexui/types';

import { AppleConfigurationError, AppleRevocationError, revokeAppleAccess } from '#lib/apple';
import { getAdminClient } from '#lib/supabase';

type Env = Record<string, string | undefined>;

/**
 * Deletes a user, then revokes Nexui's Apple access when the account signed in with Apple.
 * Apple is only called once the account is gone (TN3194). `appleAccessRemains` tells the app to
 * show the user how to remove Nexui under Sign in with Apple themselves.
 *
 * @example
 * const { appleAccessRemains } = await deleteAccount(user.userId, body.appleAuthorizationCode);
 */
export async function deleteAccount(
  userId: string,
  appleAuthorizationCode: string | undefined,
  env: Env = process.env,
): Promise<DeleteAccountResponse> {
  const admin = getAdminClient(env);
  const { data, error: lookupError } = await admin.auth.admin.getUserById(userId);

  if (lookupError) {
    throw lookupError;
  }

  const appleIdentity = data.user.identities?.find((identity) => identity.provider === 'apple');
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (deleteError) {
    throw deleteError;
  }

  if (!appleIdentity) {
    return { appleAccessRemains: false };
  }

  // Web and Android can't confirm with Apple, so they send no code.
  if (!appleAuthorizationCode) {
    return { appleAccessRemains: true };
  }

  const appleUserId: unknown = appleIdentity.identity_data?.sub;
  const revoked = await revokeOwnGrant(appleUserId, appleAuthorizationCode, env);

  return { appleAccessRemains: !revoked };
}

/**
 * True when Apple revoked a grant for the account's own Apple ID. A confirmation from another
 * Apple ID is still revoked, since it was created just now, but leaves the account's grant.
 */
async function revokeOwnGrant(
  appleUserId: unknown,
  authorizationCode: string,
  env: Env,
): Promise<boolean> {
  try {
    const { subject } = await revokeAppleAccess(authorizationCode, env);

    if (subject !== appleUserId) {
      console.error('[account]', 'Apple confirmed with a different Apple ID.');

      return false;
    }

    return true;
  } catch (error) {
    const known = error instanceof AppleConfigurationError || error instanceof AppleRevocationError;

    console.error('[account]', known ? error.message : 'Apple access revocation failed.');

    return false;
  }
}
