/**
 * Animated splash — the logo's tornado appearing to spin, with notes flung off.
 *
 * WHY IT'S BUILT THIS WAY
 *
 * The obvious approach — rotate the logo image — is wrong twice over. `rotate`
 * spins about the Z axis, so the artwork cartwheels like a wheel rather than
 * swirling. And switching to `rotateY` doesn't help much either: a tornado's
 * silhouette is roughly symmetric about its vertical axis, so turning the
 * shape barely changes what you see (and a flat image mirrors as it passes
 * 90 degrees).
 *
 * What actually reads as "spinning" is motion AROUND the funnel, not the
 * funnel moving. So the logo is held still and the swirl comes from streaks
 * orbiting it on elliptical paths — wide near the top of the cone, tight near
 * the bottom, dimming and shrinking as they pass behind. Depth cues do the
 * work your eye reads as rotation.
 *
 * SAFETY NOTE, because this is the second attempt at a splash. The first
 * version (7655ed6, reverted in a137f30) called
 * SplashScreen.preventAutoHideAsync() at module load and relied on this
 * component mounting to call hideAsync(). Anything that stalled beforehand
 * left the native splash up forever — black screen, no escape but
 * reinstalling. That stall was almost certainly the zustand hydration bug
 * fixed later, so the animation was probably innocent, but
 * preventAutoHideAsync is what made a recoverable hang unrecoverable.
 *
 * This version never touches the native splash. It renders as an overlay once
 * JS is running, and dismissal is owned by a plain setTimeout rather than an
 * animation callback — if reanimated misbehaves the overlay still leaves on
 * schedule. Worst realistic failure is two ugly seconds.
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

/** Total time the overlay is on screen. */
const DURATION_MS = 2400;
/** Fade-out length, subtracted from the tail of DURATION_MS. */
const FADE_MS = 450;

const LOGO_SIZE = 150;

/**
 * Orbit rings around the funnel. A tornado is wide at the top and tapers
 * down, so radius shrinks and speed increases as `y` descends — the tight
 * bottom of a vortex whips faster than the broad top.
 *
 *   y       vertical offset from logo centre (negative = up)
 *   rx/ry   ellipse radii; ry small = viewed from slightly above
 *   count   streaks evenly spaced around this ring
 *   ms      one full revolution
 */
const RINGS = [
  { y: -46, rx: 62, ry: 15, count: 5, ms: 2600, size: 9, phase: 0 },
  { y: -14, rx: 50, ry: 12, count: 4, ms: 2100, size: 8, phase: 0.35 },
  { y: 16, rx: 36, ry: 9, count: 4, ms: 1700, size: 7, phase: 0.6 },
  { y: 44, rx: 22, ry: 6, count: 3, ms: 1300, size: 6, phase: 0.15 },
];

/** One streak riding an elliptical orbit. */
function Streak({
  ring,
  index,
}: {
  ring: (typeof RINGS)[number];
  index: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: ring.ms, easing: Easing.linear }),
      -1,
      false
    );
  }, [ring.ms, t]);

  const style = useAnimatedStyle(() => {
    // Even spacing around the ring, offset per-ring so they don't align.
    const turn = t.value + index / ring.count + ring.phase;
    const a = turn * Math.PI * 2;
    const x = Math.cos(a) * ring.rx;
    const y = Math.sin(a) * ring.ry;

    // sin(a) > 0 is the near side of the orbit. Front streaks are bigger,
    // brighter and drawn over the logo; back streaks shrink and dim behind
    // it. That depth difference is what sells the rotation.
    const front = (Math.sin(a) + 1) / 2;

    return {
      transform: [
        { translateX: x },
        { translateY: ring.y + y },
        { scaleX: 0.6 + front * 0.9 },
        { scaleY: 0.6 + front * 0.5 },
      ],
      opacity: 0.18 + front * 0.72,
      zIndex: front > 0.5 ? 2 : 0,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: ring.size * 2.6,
          height: ring.size * 0.62,
          borderRadius: ring.size,
          backgroundColor: '#7FB4FF',
        },
        style,
      ]}
    />
  );
}

/**
 * Notes thrown clear of the vortex. Angles are uneven on purpose — evenly
 * spaced reads as mechanical rather than flung.
 */
const NOTES = [
  { glyph: '♪', angle: -78, distance: 155, delay: 150, size: 30 },
  { glyph: '♫', angle: -18, distance: 190, delay: 320, size: 24 },
  { glyph: '♬', angle: 38, distance: 165, delay: 480, size: 28 },
  { glyph: '♩', angle: 108, distance: 180, delay: 240, size: 22 },
  { glyph: '♪', angle: 158, distance: 200, delay: 400, size: 26 },
  { glyph: '♫', angle: 214, distance: 160, delay: 540, size: 20 },
  { glyph: '♬', angle: 262, distance: 185, delay: 360, size: 25 },
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
        withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }),
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
        { rotate: `${progress.value * 200}deg` },
      ],
      opacity:
        progress.value < 0.15
          ? progress.value / 0.15
          : 1 - (progress.value - 0.15) / 0.85,
    };
  });

  return (
    <Animated.Text
      style={[
        { position: 'absolute', fontSize: size, color: '#6EA8FF', zIndex: 3 },
        style,
      ]}
    >
      {glyph}
    </Animated.Text>
  );
}

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const fade = useSharedValue(1);
  const scale = useSharedValue(0.84);
  const bob = useSharedValue(0);

  useEffect(() => {
    scale.value = withTiming(1, {
      duration: 750,
      easing: Easing.out(Easing.back(1.5)),
    });
    // The logo itself stays upright — a gentle bob keeps it from looking
    // pasted on while the orbiting streaks carry the sense of spin.
    bob.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    fade.value = withDelay(
      DURATION_MS - FADE_MS,
      withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) })
    );

    // Dismissal lives on a plain timer, NOT an animation callback.
    const timer = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(timer);
  }, [fade, scale, bob, onDone]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: -3 + bob.value * 6 },
    ],
  }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.container, containerStyle]}
    >
      <View style={styles.stage}>
        {RINGS.map((ring, ri) =>
          Array.from({ length: ring.count }, (_, i) => (
            <Streak key={`${ri}-${i}`} ring={ring} index={i} />
          ))
        )}

        <Animated.View style={[logoStyle, { zIndex: 1 }]}>
          <Image
            source={require('../assets/images/splash-icon.png')}
            style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
            contentFit="contain"
          />
        </Animated.View>

        {NOTES.map((n, i) => (
          <FlyingNote key={i} {...n} />
        ))}
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
