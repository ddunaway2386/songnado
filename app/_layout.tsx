import { DarkTheme, ThemeProvider } from '@react-navigation/native';
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

// Sentry init is disabled at runtime until the 1.0.2 native build ships
// with the @sentry/react-native native module linked. Calling Sentry.init()
// here from an OTA bundle on a native binary that lacks the module hangs
// the app at module load (this bug caused the migration OTA "hang" saga on
// 1.0.1 — see rollback commits). Re-enable when we do the Aug-1 native
// rebuild: uncomment the import + init block below and Sentry.wrap on
// the default export.
//
// import * as Sentry from '@sentry/react-native';
// Sentry.init({
//   dsn: 'https://6ea860a5685b0a120d1fcca5503275e7@o4511822268858368.ingest.us.sentry.io/4511822314209280',
//   enableAutoSessionTracking: true,
//   tracesSampleRate: 1.0,
//   attachStacktrace: true,
// });

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

// Sentry.wrap disabled — re-enable alongside the Sentry.init block above
// once the 1.0.2 native build with the Sentry native module has shipped.
// export default Sentry.wrap(RootLayout);
export default RootLayout;
