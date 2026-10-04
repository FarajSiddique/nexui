import { supabase } from '@/data/supabase';

import { createAuthActions } from './auth-actions';
import { forgetGoogleAccount, getGoogleIdToken } from './google-sign-in';

export { AuthActionError } from './auth-actions';

export const { sendEmailCode, verifyEmailCode, signInWithGoogle, signOut, clearDeletedAccount } =
  createAuthActions(supabase.auth, {
    getIdToken: getGoogleIdToken,
    signOut: forgetGoogleAccount,
  });
