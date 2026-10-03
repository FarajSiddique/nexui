import type { RunRecord } from '@nexui/types';
import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { AiText } from '@/components/ai-text';
import { Button } from '@/components/buttons';
import { isRunActive } from '@/lib/queries';
import { fonts } from '@/lib/theme';
import { createThemedStyles, useColors } from '@/lib/use-theme';

const TITLES: Record<RunRecord['status'], string> = {
  queued: 'Starting…',
  running: 'Working on it',
  stopping: 'Stopping…',
  awaiting_approval: 'Waiting for you',
  succeeded: 'Done',
  failed: 'Stopped partway — Undo or retry',
  cancelled: 'Stopped',
};

function Elapsed({ since }: { since: string }): ReactElement {
  const styles = useStyles();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);

    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1_000));

  return (
    <Text style={styles.elapsed}>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </Text>
  );
}

/**
 * A run as it works: spinner and elapsed time, one line per change as it lands, and Stop.
 * Closing the sheet doesn't stop it; what it wrote stays and can be undone in Changes.
 */
export function RunCard({
  run,
  onStop,
  stopping,
  onRetry,
  retrying,
  onSeeChanges,
}: {
  run: RunRecord | undefined;
  onStop: (runId: string) => void;
  stopping: boolean;
  onRetry: () => void;
  retrying: boolean;
  onSeeChanges: () => void;
}): ReactElement {
  const styles = useStyles();
  const colors = useColors();

  if (!run) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  const active = isRunActive(run);
  const lines = run.progress.filter((entry) => entry.ok).map((entry) => entry.label);

  const renderFooter = (): ReactElement => {
    if (active) {
      const isStopping = run.status === 'stopping';

      return (
        <View style={styles.footer}>
          <Text style={styles.note}>
            {isStopping
              ? 'Nexui is saving the change it was making, then it stops.'
              : "Each change is saved to the plan as it arrives. Closing this sheet doesn't stop it."}
          </Text>
          {isStopping ? null : (
            <Button label="Stop" busy={stopping} onPress={() => onStop(run.id)} />
          )}
        </View>
      );
    }

    if (run.status === 'failed') {
      return (
        <View style={styles.footer}>
          {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
          <View style={styles.row}>
            <Button label="Try again" variant="primary" busy={retrying} onPress={onRetry} />
            <Button label="Undo in Changes" variant="text" onPress={onSeeChanges} />
          </View>
        </View>
      );
    }

    if (run.status === 'cancelled') {
      return (
        <View style={styles.footer}>
          <Text style={styles.note}>
            What Nexui added so far stays. You can undo it in Changes.
          </Text>
          <Button label="See changes" variant="text" onPress={onSeeChanges} />
        </View>
      );
    }

    return (
      <Text style={styles.note}>
        {lines.length === 1 ? '1 change' : `${lines.length} changes`} saved to the plan.
      </Text>
    );
  };

  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <View style={styles.head}>
        {active ? <ActivityIndicator size="small" color={colors.ink} /> : null}
        <Text style={styles.title}>{TITLES[run.status]}</Text>
        {active ? <Elapsed since={run.startedAt ?? run.createdAt} /> : null}
      </View>
      {lines.map((line, index) => (
        <AiText key={`${index}-${line}`} text={line} highlight tag={false} style={styles.line} />
      ))}
      {renderFooter()}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { gap: 8, padding: 14, borderRadius: 18, backgroundColor: colors.soft },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  elapsed: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  line: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  footer: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
}));
