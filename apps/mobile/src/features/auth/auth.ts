import { supabase } from '#data';

import { getAppleCredential } from './apple-sign-in';
import { createAuthActions } from './auth-actions';
import { forgetGoogleAccount, getGoogleIdToken } from './google-sign-in';

export const {
  sendEmailCode,
  verifyEmailCode,
  signInWithGoogle,
  signInWithApple,
  getAppleDeletionCode,
  signOut,
  clearDeletedAccount,
} = createAuthActions(
  supabase.auth,
  { getIdToken: getGoogleIdToken, signOut: forgetGoogleAccount },
  { getCredential: getAppleCredential },
);
