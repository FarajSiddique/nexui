import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Sign-in by emailed one-time code. Supabase sends 6 digits (Auth → Emails → OTP length).
export const emailCodeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type EmailCodeRequest = z.infer<typeof emailCodeRequestSchema>;

export const emailCodeVerificationSchema = emailCodeRequestSchema.extend({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export type EmailCodeVerification = z.infer<typeof emailCodeVerificationSchema>;

// Error body for 401, 503 and other failed API responses.
export const authErrorSchema = z.object({
  error: z.string(),
});

export type AuthError = z.infer<typeof authErrorSchema>;

// DELETE /api/account. An Apple user on iOS confirms with Apple first, and the API uses that
// code to revoke Nexui's Apple access once the account is deleted.
export const deleteAccountRequestSchema = z.object({
  appleAuthorizationCode: z.string().min(1).max(1024).optional(),
});

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

// True when the account signed in with Apple and Nexui couldn't revoke that access, so the user
// removes Nexui under Sign in with Apple themselves.
export const deleteAccountResponseSchema = z.object({
  appleAccessRemains: z.boolean(),
});

export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;
