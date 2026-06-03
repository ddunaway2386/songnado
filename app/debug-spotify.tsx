/**
 * App Remote spike screen — Evening 2 of the App Remote investigation.
 *
 * Goal: validate whether `@wwdrew/expo-spotify-sdk`'s App Remote IPC channel
 * solves Songnado's iOS-dormancy class of problems. Specifically, the spike
 * answers two scenarios:
 *
 *  - **Scenario A (the common case):** Spotify recently used, then backgrounded.
 *    Does `Player.pause()` via App Remote work IMMEDIATELY without the
 *    "Spotify needs a wake-up" dance the Web API currently requires?
 *
 *  - **Scenario B (the hard case):** Spotify untouched for hours. Does
 *    `AppRemote.connect()` hit "Connection refused (iOS code 61)" as the
 *    package README documents, or does the IPC channel re-establish silently?
 *
 * If A is reliable + B fails with a clear user-actionable error, App Remote
 * is the right investment. If A fails the same way Web API does, we pivot.
 *
 * This screen intentionally bypasses Songnado's gameplay layer — it talks
 * directly to AppRemote/Player so the spike result isn't muddied by our
 * store/router/effect logic. Hooked into the home screen via the debug links
 * row in app/index.tsx.
 */

import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  AppRemote,
  Player,
  SpotifyURI,
  useConnectionState,
} from '@wwdrew/expo-spotify-sdk';

import { useSpotifyStore } from '@/stores/spotifyStore';

// Branded SpotifyURI required by Player.play(). `from` validates the format
// before tagging; throws on malformed input. The Carly Rae Jepsen URI is
// Spotify's own tutorial example — globally available, safe for spike.
const SMOKE_URI = SpotifyURI.from('spotify:track:11dFghVXANMlKmJXsNCbNl');

