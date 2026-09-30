import {
  readField,
  type DecisionData,
  type OptionData,
  type PlaceData,
  type Section,
} from '@nexui/types';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AiText, NexuiTag } from '@/components/ai-text';
import { Button } from '@/components/buttons';
import { aiMarkFor } from '@/lib/ai-mark';
import { cardText, formatField, formatMoney, humanizeKey } from '@/lib/format';
import type { DecisionOption } from '@/lib/sections';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

import { ComparisonTable, type ComparisonRow } from './comparison-table';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

type FieldSpec = Extract<Section, { type: 'decision' }>['fields'][number];

// The section's fields, then every metric any option reports, then the candidate place's daily
// cost. Rows where no option has a value are left out.
function decisionRows(fields: FieldSpec[], options: DecisionOption[]): ComparisonRow[] {
  const byField = fields.map((field) => ({
    label: field.label,
    cells: options.map((entry) => formatField(readField(entry.option, field.field), field.format)),
  }));
  const metricKeys = [
    ...new Set(
      options.flatMap((entry) => Object.keys((entry.option.data as OptionData).metrics ?? {})),
    ),
  ];
  const metrics = metricKeys.map((key) => ({
    label: humanizeKey(key),
    cells: options.map((entry) => formatField((entry.option.data as OptionData).metrics[key])),
  }));
  const perDay = {
    label: 'Per day',
    cells: options.map((entry) => {
      const cost = (entry.place?.data as Partial<PlaceData> | undefined)?.estDailyCost;

      return cost ? `≈ ${formatMoney(cost)}` : '—';
    }),
  };

  return [...byField, ...metrics, perDay].filter((row) => row.cells.some((cell) => cell !== '—'));
}

/**
 * A question Nexui put to the user: the question on the highlighter, the tradeoff, and the
 * options compared column by column, each with Choose. "Keep the day free" settles it with no
 * option. A decision the trip settles by itself (its length) points to + instead.
 */
export function DecisionSection({
  section,
  data,
  onAction,
  busy,
}: SectionProps<'decision'>): ReactElement | null {
  const styles = useStyles();
  const { decision, options } = data;

  if (!decision) {
    return null;
  }

  const details = decision.data as DecisionData;
  const proposedBy =
    options.length > 0 ? `Proposed by Nexui, ${options.length} options` : 'Proposed by Nexui';
  const columns = options.map((entry) => ({
    id: entry.option.id,
    title: cardText(entry.option).title,
    highlight: aiMarkFor(entry.option).highlight,
    tentative: true,
  }));

  return (
    <SectionFrame accent>
      {decision.source?.type === 'ai' ? <NexuiTag label={proposedBy} /> : null}
      <AiText
        text={details.question}
        highlight={decision.source?.type === 'ai'}
        tag={false}
        style={styles.question}
      />
      {details.tradeoff ? (
        <Text style={styles.tradeoff}>
          <Text style={styles.tradeoffLabel}>Tradeoff </Text>
          {details.tradeoff}
        </Text>
      ) : null}
      {details.derivedKey ? (
        <View style={styles.settles}>
          <Text style={styles.detail}>
            This settles itself once the trip&apos;s length is known. Tell Nexui the dates or how
            many days.
          </Text>
          <Button
            label="Answer in +"
            variant="primary"
            onPress={() => onAction({ type: 'ask', prompt: '' })}
          />
        </View>
      ) : (
        <View style={styles.choices}>
          {columns.length > 0 ? (
            <ComparisonTable
              columns={columns}
              rows={decisionRows(section.fields, options)}
              footer={(column) => (
                <Button
                  label="Choose"
                  accessibilityLabel={`Choose ${column.title}`}
                  disabled={busy}
                  onPress={() =>
                    onAction({
                      type: 'resolveDecision',
                      decisionId: decision.id,
                      optionId: column.id,
                    })
                  }
                />
              )}
            />
          ) : null}
          <Button
            label="Keep the day free"
            variant="text"
            disabled={busy}
            onPress={() =>
              onAction({ type: 'resolveDecision', decisionId: decision.id, optionId: null })
            }
          />
        </View>
      )}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  question: { fontFamily: fonts.heading, fontSize: 19, lineHeight: 25, color: colors.ink },
  tradeoff: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  tradeoffLabel: { fontFamily: fonts.bodyBold, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  settles: { gap: 10, alignItems: 'flex-start' },
  choices: { gap: 8, alignItems: 'center' },
}));
