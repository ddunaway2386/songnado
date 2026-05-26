import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SpotifySection } from '@/components/SpotifySection';
import { targetScoreBounds } from '@/lib/scoring';
import type { GameMode, Playlist } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { MAX_TEAMS, MIN_TEAMS, useSetupStore } from '@/stores/setupStore';

const GAME_MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Flat 3 / 1 / 0 — first to the target score wins' },
  { id: 'blitz', label: 'Blitz', hint: 'Speed bonus: points × seconds left on the 30s clock' },
  { id: 'elimination', label: 'Elimination', hint: 'Clear every playlist to win — steals allowed' },
];

export default function SetupScreen() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const hasPlaylistsHydrated = usePlaylistStore((s) => s.hasHydrated);

  const teamCount = useSetupStore((s) => s.teamCount);
  const teamNames = useSetupStore((s) => s.teamNames);
  const targetScore = useSetupStore((s) => s.targetScore);
  const gameMode = useSetupStore((s) => s.gameMode);
  const selectedPlaylistIds = useSetupStore((s) => s.selectedPlaylistIds);
  const hasSetupHydrated = useSetupStore((s) => s.hasHydrated);
  const setTeamCount = useSetupStore((s) => s.setTeamCount);
  const setTeamName = useSetupStore((s) => s.setTeamName);
  const setTargetScore = useSetupStore((s) => s.setTargetScore);
  const setGameMode = useSetupStore((s) => s.setGameMode);
  const togglePlaylist = useSetupStore((s) => s.togglePlaylist);
  const setSelectedPlaylists = useSetupStore((s) => s.setSelectedPlaylists);

  // Default to all playlists selected — but only once per mount, so "Clear" stays cleared.
  const defaultAppliedRef = useRef(false);
  useEffect(() => {
    if (
      !defaultAppliedRef.current &&
      hasPlaylistsHydrated &&
      hasSetupHydrated &&
      playlists.length > 0
    ) {
      defaultAppliedRef.current = true;
      if (selectedPlaylistIds.length === 0) {
        setSelectedPlaylists(playlists.map((p) => p.id));
      }
    }
  }, [hasPlaylistsHydrated, hasSetupHydrated, playlists, selectedPlaylistIds.length, setSelectedPlaylists]);

  const startGameAction = useGameStore((s) => s.startGame);
  const canStart = selectedPlaylistIds.length > 0 && teamCount >= MIN_TEAMS;

  function startGame() {
    if (!canStart) return;
    startGameAction({
      teamNames: teamNames.slice(0, teamCount),
      selectedPlaylistIds,
      gameMode,
      targetScore,
    });
    router.push('/game');
  }

  if (!hasPlaylistsHydrated || !hasSetupHydrated) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerClassName="p-4 gap-6">
        <View>
          <Text className="text-textPrimary text-3xl font-bold">Songnado</Text>
          <Link href="/debug" className="text-textMuted text-xs mt-1">
            → debug jukebox
          </Link>
        </View>

        <Section title="Game mode">
          <View className="gap-2">
            {GAME_MODES.map((m) => {
              const active = gameMode === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setGameMode(m.id)}
                  className={`rounded-md px-4 py-3 border ${
                    active
                      ? 'bg-primary border-primary'
                      : 'bg-surface border-border active:bg-surfaceAlt'
                  }`}
                >
                  <Text className="text-textPrimary font-semibold">{m.label}</Text>
                  <Text className={active ? 'text-textPrimary/80 text-xs' : 'text-textMuted text-xs'}>
                    {m.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section title={`Teams (${teamCount})`}>
          <View className="flex-row items-center gap-3">
            <Stepper
              value={teamCount}
              min={MIN_TEAMS}
              max={MAX_TEAMS}
              onChange={setTeamCount}
            />
            <Text className="text-textMuted text-xs">1–{MAX_TEAMS}</Text>
          </View>
          <View className="gap-2 mt-1">
            {teamNames.map((name, i) => (
              <TextInput
                key={i}
                value={name}
                onChangeText={(v) => setTeamName(i, v)}
                placeholder={`Team ${i + 1}`}
                placeholderTextColor="#6B6B78"
                className="bg-surface text-textPrimary rounded-md px-3 py-3 border border-border"
              />
            ))}
          </View>
        </Section>

        {gameMode !== 'elimination' ? (() => {
          const bounds = targetScoreBounds(gameMode);
          return (
            <Section title={`Target score: ${targetScore}`}>
              <Stepper
                value={targetScore}
                min={bounds.min}
                max={bounds.max}
                step={bounds.step}
                onChange={setTargetScore}
              />
              <Text className="text-textMuted text-xs">
                {bounds.min}–{bounds.max}, step {bounds.step}
              </Text>
            </Section>
          );
        })() : null}

        <SpotifySection />

        <Section
          title={`Playlists (${selectedPlaylistIds.length}/${playlists.length})`}
          right={
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setSelectedPlaylists(playlists.map((p) => p.id))}
                className="px-2 py-1"
              >
                <Text className="text-primary text-xs">All</Text>
              </Pressable>
              <Pressable
                onPress={() => setSelectedPlaylists([])}
                className="px-2 py-1"
              >
                <Text className="text-textMuted text-xs">Clear</Text>
              </Pressable>
            </View>
          }
        >
          <View className="gap-2">
            {playlists.map((p) => (
              <PlaylistRow
                key={p.id}
                playlist={p}
                selected={selectedPlaylistIds.includes(p.id)}
                onToggle={() => togglePlaylist(p.id)}
              />
            ))}
            <Pressable
              onPress={() => router.push('/add-playlist')}
              className="bg-surfaceAlt active:bg-surface rounded-md px-4 py-3 items-center border border-dashed border-border"
            >
              <Text className="text-textPrimary font-semibold">+ Add playlist</Text>
            </Pressable>
          </View>
        </Section>

        <Pressable
          onPress={startGame}
          disabled={!canStart}
          className={`rounded-lg px-4 py-4 items-center ${
            canStart ? 'bg-primary active:bg-primaryHover' : 'bg-surface'
          }`}
        >
          <Text
            className={canStart ? 'text-textPrimary text-lg font-bold' : 'text-textMuted text-lg font-bold'}
          >
            Start game
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-textMuted text-xs uppercase tracking-wider">{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={() => onChange(value - step)}
        disabled={atMin}
        className={`w-11 h-11 rounded-md items-center justify-center ${
          atMin ? 'bg-surface' : 'bg-surfaceAlt active:bg-surface'
        }`}
      >
        <Text className={atMin ? 'text-textMuted text-xl' : 'text-textPrimary text-xl'}>−</Text>
      </Pressable>
      <View className="min-w-[48px] items-center">
        <Text className="text-textPrimary text-xl font-bold">{value}</Text>
      </View>
      <Pressable
        onPress={() => onChange(value + step)}
        disabled={atMax}
        className={`w-11 h-11 rounded-md items-center justify-center ${
          atMax ? 'bg-surface' : 'bg-surfaceAlt active:bg-surface'
        }`}
      >
        <Text className={atMax ? 'text-textMuted text-xl' : 'text-textPrimary text-xl'}>+</Text>
      </Pressable>
    </View>
  );
}

