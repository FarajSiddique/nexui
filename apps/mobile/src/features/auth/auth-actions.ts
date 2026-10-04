import { isAuthApiError, type SupabaseClient } from '@supabase/supabase-js';

import { emailCodeRequestSchema, emailCodeVerificationSchema } from '@nexui/types';

type AuthClient = Pick<
  SupabaseClient['auth'],
  'signInWithOtp' | 'verifyOtp' | 'signInWithIdToken' | 'signOut' | 'updateUser'
>;

export interface GoogleAuth {
  getIdToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

/** What Apple's sheet returns. `nonce` is the raw nonce; the sheet was given its SHA-256 hash. */
export interface AppleCredential {
  idToken: string;
  nonce: string;
  givenName: string | null;
  familyName: string | null;
  authorizationCode: string | null;
}

export interface AppleAuth {
  getCredential(): Promise<AppleCredential | null>;
}

export interface AuthActions {
  sendEmailCode(email: string): Promise<string>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  signInWithGoogle(): Promise<boolean>;
  signInWithApple(): Promise<boolean>;
  getAppleDeletionCode(): Promise<string | null | undefined>;
  signOut(): Promise<void>;
  clearDeletedAccount(): Promise<void>;
}

// Marks messages safe to display to the user.
export class AuthActionError extends Error {}

function authMessage(error: unknown, fallback: string): string {
  if (isAuthApiError(error)) {
    if (error.status === 429) {
      return 'Too many attempts. Wait a minute, then try again.';
    }

    if (error.code === 'otp_expired') {
      return 'That code is wrong or has expired.';
    }
  }

  return fallback;
}

/**
 * Apple's name parts as user metadata, or null when Apple sent none (it only sends a name on the
 * first authorization).
 *
 * @example
 * appleNameMetadata('Ada', null) // { full_name: 'Ada', given_name: 'Ada' }
 */
function appleNameMetadata(
  givenName: string | null,
  familyName: string | null,
): Record<string, string> | null {
  const given = givenName?.trim() ?? '';
  const family = familyName?.trim() ?? '';
  const fullName = [given, family].filter(Boolean).join(' ');

  if (!fullName) {
    return null;
  }

  const data: Record<string, string> = { full_name: fullName };

  if (given) {
    data.given_name = given;
  }

  if (family) {
    data.family_name = family;
  }

  return data;
}

/** Binds auth operations to Supabase and the native Google and Apple adapters. */
export function createAuthActions(
  auth: AuthClient,
  google: GoogleAuth,
  apple: AppleAuth,
): AuthActions {
  async function sendEmailCode(email: string): Promise<string> {
    const parsed = emailCodeRequestSchema.safeParse({ email });

    if (!parsed.success) {
      throw new AuthActionError('Enter a valid email address.');
    }

    const { error } = await auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: true },
    });

    if (error) {
      throw new AuthActionError(authMessage(error, 'Could not send a code. Try again.'));
    }

    return parsed.data.email;
  }

  async function verifyEmailCode(email: string, token: string): Promise<void> {
    const parsed = emailCodeVerificationSchema.safeParse({ email, token });

    if (!parsed.success) {
      throw new AuthActionError('Enter the 6-digit code.');
    }

    const { error } = await auth.verifyOtp({ ...parsed.data, type: 'email' });

    if (error) {
      throw new AuthActionError(authMessage(error, 'Could not verify the code. Try again.'));
    }
  }

  /** Returns false when the native sheet was cancelled or is already open. */
  async function signInWithGoogle(): Promise<boolean> {
    const idToken = await google.getIdToken();

    if (idToken === null) {
      return false;
    }

    try {
      const { error } = await auth.signInWithIdToken({ provider: 'google', token: idToken });

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      throw new AuthActionError(authMessage(error, 'Google sign-in failed. Try again.'));
    }
  }

  /** Returns false when Apple's sheet was cancelled. Saves the name best-effort. */
  async function signInWithApple(): Promise<boolean> {
    const credential = await apple.getCredential();

    if (credential === null) {
      return false;
    }

    try {
      const { error } = await auth.signInWithIdToken({
        provider: 'apple',
        token: credential.idToken,
        nonce: credential.nonce,
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      throw new AuthActionError(authMessage(error, 'Apple sign-in failed. Try again.'));
    }

    await saveAppleName(credential);

    return true;
  }

  // The name is a nicety and sign-in has already succeeded, so a failure here is ignored.
  async function saveAppleName({ givenName, familyName }: AppleCredential): Promise<void> {
    const data = appleNameMetadata(givenName, familyName);

    if (data === null) {
      return;
    }

    try {
      await auth.updateUser({ data });
    } catch {
      // Best-effort, like a returned error.
    }
  }

  /**
   * Asks Apple to confirm an Apple account's deletion. Returns Apple's code, `null` when the sheet
   * was cancelled (keep the account), or `undefined` when Apple couldn't confirm: deletion then
   * goes ahead without a code, and the app shows how to remove Nexui under Sign in with Apple.
   */
  async function getAppleDeletionCode(): Promise<string | null | undefined> {
    let credential: AppleCredential | null;

    try {
      credential = await apple.getCredential();
    } catch {
      return undefined;
    }

    if (credential === null) {
      return null;
    }

    return credential.authorizationCode ?? undefined;
  }

  /** Tries local scope after a failed sign-out; offline refresh can still make both fail. */
  async function signOut(): Promise<void> {
    await google.signOut();
    const { error } = await auth.signOut();

    if (error) {
      const { error: localError } = await auth.signOut({ scope: 'local' });

      if (localError) {
        throw new AuthActionError('Could not sign out. Try again.');
      }
    }
  }

  /** Clears the remaining session after the API has deleted the account. */
  async function clearDeletedAccount(): Promise<void> {
    await google.signOut();
    const { error } = await auth.signOut({ scope: 'local' });

    if (error) {
      throw new AuthActionError('Could not clear your session. Try again.');
    }
  }

  return {
    sendEmailCode,
    verifyEmailCode,
    signInWithGoogle,
    signInWithApple,
    getAppleDeletionCode,
    signOut,
    clearDeletedAccount,
  };
}
