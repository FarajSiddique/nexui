import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { AuthActionError, type AppleCredential } from './auth-actions';

function isCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  );
}

function namePart(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Opens Apple's sign-in sheet, asking for the name and email. Cancellation returns null, not an
 * error. Apple sees the nonce's SHA-256 hash; Supabase gets the raw nonce and compares hashes.
 */
export async function getAppleCredential(): Promise<AppleCredential | null> {
  if (Platform.OS !== 'ios') {
    throw new AuthActionError('Apple sign-in needs the iOS app.');
  }

  try {
    const nonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      throw new AuthActionError('Apple did not return an ID token.');
    }

    return {
      idToken: credential.identityToken,
      nonce,
      givenName: namePart(credential.fullName?.givenName),
      familyName: namePart(credential.fullName?.familyName),
      authorizationCode: credential.authorizationCode,
    };
  } catch (error) {
    if (error instanceof AuthActionError) {
      throw error;
    }

    if (isCancelled(error)) {
      return null;
    }

    throw new AuthActionError('Apple sign-in failed. Try again.');
  }
}
