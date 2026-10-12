import {
  STAGES,
  type DocumentData,
  type GraphObject,
  type GraphSnapshot,
  type InterviewData,
  type OpportunityData,
  type Outcome,
  type PersonData,
  type Stage,
} from '@nexui/types';

import { aiMarkFor, capitalize, formatDate, formatDateTime } from '#lib';

import { outcomeLabel, placeLine, postingLink, salaryText } from './job-format.ts';
import { companyName, interviewsFor, linkedFrom } from './job-parts.ts';

/** What each draft is, as a list row names it. */
export const DOC_LABELS: Record<DocumentData['docType'], string> = {
  resume: 'Resume',
  cover_letter: 'Cover letter',
  brief: 'Application brief',
  follow_up: 'Follow-up',
  withdrawal: 'Withdrawal note',
};

const PERSON_ROLES: Record<PersonData['role'], string> = {
  recruiter: 'recruiter',
  hiring_manager: 'hiring manager',
  referral: 'referral',
  interviewer: 'interviewer',
  other: '',
};

// What the user may close a role as from its sheet. Pass, Accept offer and Decline have their
// own buttons.
const CLOSE_WITH: readonly Outcome[] = ['rejected', 'withdrew', 'no_reply', 'posting_closed'];

/** What a role's sheet shows (job search spec, section 6). */
export interface RoleDetails {
  role: GraphObject;
  data: OpportunityData;
  company: string | null;
  /** "London, hybrid · £130k–£150k". */
  line: string;
  ai: boolean;
  fit: { reasons: string[]; gaps: string[] } | null;
  /** The posting's link as parsed, the host it opens and what's known of it, or null with none. */
  posting: { url: string; host: string; note: string } | null;
  /** The stage picker: every stage but Closed, the current one marked. */
  stages: { value: Stage; label: string; current: boolean }[];
  /** "Closed · No reply" while closed, else null. */
  closed: string | null;
  closeWith: { value: Outcome; label: string }[];
  /** "Applied Sep 26", "Last contact Oct 2". */
  dates: string[];
  drafts: { id: string; label: string; ai: boolean }[];
  people: { name: string; role: string }[];
  interviews: { label: string; when: string }[];
}

function words(body: string): number {
  const trimmed = body.trim();

  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// When the posting went up and when a board last listed it: "Posted Oct 2 · still live today on
// its job board" (Departure 12).
function postingNote(data: OpportunityData, now: Date, timeZone?: string): string {
  const parts: string[] = [];

  if (data.postedAt) {
    parts.push(`Posted ${formatDate(data.postedAt, timeZone)}`);
  }

  if (data.lastSeenLiveAt) {
    const today =
      formatDate(data.lastSeenLiveAt, timeZone) === formatDate(now.toISOString(), timeZone);

    parts.push(
      today
        ? 'still live today on its job board'
        : `last seen live ${formatDate(data.lastSeenLiveAt, timeZone)}`,
    );
  }

  return capitalize(parts.join(' · '));
}

/** A role's sheet, or null when the plan no longer holds it. */
export function roleDetails(
  snapshot: GraphSnapshot,
  roleId: string,
  now: Date = new Date(),
  timeZone?: string,
): RoleDetails | null {
  const role = snapshot.objects.find(
    (object) => object.id === roleId && object.kind === 'opportunity',
  );

  if (!role) {
    return null;
  }

  const data = role.data as OpportunityData;
  const link = data.url ? postingLink(data.url) : null;
  const dates: string[] = [];

  if (data.appliedAt) {
    dates.push(`Applied ${formatDate(data.appliedAt, timeZone)}`);
  }

  if (data.lastContactAt) {
    dates.push(`Last contact ${formatDate(data.lastContactAt, timeZone)}`);
  }

  return {
    role,
    data,
    company: companyName(snapshot, role.id),
    line: [placeLine(data), salaryText(data.salary)].filter((part) => part.length > 0).join(' · '),
    ai: aiMarkFor(role).highlight,
    fit: data.fit ? { reasons: data.fit.reasons, gaps: data.fit.gaps } : null,
    posting: link
      ? { url: link.href, host: link.host, note: postingNote(data, now, timeZone) }
      : null,
    stages: STAGES.filter((stage) => stage.value !== 'closed').map((stage) => ({
      value: stage.value,
      label: stage.label,
      current: stage.value === data.stage,
    })),
    closed:
      data.stage === 'closed' && data.outcome ? `Closed · ${outcomeLabel(data.outcome)}` : null,
    closeWith: CLOSE_WITH.map((value) => ({ value, label: outcomeLabel(value) })),
    dates,
    drafts: linkedFrom(snapshot, role.id, 'for', 'document')
      .filter((draft) => (draft.data as DocumentData).docType !== 'resume')
      .map((draft) => {
        const doc = draft.data as DocumentData;

        return {
          id: draft.id,
          label: `${DOC_LABELS[doc.docType]} · ${words(doc.body)} words`,
          ai: aiMarkFor(draft).highlight,
        };
      }),
    people: linkedFrom(snapshot, role.id, 'for', 'person').map((person) => {
      const who = person.data as PersonData;

      return { name: who.name, role: PERSON_ROLES[who.role] };
    }),
    interviews: interviewsFor(snapshot, role.id).map((interview) => {
      const when = interview.data as InterviewData;

      return { label: when.label, when: formatDateTime(when.at, timeZone) };
    }),
  };
}

/** The + sheet's prompt for Ask about this role: the role named, ready for the question. */
export function askAbout(details: RoleDetails): string {
  return details.company
    ? `About ${details.data.title} at ${details.company}: `
    : `About ${details.data.title}: `;
}
