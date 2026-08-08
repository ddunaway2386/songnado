/**
 * Animated splash — notes spiralling off the logo.
 *
 * DESIGN NOTE, after two failed attempts at literally spinning the tornado:
 *
 *   1. Rotating the image about Z made it cartwheel like a wheel.
 *   2. Orbiting streaks around a static logo just looked like straight lines
 *      circling a static logo, because that's what it was.
 *
 * A tornado's silhouette is near-symmetric about its vertical axis, so no
 * transform of a flat PNG will read as "the funnel is spinning". Genuinely
 * animating it needs either pre-rendered frames or a shader — real artwork
 * and a native dependency, which is not worth it for a two-second moment.
 *
 * So this stops trying to show rotation and instead IMPLIES it: notes leave
 * on curved, spiralling paths. Curvature reads as centrifugal force, so the
 * eye infers a spin that never has to be drawn. The logo just scales in with
 * a little overshoot and holds — confident rather than fidgeting.
 *
 * SAFETY (unchanged, and the important part): this never touches the native
 * splash. The first version called SplashScreen.preventAutoHideAsync() at
 * module load and depended on this component mounting to undo it — when
 * anything stalled first, the app was a permanent black screen. Here the
 * overlay renders after JS is running and dismissal is owned by a plain
 * setTimeout, not an animation callback. Worst realistic failure is a couple
 * of ugly seconds.
 */

import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

const DURATION_MS = 2300;
const FADE_MS = 450;
const LOGO_SIZE = 160;

/**
 * Each note flies out along a curve. `sweep` is how many degrees it arcs
 * while travelling — that bend is what implies the spin. Uneven start angles
 * and delays keep it from looking mechanical.
 */
const NOTES = [
  { glyph: '♪', start: -80, sweep: 55, distance: 165, delay: 0, size: 30 },
  { glyph: '♫', start: -25, sweep: 70, distance: 195, delay: 170, size: 24 },
  { glyph: '♬', start: 30, sweep: 45, distance: 150, delay: 340, size: 27 },
  { glyph: '♩', start: 95, sweep: 65, distance: 185, delay: 110, size: 22 },
  { glyph: '♪', start: 150, sweep: 50, distance: 205, delay: 420, size: 26 },
  { glyph: '♫', start: 205, sweep: 75, distance: 160, delay: 250, size: 21 },
  { glyph: '♬', start: 255, sweep: 60, distance: 190, delay: 500, size: 25 },
  { glyph: '♪', start: 310, sweep: 50, distance: 170, delay: 60, size: 23 },
];

function SpiralNote({
  glyph,
  start,
  sweep,
  distance,
  delay,
  size,
}: (typeof NOTES)[number]) {
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }),
        -1,
        false
      )
    );
  }, [delay, p]);

  const style = useAnimatedStyle(() => {
    // Angle advances as the note travels — a spiral, not a straight ray.
    const deg = start + p.value * sweep;
    const rad = (deg * Math.PI) / 180;
    // Ease the radius so notes leave fast then coast, like something flung.
    const d = p.value * distance;

    return {
      transform: [
        { translateX: Math.cos(rad) * d },
        { translateY: Math.sin(rad) * d },
        { scale: 0.35 + p.value * 0.75 },
        { rotate: `${p.value * 260}deg` },
      ],
      opacity:
        p.value < 0.12
          ? p.value / 0.12
          : Math.max(0, 1 - (p.value - 0.12) / 0.88),
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
  const fade = useSharedValue(1);
  const scale = useSharedValue(0.7);
  const logoIn = useSharedValue(0);

  useEffect(() => {
    logoIn.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    scale.value = withTiming(1, {
      duration: 850,
      easing: Easing.out(Easing.back(2)),
    });
    fade.value = withDelay(
      DURATION_MS - FADE_MS,
      withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) })
    );

    // Dismissal on a plain timer, NOT an animation callback.
    const timer = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(timer);
  }, [fade, scale, logoIn, onDone]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: logoIn.value,
  }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.container, containerStyle]}
    >
      <View style={styles.stage}>
        {NOTES.map((n, i) => (
          <SpiralNote key={i} {...n} />
        ))}
        <Animated.View style={logoStyle}>
          <Image
            source={require('../assets/images/splash-icon.png')}
            style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
            contentFit="contain"
          />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Matches the native splash background in app.json so the handoff isn't
    // a visible flash.
    backgroundColor: '#00031C',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  stage: {
    width: LOGO_SIZE * 3,
    height: LOGO_SIZE * 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
