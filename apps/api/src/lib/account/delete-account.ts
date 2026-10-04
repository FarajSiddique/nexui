import { isAuthApiError } from '@supabase/supabase-js';

import type { DeleteAccountResponse } from '@nexui/types';

import { AppleConfigurationError, AppleRevocationError, revokeAppleAccess } from '#lib/apple';
import { getAdminClient } from '#lib/supabase';

type Env = Record<string, string | undefined>;

/**
 * Deletes a user, then revokes Nexui's Apple access when the account signed in with Apple.
 * Apple is only called once the account is gone (TN3194). `appleAccessRemains` tells the app to
 * show the user how to remove Nexui under Sign in with Apple themselves.
 *
 * A user who is already gone counts as deleted, so a retry after a lost answer succeeds.
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
    if (!isUserGone(lookupError)) {
      throw lookupError;
    }

    return finishRetry(appleAuthorizationCode, env);
  }

  const appleIdentity = data.user.identities?.find((identity) => identity.provider === 'apple');
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);

  if (deleteError && !isUserGone(deleteError)) {
    throw deleteError;
  }

  if (!appleIdentity) {
    return { appleAccessRemains: false };
  }

  // Web and Android can't confirm with Apple, so they send no code.
  if (!appleAuthorizationCode) {
    return { appleAccessRemains: true };
  }

  // A confirmation from another Apple ID is still revoked, since it was created just now, but
  // leaves the account's own grant in place.
  const appleUserId: unknown = appleIdentity.identity_data?.sub;
  const subject = await revokeGrant(appleAuthorizationCode, env);

  if (subject !== null && subject !== appleUserId) {
    console.error('[account]', 'Apple confirmed with a different Apple ID.');
  }

  return { appleAccessRemains: subject === null || subject !== appleUserId };
}

function isUserGone(error: unknown): boolean {
  return isAuthApiError(error) && (error.status === 404 || error.code === 'user_not_found');
}

/**
 * A retry whose earlier attempt deleted the user but lost the answer. Apple's sheet has just
 * created a new grant for this confirmation, so revoke it; without a code there's nothing left.
 */
async function finishRetry(
  appleAuthorizationCode: string | undefined,
  env: Env,
): Promise<DeleteAccountResponse> {
  if (!appleAuthorizationCode) {
    return { appleAccessRemains: false };
  }

  const subject = await revokeGrant(appleAuthorizationCode, env);

  return { appleAccessRemains: subject === null };
}

/** Revokes the grant behind `authorizationCode` and returns its Apple user ID, or null on failure. */
async function revokeGrant(authorizationCode: string, env: Env): Promise<string | null> {
  try {
    const { subject } = await revokeAppleAccess(authorizationCode, env);

    return subject;
  } catch (error) {
    const known = error instanceof AppleConfigurationError || error instanceof AppleRevocationError;

    console.error('[account]', known ? error.message : 'Apple access revocation failed.');

    return null;
  }
}
