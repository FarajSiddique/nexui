import { supabase } from '#data';

import { createAuthActions } from './auth-actions';
import { forgetGoogleAccount, getGoogleIdToken } from './google-sign-in';

export const { sendEmailCode, verifyEmailCode, signInWithGoogle, signOut, clearDeletedAccount } =
  createAuthActions(supabase.auth, {
    getIdToken: getGoogleIdToken,
    signOut: forgetGoogleAccount,
  });
