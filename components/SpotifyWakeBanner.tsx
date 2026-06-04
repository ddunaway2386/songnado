/**
 * Spotify wake-up banner.
 *
 * Surfaces when our Spotify Connect session has no active device — either
 * because Spotify was never opened this session, or it went dormant after
 * the user backgrounded it. Per Spotify's documented application-lifecycle
 * guidance (https://developer.spotify.com/documentation/ios/concepts/application-lifecycle),
 * the canonical UX is a "Resume Playback" / "Open Spotify" button — not a
 * silent failure or auto-recovery (which the Web API can't reliably do
 * once iOS has suspended Spotify).
 *
 * Flow:
 *  1. `gameStore.pickPlaylistForRound` (and skipCurrentSong) call
 *     `spotifyStore.checkActiveDevice()` before attempting playback.
 *  2. `withDeviceRecovery` also calls `signalWakeNeeded()` when its
 *     auto-recovery exhausts.
 *  3. Either path flips `wakeStatus → 'needs-wake'`, which renders this banner.
 *  4. User taps "Open Spotify" → `wakeSpotify()` deep-links via `spotify://`.
 *  5. When the user returns, `_layout.tsx`'s AppState listener re-runs
 *     `checkActiveDevice()` and clears the banner.
 */

import { useEffect, useRef } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useSpotifyStore } from '@/stores/spotifyStore';

export function SpotifyWakeBanner() {
  const wakeStatus = useSpotifyStore((s) => s.wakeStatus);
  const wakeSpotify = useSpotifyStore((s) => s.wakeSpotify);
  const checkActiveDevice = useSpotifyStore((s) => s.checkActiveDevice);

  // While we're in 'opening' (user is over in Spotify), poll periodically as
  // a backup to the AppState foreground listener. Some Android/iOS launchers
  // re-foreground us without firing a clean 'active' event.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (wakeStatus === 'opening') {
      pollRef.current = setInterval(() => {
        void checkActiveDevice();
      }, 2500);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [wakeStatus, checkActiveDevice]);

  if (wakeStatus === 'idle') return null;

  const isOpening = wakeStatus === 'opening';

  return (
    <View className="bg-surface border-b border-border px-4 py-3 gap-2">
      <Text className="text-textPrimary font-semibold text-sm">
        {isOpening ? 'Waiting for Spotify…' : 'Spotify needs a wake-up'}
      </Text>
      <Text className="text-textMuted text-xs">
        {isOpening
          ? 'In Spotify, tap Play on any song and let it play for a few seconds (don’t pause). Then come back — Songnado will continue automatically.'
          : 'Open Spotify and let any song play for a few seconds — Spotify drops the connection if you pause right away.'}
      </Text>
      <Pressable
        onPress={() => {
          void wakeSpotify().catch(() => {
            Alert.alert(
              'Could not open Spotify',
              'Make sure the Spotify app is installed on this device.'
            );
          });
        }}
        className="bg-primary active:bg-primaryHover rounded-md px-4 py-2 items-center self-start"
      >
        <Text className="text-textPrimary font-semibold text-sm">
          {isOpening ? 'Re-open Spotify' : 'Open Spotify'}
        </Text>
      </Pressable>
    </View>
  );
}
