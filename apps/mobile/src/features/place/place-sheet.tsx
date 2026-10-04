import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LegData, PhotoCredit, PlaceAbout, StayData } from '@nexui/types';

import type { PhotoState } from '#data';
import { formatDays, formatMoney, legFigures, photoCredit, placeName, travelTo } from '#lib';
import { fonts, createThemedStyles } from '#theme';
import { AiText, Button, PlacePhoto } from '#ui';
import {
  aiMarkFor,
  DayStepper,
  stayLine,
  stopSubtitle,
  type StopDetails,
} from '#features/workspace';

/** The About section: the introduction, a placeholder while it's looked up, or nothing. */
export type AboutState = PlaceAbout | 'pending' | null;

function SheetSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function About({
  name,
  about,
  onOpenLink,
}: {
  name: string;
  about: AboutState;
  onOpenLink: (url: string) => void;
}): ReactElement | null {
  const styles = useStyles();

  if (about === null) {
    return null;
  }

  if (about === 'pending') {
    return (
      <SheetSection title={`About ${name}`}>
        <Text style={styles.quiet}>Looking up {name}…</Text>
      </SheetSection>
    );
  }

  return (
    <SheetSection title={`About ${name}`}>
      <Text style={styles.paragraph}>{about.extract}</Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => onOpenLink(about.url)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.linkText}>Read more on Wikipedia</Text>
      </Pressable>
    </SheetSection>
  );
}

function Credit({ credit, onPress }: { credit: PhotoCredit; onPress: () => void }): ReactElement {
  const styles = useStyles();
  const line = photoCredit(credit);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${line}. Open the photo's page`}
      onPress={onPress}
      style={({ pressed }) => [styles.credit, pressed && styles.pressed]}
    >
      <Text style={styles.creditText}>{line}</Text>
    </Pressable>
  );
}

function NextStop({
  next,
  onPress,
}: {
  next: NonNullable<StopDetails['next']>;
  onPress: () => void;
}): ReactElement {
  const styles = useStyles();
  const name = placeName(next.place);
  const leg = next.leg ? (next.leg.data as LegData) : null;
  const title = leg ? travelTo(leg.mode, name) : `On to ${name}`;
  const figures = leg ? legFigures(leg) : '';

  return (
    <SheetSection title="Next stop">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${[title, figures].filter(Boolean).join(', ')}. Show details`}
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.rowIcon}>
          <Text style={styles.rowIconText}>→</Text>
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{title}</Text>
          {figures ? <Text style={styles.rowDetail}>{figures}</Text> : null}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </SheetSection>
  );
}

function Stays({
  stays,
  onFindStay,
}: {
  stays: StopDetails['stays'];
  onFindStay: () => void;
}): ReactElement {
  const styles = useStyles();

  if (stays.length === 0) {
    return (
      <SheetSection title="Where you’ll stay">
        <Text style={styles.quiet}>No place to stay yet.</Text>
        <Button label="Find a stay with Nexui" variant="primary" onPress={onFindStay} />
      </SheetSection>
    );
  }

  return (
    <SheetSection title="Where you’ll stay">
      {stays.map((stay) => {
        const data = stay.data as StayData;

        return (
          <View key={stay.id} style={styles.stay}>
            <AiText
              text={data.name}
              highlight={aiMarkFor(stay).highlight}
              style={styles.rowTitle}
            />
            <Text style={styles.rowDetail}>{stayLine(data)}</Text>
          </View>
        );
      })}
    </SheetSection>
  );
}

/**
 * A route stop's details (spec section 5): its photo and credit, its name and place on the
 * route, days and daily cost, why it's on the route, Wikipedia's introduction, the next stop
 * and where you'll stay. It only reports taps; the place screen does the work.
 */
export function PlaceSheet({
  details,
  about,
  photo,
  was,
  onDone,
  onDays,
  onNext,
  onFindStay,
  onOpenLink,
}: {
  details: StopDetails;
  about: AboutState;
  photo: PhotoState;
  /** The days before this session's first change, for "was 4". */
  was: number | undefined;
  onDone: () => void;
  onDays: (days: number) => void;
  onNext: (placeId: string) => void;
  onFindStay: () => void;
  /** Opens a link outside the app: the Wikipedia article or the photo's Commons page. */
  onOpenLink: (url: string) => void;
}): ReactElement {
  const styles = useStyles();
  const { data, next } = details;
  const name = placeName(details.place);
  const highlight = aiMarkFor(details.place).highlight;

  return (
    <View>
      {photo === null ? (
        <Button label="Done" onPress={onDone} style={styles.done} />
      ) : (
        <View style={styles.hero}>
          <PlacePhoto
            uri={photo === 'pending' ? null : photo.url}
            height={244}
            label={photo === 'pending' ? undefined : `Photo of ${name}`}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [styles.photoDone, pressed && styles.pressed]}
          >
            <Text style={styles.photoDoneText}>Done</Text>
          </Pressable>
        </View>
      )}
      {photo !== null && photo !== 'pending' ? (
        <Credit credit={photo.credit} onPress={() => onOpenLink(photo.credit.sourceUrl)} />
      ) : null}
      <View style={styles.header}>
        <AiText text={name} highlight={highlight} style={styles.title} />
        <Text style={styles.subtitle}>{stopSubtitle(details)}</Text>
      </View>
      <View style={styles.panel}>
        <View style={styles.panelRow}>
          <Text style={styles.panelLabel}>Days here</Text>
          {details.canEditDays ? (
            <DayStepper name={name} days={data.days} was={was} onDays={onDays} surface="soft" />
          ) : (
            <Text style={styles.panelValue}>{formatDays(data.days)}</Text>
          )}
        </View>
        {data.estDailyCost ? (
          <>
            <View style={styles.divider} />
            <View style={styles.panelRow}>
              <Text style={styles.panelLabel}>Daily cost</Text>
              <Text style={styles.panelValue}>≈ {formatMoney(data.estDailyCost)}</Text>
            </View>
          </>
        ) : null}
      </View>
      {data.why ? (
        <SheetSection title="Why it’s on your route">
          <AiText text={data.why} highlight={highlight} style={styles.paragraph} />
        </SheetSection>
      ) : null}
      <About name={name} about={about} onOpenLink={onOpenLink} />
      {next ? <NextStop next={next} onPress={() => onNext(next.place.id)} /> : null}
      <Stays stays={details.stays} onFindStay={onFindStay} />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  done: { alignSelf: 'flex-end' },
  // Bleeds through the place screen's padding (20 at the sides, 12 on top) to the sheet's edges.
  hero: { marginHorizontal: -20, marginTop: -12 },
  photoDone: {
    position: 'absolute',
    top: 16,
    right: 14,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: 'center',
    backgroundColor: colors.photoScrim,
  },
  photoDoneText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.photoInk },
  credit: { minHeight: 44, justifyContent: 'center' },
  creditText: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.faint,
    textDecorationLine: 'underline',
  },
  header: { gap: 4, paddingTop: 6 },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: colors.ink,
  },
  subtitle: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.muted },
  panel: { marginTop: 16, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.soft },
  panelRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelLabel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  panelValue: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.line },
  section: { gap: 8, paddingTop: 24 },
  sectionTitle: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, color: colors.ink },
  paragraph: { fontFamily: fonts.body, fontSize: 15, lineHeight: 24, color: colors.ink },
  quiet: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.soft,
  },
  rowIconText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  rowDetail: { fontFamily: fonts.body, fontSize: 14, lineHeight: 18, color: colors.muted },
  chevron: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.faint },
  stay: { gap: 2, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
}));
