import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { GraphObject, InsightData } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { ActorAvatar, Button } from '#ui';

import { fromInsightAction, type WorkspaceAction } from '../workspace-actions';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

function InsightCard({
  insight,
  onAction,
  busy,
}: {
  insight: GraphObject;
  onAction: (action: WorkspaceAction) => void;
  busy: boolean;
}): ReactElement {
  const styles = useStyles();
  const data = insight.data as InsightData;
  const derived = data.derivedKey !== undefined || insight.source?.type === 'derived';
  const buttons = data.actions.map((action) => ({
    label: action.label,
    next: fromInsightAction(action),
  }));

  return (
    <SectionFrame accent={data.severity === 'attention'}>
      <View style={styles.head}>
        <ActorAvatar actor={derived ? 'derived' : 'ai'} />
        <View style={styles.text}>
          <Text style={styles.title}>{data.text}</Text>
          {data.detail ? <Text style={styles.detail}>{data.detail}</Text> : null}
        </View>
      </View>
      {buttons.length > 0 ? (
        <View style={styles.actions}>
          {buttons.map(({ label, next }, index) => (
            <Button
              key={`${index}-${label}`}
              label={label}
              variant={index === 0 ? 'primary' : 'secondary'}
              disabled={busy && next.type !== 'ask' && next.type !== 'copy'}
              onPress={() => onAction(next)}
            />
          ))}
        </View>
      ) : null}
    </SectionFrame>
  );
}

/** Things worth the user's attention, each with at most two actions. */
export function InsightSection({
  data,
  onAction,
  busy,
}: SectionProps<'insight'>): ReactElement | null {
  const styles = useStyles();

  if (data.insights.length === 0) {
    return null;
  }

  return (
    <View style={styles.stack}>
      {data.insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} onAction={onAction} busy={busy} />
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stack: { gap: 10 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  text: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 21, color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
}));
