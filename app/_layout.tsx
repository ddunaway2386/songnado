import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import '../global.css';
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

  return (
    <ThemeProvider value={navTheme}>
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
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
