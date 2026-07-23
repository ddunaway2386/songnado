/**
 * Animated splash screen — the JS-rendered follow-up to the native
 * splash. The native splash (via expo-splash-screen) shows a static
 * icon on #00031C while React Native boots. We call preventAutoHideAsync
 * at module load and manually hideAsync() the moment this component
 * mounts, so the transition is seamless: the user sees the same logo
 * on the same background continuously, and then it starts moving.
 *
 * Motion budget is ~1.8 seconds total:
 *  - 0.0-0.4s: fade + scale-in (spring-ish easing)
 *  - 0.0-∞:   continuous slow spin of the vinyl-tornado (linear, 8s/rev)
 *  - 0.4-1.4s: gentle glow pulse (breathing scale 1.0 ↔ 1.03)
 *  - 1.4-1.8s: fade out and call onFinish → parent unmounts us
 *
 * Auto-hides itself. Parent renders it as an absolute-positioned overlay
 * above the app Stack; when onFinish fires, parent flips a flag and this
 * unmounts, revealing the home screen underneath.
 */

import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// Match the native splash exactly so the handoff is seamless.
const BG_COLOR = '#00031C';
const LOGO_SIZE = 220;

const FADE_IN_MS = 400;
const HOLD_MS = 1000;
const FADE_OUT_MS = 400;
const SPIN_MS = 8000;
const PULSE_MS = 1400;

interface Props {
  onFinish: () => void;
}

export function AnimatedSplash({ onFinish }: Props) {
  const opacity = useSharedValue(0);
  const enterScale = useSharedValue(0.88);
  const pulseScale = useSharedValue(1);
  const spin = useSharedValue(0);

  useEffect(() => {
    // Hide the native splash the moment this component mounts.
    // Wrapped in Promise.resolve so any error (e.g. already hidden)
    // doesn't crash render.
    SplashScreen.hideAsync().catch(() => {
      /* already hidden — fine */
    });

    // Fade + scale-in
    opacity.value = withTiming(1, { duration: FADE_IN_MS });
    enterScale.value = withTiming(1, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });

    // Continuous slow spin (linear, seamless loop)
    spin.value = withRepeat(
      withTiming(1, { duration: SPIN_MS, easing: Easing.linear }),
      -1, // infinite
      false
    );

    // Gentle breathing pulse (scale 1.0 ↔ 1.03)
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );

    // Auto-dismiss after the hold. Fade out, then unmount via onFinish.
    const t = setTimeout(() => {
      opacity.value = withTiming(
        0,
        { duration: FADE_OUT_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onFinish)();
        }
      );
    }, FADE_IN_MS + HOLD_MS);

    return () => clearTimeout(t);
  }, [onFinish, opacity, enterScale, pulseScale, spin]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: enterScale.value * pulseScale.value },
      { rotate: `${spin.value * 360}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <View style={styles.logoWrap}>
        <Animated.Image
          source={require('../assets/images/splash-icon.png')}
          style={[styles.logo, logoStyle]}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
    // Cover status bar and everything else. Above the Stack.
    zIndex: 9999,
  },
  logoWrap: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