function PlaylistRow({
  playlist,
  selected,
  onToggle,
}: {
  playlist: Playlist;
  selected: boolean;
  onToggle: () => void;
}) {
  const removePlaylist = usePlaylistStore((s) => s.removePlaylist);

  function confirmRemove() {
    Alert.alert(
      'Remove playlist?',
      `"${playlist.name}" will be removed from your list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removePlaylist(playlist.id) },
      ]
    );
  }

  return (
    <View className="flex-row gap-2">
      <Pressable
        onPress={onToggle}
        className={`flex-1 flex-row items-center gap-3 rounded-md px-3 py-2 border ${
          selected ? 'bg-primary/20 border-primary' : 'bg-surface border-border'
        }`}
      >
        {playlist.imageUrl ? (
          <Image
            source={{ uri: playlist.imageUrl }}
            style={{ width: 44, height: 44, borderRadius: 6 }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{ width: 44, height: 44, borderRadius: 6 }}
            className="bg-surfaceAlt"
          />
        )}
        <View className="flex-1">
          <Text className="text-textPrimary font-semibold">{playlist.name}</Text>
          <Text className="text-textMuted text-xs">
            {playlist.totalTracks} tracks
            {playlist.isBuiltIn ? '' : ' · custom'}
          </Text>
        </View>
        <View
          className={`w-6 h-6 rounded-full items-center justify-center ${
            selected ? 'bg-primary' : 'border border-border'
          }`}
        >
          {selected ? <Text className="text-textPrimary text-xs">✓</Text> : null}
        </View>
      </Pressable>
      {!playlist.isBuiltIn ? (
        <Pressable
          onPress={confirmRemove}
          className="bg-surface active:bg-surfaceAlt rounded-md px-3 justify-center border border-border"
        >
          <Text className="text-textMuted">✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
