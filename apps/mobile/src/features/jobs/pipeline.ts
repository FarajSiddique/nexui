import {
  followUpState,
  readField,
  type CardAction,
  type GraphObject,
  type GraphSnapshot,
  type OpportunityData,
  type Section,
} from '@nexui/types';

import { aiMarkFor, formatDate, formatDateTime } from '#lib';

import { outcomeLabel, roleLine } from './job-format.ts';
import { companyName, nextInterview } from './job-parts.ts';

type PipelineSection = Extract<Section, { type: 'pipeline' }>;

/** One role's card. */
export interface PipelineCard {
  role: GraphObject;
  title: string;
  /** "Halyard · London, hybrid · £130k–£150k". */
  line: string;
  /** Why it fits and its gaps, on a role still in New. */
  fit: { reasons: string[]; gaps: string[] } | null;
  /** Where it stands past New: "Applied Sep 26 · follow-up due", "Phone screen Fri, Oct 9, 2:00 PM". */
  note: string;
  /** Nexui found it and the user hasn't touched it: the highlighter and a dashed outline. */
  ai: boolean;
  /** The stage's buttons (New's Interested and Pass), or none. */
  actions: CardAction[];
}

export interface PipelineGroup {
  stage: string;
  label: string;
  /** Shown as one count row, opened on tap (closed roles). */
  collapsed: boolean;
  cards: PipelineCard[];
}

// Where a role stands, past New.
function noteFor(role: GraphObject, snapshot: GraphSnapshot, now: Date, timeZone?: string): string {
  const data = role.data as OpportunityData;

  switch (data.stage) {
    case 'applied': {
      const applied = data.appliedAt
        ? `Applied ${formatDate(data.appliedAt, timeZone)}`
        : 'Applied';
      const nudge = followUpState(data, now);

      if (nudge === 'due') {
        return `${applied} · follow-up due`;
      }

      return nudge === 'close' ? `${applied} · no reply` : applied;
    }

    case 'interviewing': {
      const next = nextInterview(snapshot, role.id, now);

      return next ? `${next.label} ${formatDateTime(next.at, timeZone)}` : 'Interviewing';
    }

    case 'closed':
      return data.outcome ? outcomeLabel(data.outcome) : '';
    default:
      return '';
  }
}

/**
 * The pipeline's groups in the doc's stage order (spec section 3.2). The first stage (New) always
 * shows, even empty, since it carries the AI disclosure; any other shows only with roles in it.
 * A collapsed stage (Closed) is one count row.
 */
export function pipelineGroups(
  section: PipelineSection,
  roles: readonly GraphObject[],
  snapshot: GraphSnapshot,
  now: Date = new Date(),
  timeZone?: string,
): PipelineGroup[] {
  return section.stages.flatMap((stage, index) => {
    const inStage = roles.filter((role) => readField(role, section.stageField) === stage.value);

    if (inStage.length === 0 && index > 0) {
      return [];
    }

    const actions =
      section.cardActions?.find((entry) => entry.stage === stage.value)?.actions ?? [];

    return [
      {
        stage: stage.value,
        label: stage.label,
        collapsed: section.collapsedStages.includes(stage.value),
        cards: inStage.map((role) => {
          const data = role.data as OpportunityData;

          return {
            role,
            title: data.title,
            line: roleLine(data, companyName(snapshot, role.id)),
            fit:
              data.stage === 'new' && data.fit
                ? { reasons: data.fit.reasons, gaps: data.fit.gaps }
                : null,
            note: noteFor(role, snapshot, now, timeZone),
            ai: aiMarkFor(role).highlight,
            actions,
          };
        }),
      },
    ];
  });
}
