import { Image } from 'expo-image';
import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { UnlockPackModal } from '@/components/UnlockPackModal';
import { SPOTIFY_ENABLED } from '@/lib/featureFlags';
import { targetScoreBounds } from '@/lib/scoring';
import type { GameMode, Playlist } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useRemoteConfigStore } from '@/stores/remoteConfigStore';
import { isPackUnlocked, useUnlocksStore } from '@/stores/unlocksStore';
import {
  type GameProvider,
  type HotStreakSetting,
  MAX_TEAMS,
  MIN_TEAMS,
  type TurnStyle,
  useSetupStore,
} from '@/stores/setupStore';

const GAME_MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Flat 3 / 1 / 0 — first to the target score wins' },
  { id: 'blitz', label: 'Blitz', hint: 'Speed bonus: points × seconds left on the 30s clock' },
  { id: 'elimination', label: 'Elimination', hint: 'Clear every playlist to win — steals allowed' },
];

const GAME_PROVIDERS: { id: GameProvider; label: string; hint: string }[] = [
  {
    id: 'spotify',
    label: 'Spotify game',
    hint: 'Your own Spotify playlists. Premium required to play.',
  },
  {
    id: 'deezer',
    label: 'Deezer demo',
    hint: 'Starter packs. No account needed.',
  },
];

const TURN_STYLES: { id: TurnStyle; label: string; hint: string }[] = [
  {
    id: 'alternating',
    label: 'Alternating turns',
    hint: 'One team per round. Random first team, then rotates in order.',
  },
  {
    id: 'free-for-all',
    label: 'Free-for-all',
    hint: 'Any team can answer. Host taps whoever buzzed in first.',
  },
];

const HOT_STREAK_OPTIONS: { id: HotStreakSetting; label: string; hint: string }[] = [
  {
    id: 'limit-3',
    label: 'Limit to 3 in a row',
    hint: 'Get both song + artist correct → pick again. Max 3 hot-streak rounds before forced rotation.',
  },
  {
    id: 'unlimited',
    label: 'Unlimited',
    hint: 'Hot streaks chain forever — risky in mismatched games (dominant team can run the table).',
  },
  {
    id: 'off',
    label: 'Off',
    hint: 'No bonus turns. Strict alternating rotation, regardless of both-correct.',
  },
];

/**
 * Spotify-backed providers — both `spotify` (user library) and `curated`
 * (future Songnado Official packs) route through Spotify Connect, so they
 * both belong in a "Spotify game." Deezer-backed providers — both `deezer`
 * (live playlist) and `curated-deezer` (bundled JSON for Movie/TV/Musical/
 * Brand packs) play through Deezer's 30s preview pipeline, so both belong
 * in a "Deezer game."
 */
function isProviderInGame(
  playlist: Playlist,
  gameProvider: GameProvider
): boolean {
  if (gameProvider === 'spotify') {
    return playlist.provider === 'spotify' || playlist.provider === 'curated';
  }
  return playlist.provider === 'deezer' || playlist.provider === 'curated-deezer';
}

