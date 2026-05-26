import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Song } from '@/lib/types';
import { usePlaylistStore } from '@/stores/playlistStore';

const PREVIEW_DURATION_S = 30;

type TrackState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; song: Song; playlistName: string; attempts: number };

export default function Jukebox() {
  const [track, setTrack] = useState<TrackState>({ kind: 'idle' });
  const [lastPlayedSeconds, setLastPlayedSeconds] = useState<number | null>(null);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const playlists = usePlaylistStore((s) => s.playlists);
  const didReset = usePlaylistStore((s) => s.didReset);
  const hasHydrated = usePlaylistStore((s) => s.hasHydrated);
  const fetchNextPlayableTrack = usePlaylistStore((s) => s.fetchNextPlayableTrack);
  const clearDidReset = usePlaylistStore((s) => s.clearDidReset);
  const resetPlaylist = usePlaylistStore((s) => s.resetPlaylist);

  const elapsedCappedSeconds = Math.min(
    PREVIEW_DURATION_S,
    Math.floor(status.currentTime ?? 0)
  );

  const finishedRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !finishedRef.current) {
      finishedRef.current = true;
      setLastPlayedSeconds(PREVIEW_DURATION_S);
    }
  }, [status.didJustFinish]);

  useEffect(() => {
    if (didReset) {
      const t = setTimeout(() => clearDidReset(), 2000);
      return () => clearTimeout(t);
    }
  }, [didReset, clearDidReset]);

  async function loadAndPlay(playlistId: string, playlistName: string) {
    player.pause();
    setLastPlayedSeconds(null);
    finishedRef.current = false;
    setTrack({ kind: 'loading' });
    try {
      const result = await fetchNextPlayableTrack(playlistId);
      if (!result) {
        setTrack({
          kind: 'error',
          message: 'Could not find a track with a preview after 10 attempts',
        });
        return;
      }
      setTrack({
        kind: 'ready',
        song: result.song,
        playlistName,
        attempts: result.attempts,
      });
      player.replace(result.song.previewUrl);
      player.seekTo(0);
      player.play();
    } catch (e) {
      setTrack({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  function stop() {
    if (!status.playing) return;
    player.pause();
    setLastPlayedSeconds(elapsedCappedSeconds);
  }

  if (!hasHydrated) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="p-4 gap-3">
        <Text className="text-textPrimary text-2xl font-bold">Jukebox</Text>
        <Text className="text-textMuted">
          Phase 3: audio playback with 10× null-preview retry and a capped 30s timer.
        </Text>

        {didReset ? (
          <View className="bg-accent rounded-md px-3 py-2">
            <Text className="text-bg font-semibold">🔄 Playlist started over</Text>
          </View>
        ) : null}

        <TimerBar
          elapsed={elapsedCappedSeconds}
          playing={status.playing}
          buffering={status.isBuffering}
        />

        <NowPlaying track={track} lastPlayedSeconds={lastPlayedSeconds} />

        <View className="flex-row gap-2">
          <Pressable
            className="flex-1 bg-surfaceAlt active:bg-surface rounded-md px-4 py-3 items-center"
            disabled={!status.playing}
            onPress={stop}
          >
            <Text
              className={
                status.playing ? 'text-textPrimary font-semibold' : 'text-textMuted'
              }
            >
              Stop
            </Text>
          </Pressable>
        </View>

        <Text className="text-textMuted text-xs uppercase mt-2">Playlists</Text>
        <View className="gap-2">
          {playlists.map((p) => (
            <View key={p.id} className="flex-row gap-2">
              <Pressable
                className="flex-1 bg-primary active:bg-primaryHover rounded-md px-4 py-3"
                onPress={() => loadAndPlay(p.id, p.name)}
              >
                <Text className="text-textPrimary font-semibold">{p.name}</Text>
                <Text className="text-textPrimary/70 text-xs">
                  {p.playedIndices.length} / {p.totalTracks} played
                </Text>
              </Pressable>
              <Pressable
                className="bg-surfaceAlt active:bg-surface rounded-md px-3 py-3 justify-center"
                onPress={() => resetPlaylist(p.id)}
              >
                <Text className="text-textMuted text-xs">reset</Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TimerBar({
  elapsed,
  playing,
  buffering,
}: {
  elapsed: number;
  playing: boolean;
  buffering: boolean;
}) {
  const pct = (elapsed / PREVIEW_DURATION_S) * 100;
  return (
    <View className="gap-1">
      <View className="flex-row justify-between">
        <Text className="text-textMuted text-xs">
          {playing ? 'Playing' : buffering ? 'Buffering' : 'Paused'}
        </Text>
        <Text className="text-textMuted text-xs">
          {elapsed}s / {PREVIEW_DURATION_S}s
        </Text>
      </View>
      <View className="h-2 bg-surface rounded-full overflow-hidden">
        <View
          className="h-full bg-primary"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </View>
    </View>
  );
}

function NowPlaying({
  track,
  lastPlayedSeconds,
}: {
  track: TrackState;
  lastPlayedSeconds: number | null;
}) {
  if (track.kind === 'idle') {
    return (
      <View className="bg-surface rounded-lg p-4">
        <Text className="text-textMuted">Tap a playlist to start.</Text>
      </View>
    );
  }

  if (track.kind === 'loading') {
    return (
      <View className="bg-surface rounded-lg p-4 items-center">
        <ActivityIndicator />
        <Text className="text-textMuted text-xs mt-2">Searching for a playable track…</Text>
      </View>
    );
  }

  if (track.kind === 'error') {
    return (
      <View className="bg-surface border border-danger rounded-lg p-4">
        <Text className="text-danger font-semibold">Error</Text>
        <Text className="text-textPrimary mt-1">{track.message}</Text>
      </View>
    );
  }

  return (
    <View className="bg-surface rounded-lg p-4 gap-2">
      <Text className="text-textMuted text-xs">
        {track.playlistName.toUpperCase()}
        {track.attempts > 1 ? `  ·  ${track.attempts} tries` : ''}
      </Text>
      <Image
        source={{ uri: track.song.coverUrl }}
        style={{ width: 200, height: 200, borderRadius: 10 }}
        contentFit="cover"
      />
      <Text className="text-textPrimary text-lg font-semibold">{track.song.title}</Text>
      <Text className="text-textMuted">{track.song.artist}</Text>
      {lastPlayedSeconds != null ? (
        <Text className="text-accent text-xs mt-1">
          lastPlayedSeconds = {lastPlayedSeconds}
        </Text>
      ) : null}
    </View>
  );
}
