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
