import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import * as Sentry from '@sentry/react-native';
import { setAudioModeAsync } from 'expo-audio';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import 'react-native-reanimated';

import '../global.css';
import { KillSwitchBanner } from '@/components/KillSwitchBanner';
import { SpotifyWakeBanner } from '@/components/SpotifyWakeBanner';
import { SPOTIFY_ENABLED } from '@/lib/featureFlags';
import { colors } from '../theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteConfigStore } from '@/stores/remoteConfigStore';
import { useSpotifyStore } from '@/stores/spotifyStore';

// Sentry init runs at module load — before any React code. DSN is a public
// identifier (safe to commit per Sentry docs). tracesSampleRate at 1.0 for
// diagnosis; dial to 0.2 post-launch to stay under the 5K events/month
// free-tier ceiling. This code REQUIRES the @sentry/react-native native
// module to be linked into the binary — the 1.0.2 native build handles
// that. Do NOT ship this file as an OTA to a native binary older than
// 1.0.2 (the module isn't there and this call hangs the app).
Sentry.init({
  dsn: 'https://6ea860a5685b0a120d1fcca5503275e7@o4511822268858368.ingest.us.sentry.io/4511822314209280',
  enableAutoSessionTracking: true,
  tracesSampleRate: 1.0,
  attachStacktrace: true,
});

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    primary: colors.primary,
    text: colors.textPrimary,
  },
};

function RootLayout() {
  const hasHydrated = usePlaylistStore((s) => s.hasHydrated);

  // Breadcrumb: proves RootLayout mounted. If Sentry sees "app boot" but no
  // "hydration complete", the hang is in a store's onRehydrateStorage.
  useEffect(() => {
    Sentry.addBreadcrumb({ category: 'app', message: 'RootLayout mounted', level: 'info' });
  }, []);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      // 'duckOthers' = our active audio session (the silent WAV during
      // pause/scoring) lowers Spotify's volume to iOS's fixed ~20%
      // duck level. We tested 'doNotMix' for true silence — it works
      // for the silence part but Spotify becomes unreachable within
      // ~5 seconds of the interruption, forcing the wake banner on
      // every round (heartbeats at 5s cadence using transferPlayback,
      // setRepeat all 502/500'd consistently — iOS suspension or
      // Spotify Connect teardown is faster than any API ping cadence
      // can preempt). 20% is the practical sweet spot: faint enough
      // that most teams can't guess from it, smooth round transitions,
      // no banner.
      interruptionMode: 'duckOthers',
    });
  }, []);

  useEffect(() => {
    if (hasHydrated) {
      usePlaylistStore.getState().refreshMeta();
    }
  }, [hasHydrated]);

  // Kick off remote-config fetch on app launch. Fire-and-forget —
  // store seeds from AsyncStorage cache immediately and upgrades
  // asynchronously when the network responds (fails-open on any
  // network/parse error). See stores/remoteConfigStore.ts for the
  // kill-switch design.
  useEffect(() => {
    void useRemoteConfigStore.getState().initialize();
  }, []);

  // Restore any saved Spotify session from secure store. Runs once at app
  // launch; the store guards against duplicate calls. Skipped entirely when
  // Spotify is disabled at the build level — no need to touch the keychain
  // and no risk of resurfacing a stale connected state from a prior dev
  // build that had the toggle on.
  useEffect(() => {
    if (!SPOTIFY_ENABLED) return;
    useSpotifyStore.getState().restoreFromStorage();
  }, []);

  // AppState listener: when the user returns to Songnado after deep-linking
  // into Spotify (or any other reason), re-check whether Spotify now has an
  // active device. This is the back-half of the wake-up flow — the front
  // half is the SpotifyWakeBanner deep-linking out via `spotify://`. Skip
  // when Spotify is disabled — the wake banner can never appear so there's
  // nothing to re-check on foreground.
  useEffect(() => {
    if (!SPOTIFY_ENABLED) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const wakeStatus = useSpotifyStore.getState().wakeStatus;
      if (wakeStatus === 'opening' || wakeStatus === 'needs-wake') {
        void useSpotifyStore.getState().checkActiveDevice();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <ThemeProvider value={navTheme}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <KillSwitchBanner />
        {SPOTIFY_ENABLED ? <SpotifyWakeBanner /> : null}
        <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="debug" options={{ title: 'Debug jukebox' }} />
            <Stack.Screen
              name="add-playlist"
              options={{ presentation: 'modal', title: 'Add playlist' }}
            />
            <Stack.Screen
              name="game"
              options={{ title: 'Game', headerBackVisible: false }}
            />
            <Stack.Screen
              name="game-over"
              options={{ title: 'Game over', headerBackVisible: false }}
            />
            <Stack.Screen
              name="buzz/host-lobby"
              options={{ title: 'Buzz lobby (host)' }}
            />
            <Stack.Screen
              name="buzz/join"
              options={{ title: 'Join buzz game' }}
            />
            <Stack.Screen
              name="buzz/client-lobby"
              options={{ title: 'Buzz lobby', headerBackVisible: false }}
            />
            <Stack.Screen
              name="buzz/host-game"
              options={{ title: 'Buzz game', headerBackVisible: false }}
            />
            <Stack.Screen
              name="buzz/client-game"
              options={{ title: 'Buzz', headerBackVisible: false }}
            />
            <Stack.Screen
              name="setup/mode"
              options={{ title: 'New game' }}
            />
            <Stack.Screen
              name="setup/details"
              options={{ title: 'New game' }}
            />
            <Stack.Screen
              name="setup/playlists"
              options={{ title: 'New game' }}
            />
            <Stack.Screen
              name="feedback"
              options={{ title: 'Test feedback' }}
            />
          </Stack>
        </View>
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}

// Sentry.wrap adds an error boundary + navigation instrumentation to the root.
// Uncaught React tree errors get captured; navigation transitions get traced.
export default Sentry.wrap(RootLayout);
