/**
 * Animated splash — the logo spinning like a tornado with notes flung off it.
 *
 * SAFETY NOTE, because this is the second attempt. The first version
 * (commit 7655ed6, reverted in a137f30) called
 * SplashScreen.preventAutoHideAsync() at module load and relied on this
 * component mounting to call hideAsync(). When anything downstream stalled
 * before that happened, the native splash never lifted and the app was a
 * permanent black screen with no way out but reinstalling.
 *
 * The stall was almost certainly the zustand hydration bug fixed later (a
 * mutated hasHydrated never notified React) — so the animation itself was
 * probably innocent. But preventAutoHideAsync is what turned a recoverable
 * hang into an unrecoverable one, so this version does not touch the native
 * splash at all. It renders as an overlay AFTER JS is running and dismisses
 * itself on a timer that cannot fail:
 *
 *   - no preventAutoHideAsync / hideAsync
 *   - a plain setTimeout owns dismissal, not an animation callback
 *   - if animations misbehave the overlay still disappears on schedule
 *
 * Worst realistic failure is an ugly two seconds, not a bricked launch.
 */

import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Total time the overlay is on screen. */
const DURATION_MS = 2000;
/** Fade-out length, subtracted from the tail of DURATION_MS. */
const FADE_MS = 400;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/**
 * Notes thrown off the spinning logo. Angles are spread unevenly on purpose —
 * evenly spaced looks mechanical rather than flung.
 */
const NOTES = [
  { glyph: '♪', angle: -75, distance: 150, delay: 120, size: 30 },
  { glyph: '♫', angle: -20, distance: 185, delay: 260, size: 24 },
  { glyph: '♬', angle: 35, distance: 160, delay: 400, size: 28 },
  { glyph: '♩', angle: 105, distance: 175, delay: 200, size: 22 },
  { glyph: '♪', angle: 160, distance: 195, delay: 340, size: 26 },
  { glyph: '♫', angle: 215, distance: 155, delay: 460, size: 20 },
  { glyph: '♬', angle: 260, distance: 180, delay: 300, size: 25 },
];

function FlyingNote({
  glyph,
  angle,
  distance,
  delay,
  size,
}: (typeof NOTES)[number]) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
        -1,
        false
      )
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => {
    const rad = (angle * Math.PI) / 180;
    const d = progress.value * distance;
    return {
      transform: [
        { translateX: Math.cos(rad) * d },
        { translateY: Math.sin(rad) * d },
        { scale: 0.4 + progress.value * 0.7 },
        { rotate: `${progress.value * 220}deg` },
      ],
      // Fade in fast, drift out slow.
      opacity:
        progress.value < 0.15
          ? progress.value / 0.15
          : 1 - (progress.value - 0.15) / 0.85,
    };
  });

  return (
    <Animated.Text
      style={[{ position: 'absolute', fontSize: size, color: '#6EA8FF' }, style]}
    >
      {glyph}
    </Animated.Text>
  );
}

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const spin = useSharedValue(0);
  const fade = useSharedValue(1);
  const scale = useSharedValue(0.82);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.linear }),
      -1,
      false
    );
    scale.value = withTiming(1, {
      duration: 700,
      easing: Easing.out(Easing.back(1.6)),
    });
    fade.value = withDelay(
      DURATION_MS - FADE_MS,
      withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) })
    );

    // Dismissal lives on a plain timer, NOT an animation callback. If
    // reanimated misbehaves on some device the overlay still goes away.
    const t = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(t);
  }, [spin, fade, scale, onDone]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }, { scale: scale.value }],
  }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.container, containerStyle]}
    >
      <View style={styles.stage}>
        {NOTES.map((n, i) => (
          <FlyingNote key={i} {...n} />
        ))}
        <Animated.View style={logoStyle}>
          <Image
            source={require('../assets/images/splash-icon.png')}
            style={{ width: 150, height: 150 }}
            contentFit="contain"
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Matches the native splash background in app.json so the handoff from
    // the static splash to this overlay isn't a visible flash.
    backgroundColor: '#00031C',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  stage: {
    width: SCREEN_W,
    height: SCREEN_H * 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
