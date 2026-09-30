import { router } from 'expo-router';
import { useMemo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChangeRowView } from '@/components/change-row';
import { ConnectionBanner } from '@/components/connection-banner';
import { IntentCard } from '@/components/intent-card';
import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { HeaderButton, TabHeader } from '@/components/tab-header';
import { buildChangeRows } from '@/lib/change-feed';
import { useIntents, useRecentChanges } from '@/lib/queries';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/** Home: every plan as a card, then the latest three changes. The gear opens Account. */
export default function HomeScreen(): ReactElement {
  const styles = useStyles();
  const intents = useIntents();
  const recent = useRecentChanges();
  const rows = useMemo(() => buildChangeRows(recent.data?.items ?? []).slice(0, 3), [recent.data]);
  const now = new Date();

  const renderPlans = (): ReactElement => {
    if (intents.isPending) {
      return <SkeletonRows count={3} />;
    }

    if (intents.isError) {
      return <ListError message={intents.error.message} onRetry={() => void intents.refetch()} />;
    }

    if (intents.data.length === 0) {
      return (
        <ListEmpty text="Your plans will show here. Tap + and say what you're trying to do." />
      );
    }

    return (
      <View style={styles.cards}>
        {intents.data.map((item) => (
          <IntentCard
            key={item.id}
            item={item}
            onPress={() => router.push({ pathname: '/intent/[id]', params: { id: item.id } })}
          />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <Text style={styles.wordmark}>nexui</Text>
        <TabHeader
          title="Plans"
          tools={
            <HeaderButton label="Account" onPress={() => router.push('/account')}>
              <GearGlyph />
            </HeaderButton>
          }
        />
        <ConnectionBanner />
        {renderPlans()}
        {rows.length > 0 ? (
          <View style={styles.changes}>
            <Text accessibilityRole="header" style={styles.subhead}>
              What changed
            </Text>
            <View style={styles.feed}>
              {rows.map((row) => (
                <ChangeRowView key={row.key} row={row} now={now} compact />
              ))}
              <Pressable
                accessibilityRole="link"
                onPress={() => router.navigate('/changes')}
                style={styles.more}
              >
                <Text style={styles.moreText}>See all changes</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// A gear drawn with views: a ring over four crossed bars.
function GearGlyph(): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.gear}>
      {[0, 45, 90, 135].map((angle) => (
        <View key={angle} style={[styles.tooth, { transform: [{ rotate: `${angle}deg` }] }]} />
      ))}
      <View style={styles.ring} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },
  wordmark: { fontFamily: fonts.display, fontSize: 16, letterSpacing: -0.3, color: colors.muted },
  cards: { gap: 12, marginTop: 12 },
  changes: { gap: 8, marginTop: 24 },
  subhead: { fontFamily: fonts.heading, fontSize: 20, color: colors.ink },
  feed: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  more: { minHeight: 44, justifyContent: 'center' },
  moreText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  gear: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  tooth: {
    position: 'absolute',
    width: 18,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.ink,
  },
  ring: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: colors.ink,
    backgroundColor: colors.card,
  },
}));
