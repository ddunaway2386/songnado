/**
 * Home screen.
 *
 * Deliberately thin. This file used to be ~690 lines: the entire pre-wizard
 * setup flow (game mode, turn style, hot streak, team count, target score,
 * playlist picker, Spotify section) with a "New Game" button bolted on top
 * that routed to the wizard which does all of the same things. Two sources
 * of truth for the same settings, and the one people actually used was the
 * wizard.
 *
 * A home screen should do three things: say what the app is, start a game,
 * and let a guest join one. Everything else belongs in the flow it's part of.
 */

import * as Sentry from '@sentry/react-native';
import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@/components/AnimatedSplash';
import { SpotifySection } from '@/components/SpotifySection';
import { SPOTIFY_ENABLED, TEST_TOOLS_ENABLED } from '@/lib/featureFlags';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSetupStore } from '@/stores/setupStore';

/**
 * Show the animated splash once per app launch, not on every visit back to
 * the home screen — a module-level flag rather than component state, which
 * would reset on each mount.
 */
let splashShownThisLaunch = false;

export default function HomeScreen() {
  const hasPlaylistsHydrated = usePlaylistStore((s) => s.hasHydrated);
  const hasSetupHydrated = useSetupStore((s) => s.hasHydrated);

  const [showSplash, setShowSplash] = useState(!splashShownThisLaunch);

  function dismissSplash() {
    splashShownThisLaunch = true;
    setShowSplash(false);
  }

  if (!hasPlaylistsHydrated || !hasSetupHydrated) {
    return (
      <HydrationGate
        playlistsHydrated={hasPlaylistsHydrated}
        setupHydrated={hasSetupHydrated}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 justify-between">
        {/* Wordmark */}
        <View className="items-center pt-16">
          <Image
            source={require('../assets/images/splash-icon.png')}
            style={{ width: 120, height: 120 }}
            contentFit="contain"
          />
          <Text className="text-textPrimary text-5xl font-extrabold mt-4">
            Songnado
          </Text>
          <Text className="text-textMuted text-base mt-2">
            Music trivia for your next party
          </Text>
        </View>

        {/* Actions */}
        <View className="gap-3 pb-2">
          <Pressable
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
            onPress={() => router.push('/setup/mode' as any)}
            className="rounded-xl px-4 py-6 items-center bg-primary active:bg-primaryHover"
          >
            <Text className="text-white text-2xl font-bold">New Game</Text>
            <Text className="text-white/80 text-xs mt-1">
              Classic · Blitz · Elimination · Buzz
            </Text>
          </Pressable>

          <Pressable
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
            onPress={() => router.push('/buzz/join' as any)}
            className="rounded-xl px-4 py-4 items-center bg-surface active:bg-surfaceAlt border border-border"
          >
            <Text className="text-textPrimary text-base font-semibold">
              Join a Buzz Game
            </Text>
            <Text className="text-textMuted text-xs mt-1">
              Enter the host&apos;s room code
            </Text>
          </Pressable>

          {/* Spotify connect. Invisible in production (SPOTIFY_ENABLED is
              false and Metro strips the branch), but Daniel's personal dev
              builds run with the flag on — this is the only entry point to
              the connect flow, so removing it would quietly break that. */}
          {SPOTIFY_ENABLED ? <SpotifySection /> : null}

          {/* Internal curation tooling. Never in a public build — a
              reviewer following our own reviewer notes would land on these
              within a minute (Guideline 2.2), and the second one shows a raw
              route path to the user. */}
          {TEST_TOOLS_ENABLED ? (
          <View className="flex-row justify-center gap-5 pt-2">
            <Link href="/debug" className="text-textMuted text-xs">
              debug jukebox
            </Link>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start */}
            <Link href={'/feedback' as any} className="text-textMuted text-xs">
              test feedback
            </Link>
          </View>
          ) : null}
        </View>
      </View>

      {showSplash ? <AnimatedSplash onDone={dismissSplash} /> : null}
    </SafeAreaView>
  );
}

/**
 * Pre-hydration gate with a watchdog.
 *
 * Normally this shows for a few frames while the persisted stores load.
 * The watchdog exists because a hydration stall here is catastrophic and
 * invisible: the app sits on this spinner forever with no error, and the
 * only user-side escape is deleting and reinstalling. That exact failure
 * cost three days of debugging — a store finished hydrating in 40ms but
 * flipped its flag by mutating state, which zustand doesn't broadcast, so
 * React never re-rendered (fixed in both stores; see their
 * onRehydrateStorage comments).
 *
 * If hydration hasn't completed after HYDRATION_TIMEOUT_MS, force the
 * flags true and report to Sentry. Worst case the user gets default
 * settings for that launch instead of a bricked app.
 */
const HYDRATION_TIMEOUT_MS = 8000;

function HydrationGate({
  playlistsHydrated,
  setupHydrated,
}: {
  playlistsHydrated: boolean;
  setupHydrated: boolean;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      const stuck = [
        playlistsHydrated ? null : 'playlists',
        setupHydrated ? null : 'setup',
      ].filter(Boolean);
      if (stuck.length === 0) return;
      Sentry.captureMessage(
        `Hydration watchdog fired after ${HYDRATION_TIMEOUT_MS}ms: ${stuck.join(', ')} never hydrated`,
        'error'
      );
      if (!playlistsHydrated) usePlaylistStore.setState({ hasHydrated: true });
      if (!setupHydrated) useSetupStore.setState({ hasHydrated: true });
    }, HYDRATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [playlistsHydrated, setupHydrated]);

  return (
    <SafeAreaView className="flex-1 bg-bg items-center justify-center">
      <ActivityIndicator />
    </SafeAreaView>
  );
}
