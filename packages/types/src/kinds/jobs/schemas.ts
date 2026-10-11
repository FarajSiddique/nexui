import { z } from 'zod';

import { timestampSchema } from '../../primitives.ts';
import { currencySchema, moneySchema } from '../money.ts';

// Job search's kinds (job search spec, section 3.1). As in travel, a data field ending in `Id`
// holds a graph object id, which models see as a ref, so a board's own id for a role is `job`.

const text = (max: number): z.ZodString => z.string().trim().min(1).max(max);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2000);

export const workModeSchema = z.enum(['remote', 'hybrid', 'onsite']);

/** Work modes in the order the search sheet offers them. */
export const WORK_MODES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
] as const satisfies readonly { value: z.infer<typeof workModeSchema>; label: string }[];

export const boardProviderSchema = z.enum(['greenhouse', 'lever', 'ashby']);

/**
 * A company's public job board. `region: 'eu'` is Lever's EU host (`api.eu.lever.co`, spikes note
 * 2.2); Greenhouse serves EU boards from its one API host, and Ashby has one.
 */
export const boardSchema = z.strictObject({
  provider: boardProviderSchema,
  token: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/),
  region: z.literal('eu').optional(),
});

/** Where a role was found: its board, and the board's own id for the role. */
export const jobSourceSchema = boardSchema.extend({
  job: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
});

export const stageSchema = z.enum([
  'new',
  'interested',
  'applied',
  'interviewing',
  'offer',
  'closed',
]);

/** A role's stages in pipeline order. A stage records a fact about the role; nothing is ticked. */
export const STAGES = [
  { value: 'new', label: 'New' },
  { value: 'interested', label: 'Interested' },
  { value: 'applied', label: 'Applied' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'closed', label: 'Closed' },
] as const satisfies readonly { value: z.infer<typeof stageSchema>; label: string }[];

export const outcomeSchema = z.enum([
  'passed',
  'rejected',
  'withdrew',
  'no_reply',
  'posting_closed',
  'declined',
  'accepted',
]);

/** How each outcome reads after "Closed": "Closed Staff PM (no reply)". */
export const OUTCOME_LABELS: Record<z.infer<typeof outcomeSchema>, string> = {
  passed: 'passed',
  rejected: 'rejected',
  withdrew: 'withdrew',
  no_reply: 'no reply',
  posting_closed: 'posting closed',
  declined: 'declined',
  accepted: 'accepted',
};

export const passReasonSchema = z.enum([
  'too_junior',
  'too_senior',
  'wrong_location',
  'not_this_company',
  'pay_too_low',
  'not_the_work',
]);

/** Why the user passed on a role, in the order the pipeline's reason picker offers them. */
export const PASS_REASONS = [
  { value: 'too_junior', label: 'Too junior' },
  { value: 'too_senior', label: 'Too senior' },
  { value: 'wrong_location', label: 'Wrong location' },
  { value: 'not_this_company', label: 'Not this company' },
  { value: 'pay_too_low', label: 'Pay too low' },
  { value: 'not_the_work', label: 'Not the work I want' },
] as const satisfies readonly { value: z.infer<typeof passReasonSchema>; label: string }[];

export const salarySchema = z
  .strictObject({
    min: z.number().min(0).max(1_000_000_000).optional(),
    max: z.number().min(0).max(1_000_000_000).optional(),
    currency: currencySchema,
  })
  .refine((pay) => pay.min === undefined || pay.max === undefined || pay.min <= pay.max, {
    message: 'The minimum must not be above the maximum',
    path: ['max'],
  });

/** Why a role fits, from the scan's explain call: 1–3 reasons and at most 2 gaps. */
export const fitSchema = z.strictObject({
  score: z.number().min(0).max(1),
  reasons: z.array(text(200)).min(1).max(3),
  gaps: z.array(text(200)).max(2),
});

/** The criteria a decision's option sets when the user picks it (`JOB_DECISIONS`). */
export const searchCriteriaSchema = z.strictObject({
  roles: z.array(text(80)).min(1).max(5).optional(),
  locations: z.array(text(80)).max(5).optional(),
  workModes: z.array(workModeSchema).min(1).max(3).optional(),
  salaryFloor: moneySchema.optional(),
});

/** The search's figures, written only by `derive.jobSearch`. */
export const searchDerivedSchema = z.strictObject({
  new: z.number().int().min(0),
  inPlay: z.number().int().min(0),
  applied: z.number().int().min(0),
  interviewing: z.number().int().min(0),
  offers: z.number().int().min(0),
  interviewsThisWeek: z.number().int().min(0),
  followUpsDue: z.number().int().min(0),
});

const passEntrySchema = z.strictObject({
  reason: passReasonSchema,
  company: z.string().max(100),
  title: z.string().max(200),
  at: timestampSchema,
});

/**
 * The anchor. `roles` is empty only until the build run sets it. `excludeCompanies` gets the
 * current employer from the resume; `passReasons` keeps the last 30.
 */
