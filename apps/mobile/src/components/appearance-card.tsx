import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';

import { fonts } from '@/lib/theme';
import { createThemedStyles, useScheme } from '@/lib/use-theme';
import { setAppearance, useAppearanceStore } from '@/stores/use-appearance-store';

const TRACK_WIDTH = 116;
const TRACK_HEIGHT = 52;
const ORB_SIZE = 40;
const INSET = (TRACK_HEIGHT - ORB_SIZE) / 2;
const TRAVEL = TRACK_WIDTH - ORB_SIZE - INSET * 2;

// Clouds drift on the right by day; stars come out on the left, one by one, at night.
const CLOUDS = [
  { width: 28, top: 14, right: 16, opacity: 1 },
  { width: 20, top: 28, right: 34, opacity: 0.8 },
];
const STARS = [
  { left: 18, top: 12, size: 3, delay: 0 },
  { left: 30, top: 30, size: 2, delay: 80 },
  { left: 44, top: 17, size: 2, delay: 160 },
  { left: 52, top: 36, size: 3, delay: 120 },
  { left: 62, top: 9, size: 2, delay: 220 },
];
const CRATERS = [
  { left: 9, top: 8, size: 11 },
  { left: 22, top: 23, size: 7 },
  { left: 26, top: 12, size: 5 },
];

// Overshoots a little, so the sun or moon settles into place.
const settle = cubicBezier(0.45, 1.45, 0.45, 0.95);

/**
 * Account's Appearance card: the sky switch picks Light or Dark, and Match my phone follows the
 * phone's setting. Unchecking Match my phone keeps the current look as an explicit choice.
 */
export function AppearanceCard(): ReactElement {
  const styles = useStyles();
  const scheme = useScheme();
  const matching = useAppearanceStore((state) => state.preference === 'system');
  const dark = scheme === 'dark';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.state}>
          <Text style={styles.word}>{dark ? 'Dark' : 'Light'}</Text>
          <Text style={styles.source}>{matching ? 'Matching your phone' : 'Your choice'}</Text>
        </View>
        <SkySwitch dark={dark} onToggle={() => setAppearance(dark ? 'light' : 'dark')} />
      </View>
      <Pressable
        accessibilityRole="checkbox"
        aria-checked={matching}
        onPress={() => setAppearance(matching ? scheme : 'system')}
        style={({ pressed }) => [styles.match, pressed && styles.dimmed]}
      >
        <View style={[styles.box, matching && styles.boxChecked]}>
          {matching ? <View style={styles.tick} /> : null}
        </View>
        <Text style={styles.matchText}>Match my phone</Text>
      </Pressable>
    </View>
  );
}

/**
 * The day and night switch. When `dark` changes, the sun slides across and turns into the moon,
 * the clouds sink away and the stars come out, each with a Reanimated CSS transition.
 */
function SkySwitch({ dark, onToggle }: { dark: boolean; onToggle: () => void }): ReactElement {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const ms = (duration: number) => (reduceMotion ? 0 : duration);
  const fadeColor = { transitionProperty: 'backgroundColor', transitionDuration: ms(500) } as const;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      aria-checked={dark}
      onPress={onToggle}
      style={({ pressed }) => [styles.switch, pressed && styles.dimmed]}
    >
      <Animated.View style={[styles.track, fadeColor]}>
        {CLOUDS.map((cloud) => (
          <Animated.View
            key={cloud.right}
            style={[
              styles.cloud,
              {
                width: cloud.width,
                top: cloud.top,
                right: cloud.right,
                opacity: dark ? 0 : cloud.opacity,
                transform: [{ translateY: dark ? 18 : 0 }],
                transitionProperty: ['opacity', 'transform'],
                transitionDuration: ms(500),
              },
            ]}
          />
        ))}
        {STARS.map((star) => (
          <Animated.View
            key={star.left}
            style={[
              styles.star,
              {
                left: star.left,
                top: star.top,
                width: star.size,
                height: star.size,
                opacity: dark ? 1 : 0,
                transform: [{ scale: dark ? 1 : 0.2 }],
                transitionProperty: ['opacity', 'transform'],
                transitionDuration: ms(400),
                transitionDelay: dark ? ms(star.delay) : 0,
              },
            ]}
          />
        ))}
        <Animated.View
          style={[
            styles.orbPath,
            {
              transform: [{ translateX: dark ? TRAVEL : 0 }, { rotate: dark ? '160deg' : '0deg' }],
              transitionProperty: 'transform',
              transitionDuration: ms(600),
              transitionTimingFunction: settle,
            },
          ]}
        >
          <Animated.View style={[styles.halo, fadeColor]} />
          <Animated.View style={[styles.glow, fadeColor]} />
          <Animated.View style={[styles.orb, fadeColor]}>
            {CRATERS.map((crater) => (
              <Animated.View
                key={crater.left}
                style={[
                  styles.crater,
                  {
                    left: crater.left,
                    top: crater.top,
                    width: crater.size,
                    height: crater.size,
                    opacity: dark ? 1 : 0,
                    transitionProperty: 'opacity',
                    transitionDuration: ms(400),
                  },
                ]}
              />
            ))}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: { marginTop: 8, marginBottom: 8, borderRadius: 16, backgroundColor: colors.card },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 14,
  },
  state: { flexShrink: 1 },
  word: { fontFamily: fonts.heading, fontSize: 20, color: colors.ink },
  source: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  switch: { borderRadius: 999 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.skyTrack,
  },
  cloud: { position: 'absolute', height: 9, borderRadius: 999, backgroundColor: colors.skyDetail },
  star: { position: 'absolute', borderRadius: 999, backgroundColor: colors.skyDetail },
  orbPath: { position: 'absolute', top: INSET, left: INSET, width: ORB_SIZE, height: ORB_SIZE },
  halo: {
    position: 'absolute',
    top: -13,
    left: -13,
    width: ORB_SIZE + 26,
    height: ORB_SIZE + 26,
    borderRadius: 999,
    backgroundColor: colors.skyGlow,
  },
  glow: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: ORB_SIZE + 12,
    height: ORB_SIZE + 12,
    borderRadius: 999,
    backgroundColor: colors.skyGlow,
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: colors.skyOrb,
  },
  crater: { position: 'absolute', borderRadius: 999, backgroundColor: colors.skyCrater },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.ink, borderColor: colors.ink },
  // A check mark drawn as the corner of a rotated box.
  tick: {
    width: 6,
    height: 11,
    marginTop: -3,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.card,
    transform: [{ rotate: '45deg' }],
  },
  matchText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  dimmed: { opacity: 0.6 },
}));
