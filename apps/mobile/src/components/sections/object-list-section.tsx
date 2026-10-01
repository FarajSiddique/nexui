import type { GraphObject, ThingData } from '@nexui/types';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { AiText } from '@/components/ai-text';
import { aiMarkFor } from '@/lib/ai-mark';
import { cardText } from '@/lib/format';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

function ObjectCard({ object, rich }: { object: GraphObject; rich: boolean }): ReactElement {
  const styles = useStyles();
  const { title, subtitle } = cardText(object);
  const mark = aiMarkFor(object);
  const fields = object.kind === 'thing' ? (object.data as ThingData).fields : [];

  return (
    <View style={[styles.item, mark.tentative && styles.tentative]}>
      <AiText text={title} highlight={mark.highlight} style={styles.title} />
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={rich ? undefined : 1}>
          {subtitle}
        </Text>
      ) : null}
      {fields.map((field) => (
        <View key={field.label} style={styles.field}>
          <Text style={styles.fieldLabel}>{field.label}</Text>
          <Text style={styles.fieldValue}>{field.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Objects as cards built from `KIND_CARDS`; a `thing` lists its labeled fields. */
export function ObjectListSection({ section, data }: SectionProps<'objectList'>): ReactElement {
  const styles = useStyles();

  return (
    <SectionFrame title={section.title}>
      {data.objects.length === 0 ? (
        <Text style={styles.empty}>{section.empty ?? 'Nothing here yet.'}</Text>
      ) : (
        data.objects.map((object) => (
          <ObjectCard key={object.id} object={object} rich={section.card === 'rich'} />
        ))
      )}
    </SectionFrame>
  );
}

const useStyles = createThemedStyles((colors) => ({
  item: { gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line },
  tentative: {
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 12,
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  field: { flexDirection: 'row', gap: 8 },
  fieldLabel: { width: 96, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  fieldValue: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  empty: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
}));
