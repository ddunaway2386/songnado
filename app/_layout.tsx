import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import 'react-native-reanimated';

import '../global.css';
import { SpotifyWakeBanner } from '@/components/SpotifyWakeBanner';
import { SPOTIFY_ENABLED } from '@/lib/featureFlags';
import { colors } from '../theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSpotifyStore } from '@/stores/spotifyStore';

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

export default function RootLayout() {
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
          </Stack>
        </View>
      </View>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