export default function DebugSpotify() {
  const tokens = useSpotifyStore((s) => s.tokens);
  const status = useSpotifyStore((s) => s.status);
  const connectionState = useConnectionState();

  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<string[]>([]);

  function append(line: string) {
    const stamped = `${new Date().toISOString().slice(11, 19)}  ${line}`;
    logRef.current = [stamped, ...logRef.current].slice(0, 40);
    setLog([...logRef.current]);
  }

  // Subscribe to App Remote events. Both surfaces are interesting:
  //  - connectionStateChange tells us if the IPC channel went up/down
  //  - connectionError tells us WHY (CONNECTION_FAILED, etc.)
  useEffect(() => {
    const stateSub = AppRemote.addListener('connectionStateChange', ({ state }) => {
      append(`event connectionStateChange: ${state}`);
    });
    const errSub = AppRemote.addListener('connectionError', ({ code, message }) => {
      append(`event connectionError [${code}] ${message}`);
    });
    return () => {
      stateSub.remove();
      errSub.remove();
    };
  }, []);

  async function handleConnect() {
    if (!tokens?.accessToken) {
      append('ERROR no access token in store; connect Spotify on the home screen first');
      return;
    }
    append(`AppRemote.connect(token=...${tokens.accessToken.slice(-6)})`);
    try {
      await AppRemote.connect(tokens.accessToken);
      append('AppRemote.connect resolved (no throw)');
    } catch (err) {
      append(`AppRemote.connect threw: ${describeError(err)}`);
    }
  }

  async function handleDisconnect() {
    append('AppRemote.disconnect()');
    try {
      await AppRemote.disconnect();
      append('AppRemote.disconnect resolved');
    } catch (err) {
      append(`AppRemote.disconnect threw: ${describeError(err)}`);
    }
  }

  async function handlePlay() {
    append(`Player.play("${SMOKE_URI}")`);
    try {
      await Player.play(SMOKE_URI);
      append('Player.play resolved');
    } catch (err) {
      append(`Player.play threw: ${describeError(err)}`);
    }
  }

  async function handlePause() {
    append('Player.pause()');
    try {
      await Player.pause();
      append('Player.pause resolved');
    } catch (err) {
      append(`Player.pause threw: ${describeError(err)}`);
    }
  }

  async function handleResume() {
    append('Player.resume()');
    try {
      await Player.resume();
      append('Player.resume resolved');
    } catch (err) {
      append(`Player.resume threw: ${describeError(err)}`);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="p-4 gap-3">
        <View>
          <Text className="text-textPrimary text-2xl font-bold">App Remote spike</Text>
          <Link href="/" className="text-textMuted text-xs mt-1">
            ← back to setup
          </Link>
        </View>

        <View className="bg-surface rounded-md p-3 gap-1">
          <Row label="Spotify (Web API)" value={status} />
          <Row label="Premium" value={useSpotifyStore.getState().isPremium ? 'yes' : 'no'} />
          <Row label="Access token" value={tokens?.accessToken ? `…${tokens.accessToken.slice(-8)}` : '(none)'} />
          <Row label="App Remote IPC" value={connectionState} />
        </View>

        <View className="gap-2">
          <Pressable
            onPress={handleConnect}
            disabled={!tokens?.accessToken || connectionState === 'connected'}
            className={
              !tokens?.accessToken || connectionState === 'connected'
                ? 'bg-surface rounded-md px-4 py-3 items-center'
                : 'bg-primary active:bg-primaryHover rounded-md px-4 py-3 items-center'
            }
          >
            <Text className="text-textPrimary font-semibold">Connect App Remote</Text>
          </Pressable>
          <Pressable
            onPress={handleDisconnect}
            disabled={connectionState !== 'connected'}
            className={
              connectionState !== 'connected'
                ? 'bg-surface rounded-md px-4 py-3 items-center'
                : 'bg-surfaceAlt active:bg-surface rounded-md px-4 py-3 items-center'
            }
          >
            <Text className="text-textPrimary font-semibold">Disconnect</Text>
          </Pressable>
        </View>

        <View className="gap-2">
          <Text className="text-textMuted text-xs uppercase">Player (Cut to the Feeling)</Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={handlePlay}
              disabled={connectionState !== 'connected'}
              className={
                connectionState !== 'connected'
                  ? 'flex-1 bg-surface rounded-md px-3 py-3 items-center'
                  : 'flex-1 bg-primary active:bg-primaryHover rounded-md px-3 py-3 items-center'
              }
            >
              <Text className="text-textPrimary font-semibold">▶ Play</Text>
            </Pressable>
            <Pressable
              onPress={handlePause}
              disabled={connectionState !== 'connected'}
              className={
                connectionState !== 'connected'
                  ? 'flex-1 bg-surface rounded-md px-3 py-3 items-center'
                  : 'flex-1 bg-surfaceAlt active:bg-surface rounded-md px-3 py-3 items-center'
              }
            >
              <Text className="text-textPrimary font-semibold">⏸ Pause</Text>
            </Pressable>
            <Pressable
              onPress={handleResume}
              disabled={connectionState !== 'connected'}
              className={
                connectionState !== 'connected'
                  ? 'flex-1 bg-surface rounded-md px-3 py-3 items-center'
                  : 'flex-1 bg-surfaceAlt active:bg-surface rounded-md px-3 py-3 items-center'
              }
            >
              <Text className="text-textPrimary font-semibold">⏵ Resume</Text>
            </Pressable>
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-textMuted text-xs uppercase">Event log (latest 40)</Text>
          <View className="bg-surface rounded-md p-3">
            {log.length === 0 ? (
              <Text className="text-textMuted text-xs">No events yet. Hit Connect.</Text>
            ) : (
              log.map((line, i) => (
                <Text key={i} className="text-textPrimary text-xs font-mono">
                  {line}
                </Text>
              ))
            )}
          </View>
        </View>

        <View className="bg-surface border border-border rounded-md p-3 gap-1">
          <Text className="text-textMuted text-xs uppercase">Scenarios to test</Text>
          <Text className="text-textPrimary text-xs">
            A) Open Spotify, play a song, pause. Switch here. Connect → Play → Pause.
            Pause should be INSTANT (this is the win we are hoping for).
          </Text>
          <Text className="text-textPrimary text-xs mt-1">
            B) Leave Spotify untouched for hours. Switch here. Connect.
            Documented to fail with CONNECTION_FAILED / code 61.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-textMuted text-xs">{label}</Text>
      <Text className="text-textPrimary text-xs font-mono">{value}</Text>
    </View>
  );
}

function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string };
    if (e.code || e.message) return `[${e.code ?? 'no-code'}] ${e.message ?? 'no-message'}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
