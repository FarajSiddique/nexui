import { readField } from '@nexui/types';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import { aiMarkFor } from '@/features/workspace/ai-mark';
import { cardText, formatField } from '@/lib/format';
import { fonts } from '@/theme/theme';
import { createThemedStyles } from '@/theme/use-theme';

import { ComparisonTable } from './comparison-table';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

/** Objects outside a decision (stays, say) compared by the section's fields. */
export function ComparisonSection({ section, data }: SectionProps<'comparison'>): ReactElement {
  const styles = useStyles();
  const columns = data.objects.map((object) => {
    const mark = aiMarkFor(object);

    return {
      id: object.id,
      title: cardText(object).title,
      highlight: mark.highlight,
      tentative: mark.tentative,
    };
  });
  const rows = section.fields.map((field) => ({
    label: field.label,
    cells: data.objects.map((object) => formatField(readField(object, field.field), field.format)),
  }));

  return (
    <SectionFrame title={section.title}>
      {columns.length === 0 ? (
        <Text style={styles.empty}>Nothing to compare yet.</Text>
      ) : (
        <ComparisonTable columns={columns} rows={rows} />
      )}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
}));
