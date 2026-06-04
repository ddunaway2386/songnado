import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import 'react-native-reanimated';

import '../global.css';
import { SpotifyWakeBanner } from '@/components/SpotifyWakeBanner';
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
      // Audio-interruption mode. 'doNotMix' = when our app's audio
      // session is active (the silent WAV during scoring), iOS treats it
      // as an interruption (same protocol Waze uses for voice prompts),
      // which fully pauses Spotify's audio rather than just ducking it
      // to 20%. iOS treats interruption-paused apps differently from
      // user-paused ones for suspension purposes — Spotify is expected
      // to resume when the interruption ends, so iOS keeps it warmer.
      // Net result: true silence during scoring, Spotify still alive
      // for skipToNext on the next round.
      interruptionMode: 'doNotMix',
    });
  }, []);

  useEffect(() => {
    if (hasHydrated) {
      usePlaylistStore.getState().refreshMeta();
    }
  }, [hasHydrated]);

  // Restore any saved Spotify session from secure store. Runs once at app
  // launch; the store guards against duplicate calls.
  useEffect(() => {
    useSpotifyStore.getState().restoreFromStorage();
  }, []);

  // AppState listener: when the user returns to Songnado after deep-linking
  // into Spotify (or any other reason), re-check whether Spotify now has an
  // active device. This is the back-half of the wake-up flow — the front
  // half is the SpotifyWakeBanner deep-linking out via `spotify://`.
  useEffect(() => {
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
        <SpotifyWakeBanner />
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