export const searchDataSchema = z.strictObject({
  roles: z.array(text(80)).max(5),
  locations: z.array(text(80)).max(5),
  workModes: z.array(workModeSchema).min(1).max(3),
  salaryFloor: moneySchema.optional(),
  industries: z.array(text(60)).max(5),
  excludeCompanies: z.array(text(100)).max(20),
  passReasons: z.array(passEntrySchema).max(30),
  status: z.enum(['active', 'paused', 'hired']),
  roleChecks: z.enum(['on', 'paused']),
  forwardFrom: z.email().max(200).optional(),
  forwarding: z.strictObject({
    firstAt: timestampSchema.optional(),
    hintDismissedAt: timestampSchema.optional(),
  }),
  derived: searchDerivedSchema.optional(),
});

/** A company: one the user named (`target`), or one a role is at. */
export const companyDataSchema = z.strictObject({
  name: text(100),
  domain: z
    .string()
    .regex(/^[a-z0-9.-]{1,253}$/)
    .optional(),
  board: boardSchema.optional(),
  target: z.boolean(),
  about: z.string().max(300).optional(),
});

/**
 * A role. `url` is the one the board API gives, often the employer's careers site; users open
 * it and Nexui never fetches it. A role the user told Nexui about may have no `url` or `source`.
 */
export const opportunityDataSchema = z
  .strictObject({
    title: text(200),
    url: httpsUrl.optional(),
    source: jobSourceSchema.optional(),
    location: z.string().max(120).optional(),
    workMode: workModeSchema.optional(),
    salary: salarySchema.optional(),
    fit: fitSchema.optional(),
    stage: stageSchema,
    outcome: outcomeSchema.optional(),
    postedAt: timestampSchema.optional(),
    lastSeenLiveAt: timestampSchema.optional(),
    postingClosedAt: timestampSchema.optional(),
    appliedAt: timestampSchema.optional(),
    lastContactAt: timestampSchema.optional(),
    followUps: z.number().int().min(0).max(2),
  })
  .refine((role) => (role.stage === 'closed') === (role.outcome !== undefined), {
    message: 'A closed role needs an outcome, and only a closed role has one',
    path: ['outcome'],
  });

/** An interview, at a time with its offset, or on a date when the user gave no time. */
export const interviewDataSchema = z.strictObject({
  at: z.union([timestampSchema, z.iso.date()]),
  label: text(60),
  with: z.string().max(100).optional(),
  link: httpsUrl.optional(),
  notes: z.string().max(500).optional(),
});

export const personDataSchema = z.strictObject({
  name: text(100),
  role: z.enum(['recruiter', 'hiring_manager', 'referral', 'interviewer', 'other']),
  email: z.email().max(200).optional(),
  notes: z.string().max(500).optional(),
});

/** What the resume read pulls out of a resume (spec section 4). */
export const resumeProfileSchema = z.strictObject({
  headline: z.string().max(200).optional(),
  currentTitle: z.string().max(120).optional(),
  currentEmployer: z.string().max(100).optional(),
  location: z.string().max(120).optional(),
  years: z.number().int().min(0).max(60).optional(),
  skills: z.array(text(60)).max(20),
  pastRoles: z
    .array(
      z.strictObject({
        title: z.string().max(120),
        company: z.string().max(100),
        years: z.number().min(0).max(60).optional(),
      }),
    )
    .max(10),
});

/** A resume (up to 20,000 characters, with its profile) or a draft (up to 8,000). */
export const documentDataSchema = z
  .strictObject({
    docType: z.enum(['resume', 'cover_letter', 'brief', 'follow_up', 'withdrawal']),
    body: z.string().max(20_000),
    subject: z.string().max(200).optional(),
    to: z.email().max(200).optional(),
    profile: resumeProfileSchema.optional(),
    fileName: z.string().max(200).optional(),
  })
  .refine((doc) => doc.docType === 'resume' || doc.body.length <= 8_000, {
    message: 'Too long: a draft holds at most 8,000 characters',
    path: ['body'],
  })
  .refine(
    (doc) => doc.docType === 'resume' || (doc.profile === undefined && doc.fileName === undefined),
    { message: 'Only a resume has a profile or a file name', path: ['profile'] },
  );

export type WorkMode = z.infer<typeof workModeSchema>;
export type Board = z.infer<typeof boardSchema>;
export type JobSource = z.infer<typeof jobSourceSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
export type PassReason = z.infer<typeof passReasonSchema>;
export type Salary = z.infer<typeof salarySchema>;
export type Fit = z.infer<typeof fitSchema>;
export type SearchCriteria = z.infer<typeof searchCriteriaSchema>;
export type SearchDerived = z.infer<typeof searchDerivedSchema>;
export type SearchData = z.infer<typeof searchDataSchema>;
export type CompanyData = z.infer<typeof companyDataSchema>;
export type OpportunityData = z.infer<typeof opportunityDataSchema>;
export type InterviewData = z.infer<typeof interviewDataSchema>;
export type PersonData = z.infer<typeof personDataSchema>;
export type ResumeProfile = z.infer<typeof resumeProfileSchema>;
export type DocumentData = z.infer<typeof documentDataSchema>;

/**
 * The key the scan dedupes by, and `context.jobs.seen` holds.
 *
 * @example
 * jobKey({ provider: 'greenhouse', token: 'stripe', job: '8172510' }) // 'greenhouse:stripe:8172510'
 */
export function jobKey(source: JobSource): string {
  return `${source.provider}:${source.token}:${source.job}`;
}
