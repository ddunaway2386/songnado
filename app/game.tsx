import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePlayer, type PlayerError } from '@/hooks/usePlayer';
import { EliminationStandings } from '@/components/EliminationStandings';
import { calculateRoundPoints, PREVIEW_DURATION_S } from '@/lib/scoring';
import type { GameMode, Playlist, Song, Team } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';
import { usePlaylistStore } from '@/stores/playlistStore';

export default function GameScreen() {
  const isActive = useGameStore((s) => s.isActive);
  const teams = useGameStore((s) => s.teams);
  const currentTeamIndex = useGameStore((s) => s.currentTeamIndex);
  const currentSong = useGameStore((s) => s.currentSong);
  const currentAttempts = useGameStore((s) => s.currentAttempts);
  const currentPlaylistId = useGameStore((s) => s.currentPlaylistId);
  const selectedPlaylistIds = useGameStore((s) => s.selectedPlaylistIds);
  const gameMode = useGameStore((s) => s.gameMode);
  const turnStyle = useGameStore((s) => s.turnStyle);
  const currentStreakCount = useGameStore((s) => s.currentStreakCount);
  const roundStatus = useGameStore((s) => s.roundStatus);
  const roundCount = useGameStore((s) => s.roundCount);
  const songCorrect = useGameStore((s) => s.songCorrect);
  const artistCorrect = useGameStore((s) => s.artistCorrect);
  const loadError = useGameStore((s) => s.loadError);
  const lastSummary = useGameStore((s) => s.lastSummary);
  const winnerTeamIndex = useGameStore((s) => s.winnerTeamIndex);

  const pickPlaylistForRound = useGameStore((s) => s.pickPlaylistForRound);
  const setSongCorrect = useGameStore((s) => s.setSongCorrect);
  const setArtistCorrect = useGameStore((s) => s.setArtistCorrect);
  const setLastPlayedSeconds = useGameStore((s) => s.setLastPlayedSeconds);
  const skipCurrentSong = useGameStore((s) => s.skipCurrentSong);
  const endRoundEarly = useGameStore((s) => s.endRoundEarly);
  const awardToTeam = useGameStore((s) => s.awardToTeam);
  const noAnswerPenalty = useGameStore((s) => s.noAnswerPenalty);
  const nextRound = useGameStore((s) => s.nextRound);
  const endGame = useGameStore((s) => s.endGame);

  const allPlaylists = usePlaylistStore((s) => s.playlists);

  const [status, controls] = usePlayer();
  const elapsedCapped = status.currentTime; // usePlayer already caps at PREVIEW_DURATION_S

  useEffect(() => {
    if (roundStatus !== 'in-round' && status.playing) void controls.pause();
  }, [roundStatus, status.playing, controls]);

  useEffect(() => {
    if (status.didJustFinish) setLastPlayedSeconds(PREVIEW_DURATION_S);
  }, [status.didJustFinish, setLastPlayedSeconds]);

  // Auto-fire play() for any current song when a round starts OR when
  // the current song's URI changes (e.g. via Skip song). Both providers
  // get auto-play — Deezer used to require a manual Play tap but the
  // user reasonably expects consistency with the Spotify path.
  useEffect(() => {
    if (roundStatus === 'in-round' && currentSong) {
      void controls.play(currentSong);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundStatus, currentSong?.spotifyUri, currentSong?.previewUrl]);

  useEffect(() => {
    if (winnerTeamIndex != null) router.replace('/game-over');
  }, [winnerTeamIndex]);

  useEffect(() => {
    if (!isActive && winnerTeamIndex == null) router.replace('/');
  }, [isActive, winnerTeamIndex]);

  if (!isActive) return null;

  const activeTeam = teams[currentTeamIndex];

  // For Elimination, the active team can only pick playlists they haven't cleared.
  const pickablePlaylists = allPlaylists
    .filter((p) => selectedPlaylistIds.includes(p.id))
    .filter(
      (p) =>
        gameMode !== 'elimination' || !activeTeam?.completedPlaylists.includes(p.id)
    );

  // Who can be awarded this round (correctly answered the song/artist):
  //  - **Elimination always allows steals** — turnStyle governs WHO PICKS
  //    the playlist, but ANY team that hasn't cleared the current playlist
  //    can be awarded if they answer. This is the core Elimination mechanic
  //    (active team misses → another team steals if they still need it).
  //  - Alternating + Classic/Blitz: only the active team can be awarded.
  //  - Free-for-all + Classic/Blitz: any team can be awarded.
  const eligibleTeams = (() => {
    if (gameMode === 'elimination' && currentPlaylistId) {
      return teams.filter((t) => !t.completedPlaylists.includes(currentPlaylistId));
    }
    if (turnStyle === 'alternating') {
      return activeTeam ? [activeTeam] : [];
    }
    return teams;
  })();

  function handlePlay() {
    if (!currentSong) return;
    void controls.play(currentSong);
  }

  function handleStop() {
    // Kept for backwards-compatibility with the existing UI button, but
    // semantically now folded into "End round" via handleEndRound below.
    void controls.stop();
    setLastPlayedSeconds(elapsedCapped);
  }

  function handleSkip() {
    void controls.pause();
    void skipCurrentSong();
  }

  function handleEndRound() {
    // Capture how long we played before abandoning so it's recorded.
    setLastPlayedSeconds(elapsedCapped);
    // controls.pause() handles Deezer audio stopping; for Spotify it's a
    // no-op (audio keeps playing in background since we can't reliably
    // stop it on iOS). The useEffect on roundStatus also fires when we
    // transition to 'picking', as a safety net.
    void controls.pause();
    endRoundEarly();
  }

  function handleAward(teamIndex: number) {
    // Always pause — even if status.playing is stale (e.g. 30s timer
    // already flipped local state but Spotify is still going), the
    // underlying call is idempotent on Spotify and a no-op on Deezer.
    void controls.pause();
    if (status.playing) {
      setLastPlayedSeconds(elapsedCapped);
    }
    awardToTeam(teamIndex);
  }

  function handleNoAnswer() {
    // Always pause — same idempotent / stale-state reasoning as handleAward.
    void controls.pause();
    noAnswerPenalty();
  }

  function confirmEnd() {
    Alert.alert('End game?', 'Scores will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          endGame();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['bottom']}>
      <ScrollView contentContainerClassName="p-4 gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-textMuted text-xs uppercase tracking-wider">
            Round {roundCount} · {modeLabel(gameMode)}
          </Text>
          <Pressable onPress={confirmEnd} className="px-2 py-1">
            <Text className="text-textMuted text-xs">End game</Text>
          </Pressable>
        </View>

        <Scoreboard
          teams={teams}
          activeIndex={currentTeamIndex}
          gameMode={gameMode}
          totalPlaylists={selectedPlaylistIds.length}
        />

        {roundStatus === 'picking' ? (
          <>
            {gameMode === 'elimination' ? (
              <EliminationStandings
                teams={teams}
                playlists={allPlaylists.filter((p) =>
                  selectedPlaylistIds.includes(p.id)
                )}
                activeTeamIndex={currentTeamIndex}
                streakCount={currentStreakCount}
              />
            ) : null}
            <PickingView
              activeTeam={activeTeam}
              playlists={pickablePlaylists}
              gameMode={gameMode}
              loadError={loadError}
              onPick={(id) => pickPlaylistForRound(id)}
              streakCount={gameMode === 'elimination' ? currentStreakCount : 0}
            />
          </>
        ) : null}

        {roundStatus === 'loading' ? (
          <View className="bg-surface rounded-lg p-6 items-center gap-2">
            <ActivityIndicator />
            <Text className="text-textMuted text-xs">Finding a playable track…</Text>
          </View>
        ) : null}

        {roundStatus === 'in-round' && currentSong ? (
          <InRoundView
            activeTeam={activeTeam}
            song={currentSong}
            attempts={currentAttempts}
            elapsed={elapsedCapped}
            playing={status.playing}
            isLoaded={status.isLoaded}
            isBuffering={status.isBuffering}
            playerError={status.error}
            songCorrect={songCorrect}
            artistCorrect={artistCorrect}
            gameMode={gameMode}
            eligibleTeams={eligibleTeams}
            onPlay={handlePlay}
            onStop={handleStop}
            onSkip={handleSkip}
            onEndRound={handleEndRound}
            onToggleSong={() => setSongCorrect(!songCorrect)}
            onToggleArtist={() => setArtistCorrect(!artistCorrect)}
            onAwardTeam={handleAward}
            onNoAnswer={handleNoAnswer}
          />
        ) : null}

        {roundStatus === 'revealed' && lastSummary ? (
          <RevealView summary={lastSummary} gameMode={gameMode} onNext={nextRound} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function modeLabel(mode: GameMode): string {
  if (mode === 'blitz') return 'Blitz';
  if (mode === 'elimination') return 'Elimination';
  return 'Classic';
}

function Scoreboard({
  teams,
  activeIndex,
  gameMode,
  totalPlaylists,
}: {
  teams: Team[];
  activeIndex: number;
  gameMode: GameMode;
  totalPlaylists: number;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row gap-2">
        {teams.map((t) => {
          const active = t.index === activeIndex;
          const cleared = t.completedPlaylists.length;
          return (
            <View
              key={t.id}
              className={`rounded-md px-3 py-2 min-w-[100px] ${
                active ? 'bg-primary' : 'bg-surface'
              }`}
            >
              <Text
                className={
                  active ? 'text-textPrimary/80 text-xs' : 'text-textMuted text-xs'
                }
                numberOfLines={1}
              >
                {t.name}
              </Text>
              {gameMode === 'elimination' ? (
                <Text className="text-textPrimary text-lg font-bold">
                  {cleared} / {totalPlaylists}
                </Text>
              ) : (
                <Text className="text-textPrimary text-lg font-bold">{t.score}</Text>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function PickingView({
  activeTeam,
  playlists,
  gameMode,
  loadError,
  onPick,
  streakCount,
}: {
  activeTeam: Team | undefined;
  playlists: Playlist[];
  gameMode: GameMode;
  loadError: string | null;
  onPick: (id: string) => void;
  /** Current hot-streak count, 0 when not on streak (or non-Elimination). */
  streakCount: number;
}) {
  return (
    <View className="gap-3">
      <Text className="text-textPrimary text-lg">
        <Text className="text-primary font-bold">{activeTeam?.name ?? '…'}</Text>
        <Text className="text-textPrimary">, pick a playlist</Text>
      </Text>
      {streakCount > 0 ? (
        <View className="bg-primary/15 border border-primary rounded-md px-3 py-2">
          <Text className="text-primary font-semibold text-sm">
            🔥 Hot streak ×{streakCount}! Pick again — keep it going.
          </Text>
        </View>
      ) : null}
      {gameMode === 'elimination' ? (
        <Text className="text-textMuted text-xs">
          Only playlists this team hasn&apos;t cleared yet.
        </Text>
      ) : null}
      {loadError ? (
        <View className="bg-surface border border-danger rounded-lg p-3 gap-2">
          <Text className="text-danger text-sm">{loadError}</Text>
          {/* If the error mentions Spotify, surface a deep-link button to
              wake the app. iOS's automatic suspension of backgrounded
              Spotify can't be undone via Web API alone — only direct user
              interaction with Spotify re-establishes the Connect session. */}
          {/Spotify|wake/i.test(loadError) ? (
            <Pressable
              onPress={() => {
                Linking.openURL('spotify://').catch(() =>
                  Alert.alert(
                    'Spotify not installed',
                    'Install the Spotify app from the App Store, then try again.'
                  )
                );
              }}
              className="bg-primary active:bg-primaryHover rounded-md px-4 py-2 items-center"
            >
              <Text className="text-textPrimary font-semibold text-sm">
                Open Spotify
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {playlists.length === 0 ? (
        <View className="bg-surface rounded-lg p-4">
          <Text className="text-textMuted">
            No playlists left for this team. Tap End game to wrap up.
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => onPick(p.id)}
              className="bg-surface active:bg-surfaceAlt flex-row items-center gap-3 rounded-md p-3 border border-border"
            >
              {p.imageUrl ? (
                <Image
                  source={{ uri: p.imageUrl }}
                  style={{ width: 48, height: 48, borderRadius: 6 }}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={{ width: 48, height: 48, borderRadius: 6 }}
                  className="bg-surfaceAlt"
                />
              )}
              <View className="flex-1">
                <Text className="text-textPrimary font-semibold">{p.name}</Text>
                <Text className="text-textMuted text-xs">
                  {p.provider === 'spotify'
                    ? 'Spotify · shuffled'
                    : `${p.playedIndices.length} / ${p.totalTracks} played`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function InRoundView({
  activeTeam,
  song,
  attempts,
  elapsed,
  playing,
  isLoaded,
  isBuffering,
  playerError,
  songCorrect,
  artistCorrect,
  gameMode,
  eligibleTeams,
  onPlay,
  onStop,
  onSkip,
  onEndRound,
  onToggleSong,
  onToggleArtist,
  onAwardTeam,
  onNoAnswer,
}: {
  activeTeam: Team | undefined;
  song: Song;
  attempts: number;
  elapsed: number;
  playing: boolean;
  isLoaded: boolean;
  isBuffering: boolean;
  playerError: PlayerError | null;
  songCorrect: boolean;
  artistCorrect: boolean;
  gameMode: GameMode;
  eligibleTeams: Team[];
  onPlay: () => void;
  onStop: () => void;
  onSkip: () => void;
  onEndRound: () => void;
  onToggleSong: () => void;
  onToggleArtist: () => void;
  onAwardTeam: (index: number) => void;
  onNoAnswer: () => void;
}) {
  const pct = (elapsed / PREVIEW_DURATION_S) * 100;

  // Live preview of points the awarding team would receive.
  const previewPoints =
    gameMode === 'elimination'
      ? null
      : calculateRoundPoints(songCorrect, artistCorrect, elapsed, gameMode);

  const noAnswerLabel =
    gameMode === 'elimination'
      ? 'No one cleared it'
      : gameMode === 'classic'
        ? `No one answered (${activeTeam?.name ?? '…'} −2)`
        : `No one answered (${activeTeam?.name ?? '…'} −30)`;

  return (
    <View className="gap-4">
      <View className="bg-surface rounded-lg p-4 items-center gap-3">
        <Image
          source={{ uri: song.coverUrl }}
          style={{ width: 200, height: 200, borderRadius: 12 }}
          contentFit="cover"
        />
        <View className="items-center">
          <Text className="text-textPrimary text-xl font-bold text-center" numberOfLines={2}>
            {song.title}
          </Text>
          <Text className="text-textMuted">{song.artist}</Text>
        </View>
        {attempts > 1 ? (
          <Text className="text-textMuted text-xs">Track found after {attempts} tries</Text>
        ) : null}
      </View>

      <View className="gap-1">
        <View className="flex-row justify-between">
          <Text className="text-textMuted text-xs">
            {playing ? 'Playing' : isBuffering ? 'Buffering' : 'Paused'}
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

      <View className="flex-row gap-2">
        <Pressable
          onPress={playing ? onStop : onPlay}
          className="flex-1 bg-primary active:bg-primaryHover rounded-md px-4 py-3 items-center"
        >
          <Text className="text-textPrimary font-semibold">
            {playing ? '⏸ Pause' : isLoaded ? '▶ Play' : 'Play'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSkip}
          className="flex-1 bg-surfaceAlt active:bg-surface rounded-md px-4 py-3 items-center"
        >
          <Text className="text-textPrimary font-semibold">🔀 Skip song</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onEndRound}
        className="bg-surface active:bg-surfaceAlt rounded-md px-4 py-2 items-center border border-border"
      >
        <Text className="text-textMuted font-semibold">⏹ End round</Text>
      </Pressable>

      {playerError ? (
        <View className="bg-surface border border-danger rounded-md p-3">
          <Text className="text-danger text-xs uppercase mb-1">
            {playerError.reason === 'no_active_device'
              ? 'Spotify needs a wake-up'
              : playerError.reason === 'not_premium'
                ? 'Premium required'
                : 'Playback issue'}
          </Text>
          <Text className="text-textPrimary text-sm">{playerError.message}</Text>
        </View>
      ) : null}

      <View className="gap-2">
        <Toggle label="Song correct?" value={songCorrect} onToggle={onToggleSong} />
        <Toggle label="Artist correct?" value={artistCorrect} onToggle={onToggleArtist} />
      </View>

      <View className="gap-2">
        <Text className="text-textMuted text-xs uppercase">
          {gameMode === 'elimination'
            ? 'Cleared by…'
            : `Award ${formatPoints(previewPoints ?? 0)} to…`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {eligibleTeams.length === 0 ? (
            <Text className="text-textMuted text-sm">
              All teams have cleared this playlist already.
            </Text>
          ) : (
            eligibleTeams.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => onAwardTeam(t.index)}
                className="bg-primary active:bg-primaryHover rounded-md px-3 py-3 flex-1 min-w-[110px] items-center"
              >
                <Text className="text-textPrimary font-semibold" numberOfLines={1}>
                  {t.name}
                </Text>
              </Pressable>
            ))
          )}
        </View>
        <Pressable
          onPress={onNoAnswer}
          className="bg-surface active:bg-surfaceAlt rounded-md px-3 py-3 items-center border border-danger"
        >
          <Text className="text-danger font-semibold">{noAnswerLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function formatPoints(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

function Toggle({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      className={`flex-row items-center justify-between rounded-md px-3 py-3 border ${
        value ? 'bg-success/20 border-success' : 'bg-surface border-border'
      }`}
    >
      <Text className="text-textPrimary">{label}</Text>
      <View
        className={`w-6 h-6 rounded-full items-center justify-center ${
          value ? 'bg-success' : 'border border-border'
        }`}
      >
        {value ? <Text className="text-bg text-xs font-bold">✓</Text> : null}
      </View>
    </Pressable>
  );
}

function RevealView({
  summary,
  gameMode,
  onNext,
}: {
  summary: NonNullable<ReturnType<typeof useGameStore.getState>['lastSummary']>;
  gameMode: GameMode;
  onNext: () => void;
}) {
  const isElimination = gameMode === 'elimination';
  const cleared = !!summary.eliminationCleared;
  const tone =
    isElimination
      ? cleared
        ? 'text-success'
        : 'text-textMuted'
      : summary.points > 0
        ? 'text-success'
        : summary.points < 0
          ? 'text-danger'
          : 'text-textMuted';

  return (
    <View className="gap-4">
      <View className="bg-surface rounded-lg p-6 items-center gap-3">
        {summary.song?.coverUrl ? (
          <Image
            source={{ uri: summary.song.coverUrl }}
            style={{ width: 200, height: 200, borderRadius: 10 }}
            contentFit="cover"
          />
        ) : null}
        <View className="items-center gap-1">
          <Text className="text-textPrimary text-xl font-bold text-center">
            {summary.song?.title ?? '—'}
          </Text>
          <Text className="text-textMuted">{summary.song?.artist ?? '—'}</Text>
        </View>
      </View>

      <View className="bg-surface rounded-lg p-4 items-center gap-1">
        {isElimination ? (
          <>
            <Text className="text-textMuted text-xs uppercase">
              {summary.noAnswer
                ? 'No one cleared'
                : cleared
                  ? `${summary.playlistName ?? 'Playlist'} cleared by`
                  : 'No clear'}
            </Text>
            <Text className="text-textPrimary text-lg font-semibold">
              {summary.noAnswer ? '—' : summary.teamName}
            </Text>
            <Text className={`text-2xl font-bold ${tone}`}>
              {cleared ? '✓ cleared' : summary.noAnswer ? 'next round' : 'no change'}
            </Text>
          </>
        ) : (
          <>
            <Text className="text-textMuted text-xs uppercase">
              {summary.noAnswer ? 'No one answered' : 'Awarded to'}
            </Text>
            <Text className="text-textPrimary text-lg font-semibold">{summary.teamName}</Text>
            <Text className={`text-3xl font-bold ${tone}`}>{formatPoints(summary.points)}</Text>
          </>
        )}
      </View>

      <Pressable
        onPress={onNext}
        className="bg-primary active:bg-primaryHover rounded-lg px-4 py-4 items-center"
      >
        <Text className="text-textPrimary text-lg font-bold">Next round</Text>
      </Pressable>
    </View>
  );
}