export default function SetupScreen() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const hasPlaylistsHydrated = usePlaylistStore((s) => s.hasHydrated);

  const teamCount = useSetupStore((s) => s.teamCount);
  const teamNames = useSetupStore((s) => s.teamNames);
  const targetScore = useSetupStore((s) => s.targetScore);
  const gameMode = useSetupStore((s) => s.gameMode);
  const persistedGameProvider = useSetupStore((s) => s.gameProvider);
  const turnStyle = useSetupStore((s) => s.turnStyle);
  const hotStreakSetting = useSetupStore((s) => s.hotStreakSetting);
  const selectedPlaylistIds = useSetupStore((s) => s.selectedPlaylistIds);
  const hasSetupHydrated = useSetupStore((s) => s.hasHydrated);
  const setTeamCount = useSetupStore((s) => s.setTeamCount);
  const setTeamName = useSetupStore((s) => s.setTeamName);
  const setTargetScore = useSetupStore((s) => s.setTargetScore);
  const setGameMode = useSetupStore((s) => s.setGameMode);
  const setGameProvider = useSetupStore((s) => s.setGameProvider);
  const setTurnStyle = useSetupStore((s) => s.setTurnStyle);
  const setHotStreakSetting = useSetupStore((s) => s.setHotStreakSetting);
  const togglePlaylist = useSetupStore((s) => s.togglePlaylist);
  const setSelectedPlaylists = useSetupStore((s) => s.setSelectedPlaylists);

  // When Spotify is disabled at the build level, force Deezer regardless
  // of what's persisted in the user's setupStore (handles upgrade from a
  // dev build where they last picked 'spotify' — they shouldn't get a
  // broken UX after the toggle flips).
  const gameProvider: GameProvider = SPOTIFY_ENABLED ? persistedGameProvider : 'deezer';

  // Kill-switch: if remote config has Deezer disabled, hide all Deezer
  // playlists from the picker. The banner in _layout.tsx is what tells
  // the user *why* — here we just enforce the filter so they can't tap
  // a playlist and hit a confusing error mid-fetch.
  const deezerEnabled = useRemoteConfigStore((s) => s.config.deezerEnabled);

  // Soft-lock state — drives the lock UI in PlaylistRow + modal.
  const isPro = useUnlocksStore((s) => s.isPro);
  const unlockedPackIds = useUnlocksStore((s) => s.unlockedPackIds);

  // The pack the user tapped that's currently locked — drives the modal.
  const [lockedPackToUnlock, setLockedPackToUnlock] = useState<Playlist | null>(
    null
  );

  // Only show playlists for the chosen game type. Mixed-provider games
  // hit a cross-provider iOS wake-banner issue (and clutter the picker);
  // restricting to one provider per game session avoids both. Plus the
  // kill-switch filter for Deezer — also covers `curated-deezer` since
  // those packs play through Deezer's preview API.
  const visiblePlaylists = playlists.filter((p) => {
    if (!isProviderInGame(p, gameProvider)) return false;
    if (
      (p.provider === 'deezer' || p.provider === 'curated-deezer') &&
      !deezerEnabled
    )
      return false;
    return true;
  });

  // Default to all *visible* playlists selected on first mount per
  // provider — but only once, so "Clear" stays cleared. When the user
  // switches gameProvider, setGameProvider clears selectedPlaylistIds
  // and resets defaultAppliedRef so the new provider's playlists get
  // default-selected next render.
  const defaultAppliedRef = useRef(false);
  const lastProviderRef = useRef(gameProvider);
  if (lastProviderRef.current !== gameProvider) {
    lastProviderRef.current = gameProvider;
    defaultAppliedRef.current = false;
  }
  useEffect(() => {
    if (
      !defaultAppliedRef.current &&
      hasPlaylistsHydrated &&
      hasSetupHydrated &&
      visiblePlaylists.length > 0
    ) {
      defaultAppliedRef.current = true;
      if (selectedPlaylistIds.length === 0) {
        setSelectedPlaylists(visiblePlaylists.map((p) => p.id));
      }
    }
  }, [
    hasPlaylistsHydrated,
    hasSetupHydrated,
    visiblePlaylists,
    selectedPlaylistIds.length,
    setSelectedPlaylists,
  ]);

  const startGameAction = useGameStore((s) => s.startGame);
  const canStart = selectedPlaylistIds.length > 0 && teamCount >= MIN_TEAMS;

  function startGame() {
    if (!canStart) return;
    startGameAction({
      teamNames: teamNames.slice(0, teamCount),
      selectedPlaylistIds,
      gameMode,
      targetScore,
      turnStyle,
      hotStreakSetting,
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

        {SPOTIFY_ENABLED ? (
          <Section title="Game type">
            <View className="gap-2">
              {GAME_PROVIDERS.map((p) => {
                const active = gameProvider === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setGameProvider(p.id)}
                    className={`rounded-md px-4 py-3 border ${
                      active
                        ? 'bg-primary border-primary'
                        : 'bg-surface border-border active:bg-surfaceAlt'
                    }`}
                  >
                    <Text className="text-textPrimary font-semibold">{p.label}</Text>
                    <Text className={active ? 'text-textPrimary/80 text-xs' : 'text-textMuted text-xs'}>
                      {p.hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

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

        <Section title="Turn style">
          <View className="gap-2">
            {TURN_STYLES.map((t) => {
              const active = turnStyle === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTurnStyle(t.id)}
                  className={`rounded-md px-4 py-3 border ${
                    active
                      ? 'bg-primary border-primary'
                      : 'bg-surface border-border active:bg-surfaceAlt'
                  }`}
                >
                  <Text className="text-textPrimary font-semibold">{t.label}</Text>
                  <Text className={active ? 'text-textPrimary/80 text-xs' : 'text-textMuted text-xs'}>
                    {t.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {/* Hot streak limit only meaningful in Elimination — hide otherwise to
            avoid cluttering the setup screen for Classic/Blitz users. */}
        {gameMode === 'elimination' ? (
          <Section title="Hot streak (Elimination)">
            <View className="gap-2">
              {HOT_STREAK_OPTIONS.map((h) => {
                const active = hotStreakSetting === h.id;
                return (
                  <Pressable
                    key={h.id}
                    onPress={() => setHotStreakSetting(h.id)}
                    className={`rounded-md px-4 py-3 border ${
                      active
                        ? 'bg-primary border-primary'
                        : 'bg-surface border-border active:bg-surfaceAlt'
                    }`}
                  >
                    <Text className="text-textPrimary font-semibold">{h.label}</Text>
                    <Text className={active ? 'text-textPrimary/80 text-xs' : 'text-textMuted text-xs'}>
                      {h.hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

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

        {gameProvider === 'spotify' ? <SpotifySection /> : null}

        <Section
          title={
            gameProvider === 'spotify'
              ? `Spotify playlists (${selectedPlaylistIds.length}/${visiblePlaylists.length})`
              : `Deezer packs (${selectedPlaylistIds.length}/${visiblePlaylists.length})`
          }
          right={
            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setSelectedPlaylists(visiblePlaylists.map((p) => p.id))}
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
            {visiblePlaylists.length === 0 && gameProvider === 'spotify' ? (
              <View className="bg-surface rounded-md p-4 border border-border">
                <Text className="text-textMuted text-sm">
                  Connect Spotify above to load your playlists, or switch to Deezer demo to play right now.
                </Text>
              </View>
            ) : null}
            {visiblePlaylists.map((p) => {
              const unlocked = isPackUnlocked(p, { isPro, unlockedPackIds });
              return (
                <PlaylistRow
                  key={p.id}
                  playlist={p}
                  selected={selectedPlaylistIds.includes(p.id)}
                  locked={!unlocked}
                  onToggle={() => {
                    if (!unlocked) {
                      setLockedPackToUnlock(p);
                      return;
                    }
                    togglePlaylist(p.id);
                  }}
                />
              );
            })}
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

      <UnlockPackModal
        playlist={lockedPackToUnlock}
        onClose={() => setLockedPackToUnlock(null)}
      />
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
  locked = false,
  onToggle,
}: {
  playlist: Playlist;
  selected: boolean;
  /**
   * When true, the row renders dimmed with a lock indicator and tapping
   * routes to the unlock modal (handled by the parent) instead of toggling
   * selection.
   */
  locked?: boolean;
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
          locked
            ? 'bg-surface border-border opacity-60'
            : selected
              ? 'bg-primary/20 border-primary'
              : 'bg-surface border-border'
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
          <Text className="text-textPrimary font-semibold">
            {locked ? `🔒 ${playlist.name}` : playlist.name}
          </Text>
          <Text className="text-textMuted text-xs">
            {playlist.provider === 'spotify'
              ? 'Spotify · shuffled'
              : `${playlist.totalTracks} tracks`}
            {playlist.isBuiltIn || playlist.provider === 'spotify' ? '' : ' · custom'}
            {locked ? ' · tap to unlock' : ''}
          </Text>
        </View>
        {locked ? null : (
          <View
            className={`w-6 h-6 rounded-full items-center justify-center ${
              selected ? 'bg-primary' : 'border border-border'
            }`}
          >
            {selected ? <Text className="text-textPrimary text-xs">✓</Text> : null}
          </View>
        )}
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
