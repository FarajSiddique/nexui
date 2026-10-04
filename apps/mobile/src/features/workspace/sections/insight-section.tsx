import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { GraphObject, InsightAction, InsightData } from '@nexui/types';

import { fonts, createThemedStyles } from '#theme';
import { ActorAvatar, Button } from '#ui';

import type { WorkspaceAction } from '../workspace-actions';
import { SectionFrame } from './section-frame';
import type { SectionProps } from './types';

function toAction(action: InsightAction): WorkspaceAction {
  if (action.type === 'ask') {
    return { type: 'ask', prompt: action.prompt };
  }

  return { type: 'capability', name: action.name, input: action.input };
}

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

  return (
    <SectionFrame accent={data.severity === 'attention'}>
      <View style={styles.head}>
        <ActorAvatar actor={derived ? 'derived' : 'ai'} />
        <View style={styles.text}>
          <Text style={styles.title}>{data.text}</Text>
          {data.detail ? <Text style={styles.detail}>{data.detail}</Text> : null}
        </View>
      </View>
      {data.actions.length > 0 ? (
        <View style={styles.actions}>
          {data.actions.map((action, index) => (
            <Button
              key={action.label}
              label={action.label}
              variant={index === 0 ? 'primary' : 'secondary'}
              disabled={busy && action.type === 'capability'}
              onPress={() => onAction(toAction(action))}
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
