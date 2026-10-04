import { router } from 'expo-router';
import { useMemo, useRef, type ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChangeRowView } from '@/components/change-row';
import { ConnectionBanner } from '@/components/connection-banner';
import { IntentCard } from '@/components/intent-card';
import { ListEmpty, ListError, SkeletonRows } from '@/components/list-states';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { HeaderButton, TabHeader } from '@/components/tab-header';
import { buildChangeRows } from '@/lib/change-feed';
import {
  isDrafting,
  useDeleteIntent,
  useDeletingIntents,
  useIntents,
  useRecentChanges,
} from '@/lib/queries';
import { fonts } from '@/lib/theme';
import { createThemedStyles } from '@/lib/use-theme';

/**
 * Home: every plan as a card, then the latest three changes. The gear opens Account. Swiping a
 * card left shows Delete, which deletes the plan for good; one card is open at a time.
 */
export default function HomeScreen(): ReactElement {
  const styles = useStyles();
  const intents = useIntents();
  const recent = useRecentChanges();
  const remove = useDeleteIntent();
  const deleting = useDeletingIntents();
  const openRow = useRef<SwipeableMethods | null>(null);
  const rows = useMemo(() => buildChangeRows(recent.data?.items ?? []).slice(0, 3), [recent.data]);
  const now = new Date();

  const showOpenRow = (row: SwipeableMethods): void => {
    if (openRow.current !== row) {
      openRow.current?.close();
    }

    openRow.current = row;
  };

  const retryDelete = (): void => {
    if (remove.variables) {
      remove.mutate(remove.variables);
    }
  };

  const renderPlans = (): ReactElement => {
    if (intents.isPending) {
      return <SkeletonRows count={3} />;
    }

    if (intents.isLoadingError) {
      return <ListError message={intents.error.message} onRetry={() => void intents.refetch()} />;
    }

    const plans = intents.data.filter((item) => !deleting.includes(item.id));

    return (
      <>
        {intents.isRefetchError ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void intents.refetch()}
            style={styles.notice}
          >
            <Text accessibilityLiveRegion="polite" style={styles.noticeText}>
              {"Couldn't refresh your plans. Showing what was last loaded. Tap to try again."}
            </Text>
          </Pressable>
        ) : null}
        {remove.isError ? (
          <Pressable accessibilityRole="button" onPress={retryDelete} style={styles.notice}>
            <Text accessibilityLiveRegion="polite" style={styles.deleteErrorText}>
              {"Couldn't delete that plan. Tap to try again."}
            </Text>
          </Pressable>
        ) : null}
        {plans.length === 0 ? (
          <ListEmpty text="Your plans will show here. Tap + and say what you're trying to do." />
        ) : (
          <View style={styles.cards}>
            {plans.map((item) => {
              // Nexui is still writing to a Drafting plan, so it can't be deleted yet.
              const drafting = isDrafting(item);
              const onDelete = (): void => remove.mutate(item.id);

              return (
                <SwipeToDelete
                  key={item.id}
                  enabled={!drafting}
                  onDelete={onDelete}
                  onOpen={showOpenRow}
                >
                  <IntentCard
                    item={item}
                    onPress={() =>
                      router.push({ pathname: '/intent/[id]', params: { id: item.id } })
                    }
                    onDelete={drafting ? undefined : onDelete}
                  />
                </SwipeToDelete>
              );
            })}
          </View>
        )}
      </>
    );
  };

  const renderChanges = (): ReactElement | null => {
    if (recent.isError) {
      return (
        <View style={styles.changes}>
          <Text accessibilityRole="header" style={styles.subhead}>
            What changed
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void recent.refetch()}
            style={styles.changesError}
          >
            <Text style={styles.changesErrorText}>
              {"Couldn't load recent changes. Tap to try again."}
            </Text>
          </Pressable>
        </View>
      );
    }

    if (rows.length === 0) {
      return null;
    }

    return (
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
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.content}
        onScrollBeginDrag={() => openRow.current?.close()}
      >
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
        {renderChanges()}
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
  notice: { marginTop: 12, minHeight: 44, justifyContent: 'center' },
  noticeText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  deleteErrorText: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
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
  changesError: { minHeight: 44, justifyContent: 'center' },
  changesErrorText: { fontFamily: fonts.body, fontSize: 14, color: colors.danger },
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
