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
import { EliminationPickingGrid } from '@/components/EliminationPickingGrid';
import { EliminationStandings } from '@/components/EliminationStandings';
import {
  calculateRoundPoints,
  canClearElimination,
  PREVIEW_DURATION_S,
  primaryFieldLabel,
  requiredFieldLabel,
} from '@/lib/scoring';
import type { GameMode, Playlist, Song, Team } from '@/lib/types';
import { useFeedbackStore } from '@/stores/feedbackStore';
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
  const eliminationStealOpen = useGameStore((s) => s.eliminationStealOpen);
  const eliminationBlockOpen = useGameStore((s) => s.eliminationBlockOpen);
  const confirmEliminationBlock = useGameStore((s) => s.confirmEliminationBlock);
  const eliminationStealPicks = useGameStore((s) => s.eliminationStealPicks);
  const toggleEliminationStealPick = useGameStore((s) => s.toggleEliminationStealPick);
  const confirmEliminationSteal = useGameStore((s) => s.confirmEliminationSteal);
  const previousRoundSnapshot = useGameStore((s) => s.previousRoundSnapshot);
  const undoLastRound = useGameStore((s) => s.undoLastRound);
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
  //  - **Elimination**: only the active team can score. Miss = tile stays on
  //    their grid, turn passes. No steal in the redesigned Elimination —
  //    Daniel's rule change from the "clear the grid" family-test discussion.
  //    (The old "steal on Elimination" mechanic is preserved in git if we
  //    ever bring it back — see pre-redesign version of this file.)
  //  - Alternating + Classic/Blitz: only the active team can be awarded
  //    UNTIL the 30-second window expires with no score. Then other teams
  //    can steal for reduced points (2 for both, 1 for one). See the
  //    isSteal detection in gameStore.awardToTeam.
  //  - Free-for-all + Classic/Blitz: any team can be awarded.
  const isStealPhase =
    (gameMode === 'classic' || gameMode === 'blitz') &&
    turnStyle === 'alternating' &&
    elapsedCapped >= PREVIEW_DURATION_S;
  const eligibleTeams = (() => {
    if (gameMode === 'elimination') {
      // Block window → any OTHER team can name the bonus field to deny the
      // clear, including teams that already cleared this pack (they gain
      // nothing, they're just blocking).
      if (eliminationBlockOpen) {
        return teams.filter((t) => t.index !== activeTeam?.index);
      }
      // Steal window → every OTHER team that still needs this pack.
      if (eliminationStealOpen && currentPlaylistId) {
        return teams.filter(
          (t) =>
            t.index !== activeTeam?.index &&
            !t.completedPlaylists.includes(currentPlaylistId)
        );
      }
      return activeTeam ? [activeTeam] : [];
    }
    if (turnStyle === 'alternating') {
      if (isStealPhase) {
        // 30s expired — every OTHER team can steal.
        return teams.filter((t) => t.index !== activeTeam?.index);
      }
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
          <View className="flex-row gap-3">
            {previousRoundSnapshot ? (
              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Undo last round?',
                    `Restores team scores + puts you back at round ${previousRoundSnapshot.roundCount} so you can re-award.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Undo', onPress: () => undoLastRound() },
                    ]
                  );
                }}
                className="px-2 py-1"
              >
                <Text className="text-accent text-xs font-semibold">
                  ↩ Undo R{previousRoundSnapshot.roundCount}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={confirmEnd} className="px-2 py-1">
              <Text className="text-textMuted text-xs">End game</Text>
            </Pressable>
          </View>
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
              <>
                <EliminationStandings
                  teams={teams}
                  playlists={allPlaylists.filter((p) =>
                    selectedPlaylistIds.includes(p.id)
                  )}
                  activeTeamIndex={currentTeamIndex}
                  streakCount={currentStreakCount}
                />
                <EliminationPickingGrid
                  activeTeam={activeTeam}
                  playlists={allPlaylists.filter((p) =>
                    selectedPlaylistIds.includes(p.id)
                  )}
                  onPick={(id) => pickPlaylistForRound(id)}
                  streakCount={currentStreakCount}
                  loadError={loadError}
                />
              </>
            ) : (
              <PickingView
                activeTeam={activeTeam}
                playlists={pickablePlaylists}
                gameMode={gameMode}
                loadError={loadError}
                onPick={(id) => pickPlaylistForRound(id)}
                streakCount={0}
              />
            )}
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
            isStealPhase={isStealPhase}
            eliminationStealOpen={eliminationStealOpen}
            eliminationBlockOpen={eliminationBlockOpen}
            onConfirmBlock={confirmEliminationBlock}
            eliminationStealPicks={eliminationStealPicks}
            onToggleStealPick={toggleEliminationStealPick}
            onConfirmSteal={confirmEliminationSteal}
            currentPlaylistId={currentPlaylistId}
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
          <RevealView
            summary={lastSummary}
            gameMode={gameMode}
            onNext={nextRound}
            currentPlaylistId={currentPlaylistId}
          />
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
  isStealPhase,
  currentPlaylistId,
  eliminationStealOpen,
  eliminationBlockOpen,
  onConfirmBlock,
  eliminationStealPicks,
  onToggleStealPick,
  onConfirmSteal,
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
  isStealPhase: boolean;
  currentPlaylistId: string | null;
  eliminationStealOpen: boolean;
  eliminationBlockOpen: boolean;
  onConfirmBlock: () => void;
  eliminationStealPicks: number[];
  onToggleStealPick: (teamIndex: number) => void;
  onConfirmSteal: () => void;
  onPlay: () => void;
  onStop: () => void;
  onSkip: () => void;
  onEndRound: () => void;
  onToggleSong: () => void;
  onToggleArtist: () => void;
  onAwardTeam: (index: number) => void;
  onNoAnswer: () => void;
}) {
  // Toggle label changes with pack: 'Song' for standard packs, 'Show' /
  // 'Movie' / 'Musical' for source-heavy packs (TV / soundtracks /
  // broadway). Reflects what players are actually trying to identify.
  const songLabel = primaryFieldLabel(currentPlaylistId);

  // Steal-phase hooks. Kept inside InRoundView (not passed as props)
  // because they're only meaningful when isStealPhase is true, and the
  // prop signature is already dense.
  const stealAwards = useGameStore((s) => s.stealAwards);
  const toggleStealAward = useGameStore((s) => s.toggleStealAward);
  const confirmStealAndAdvance = useGameStore((s) => s.confirmStealAndAdvance);
  const stealPtsPerPart = gameMode === 'blitz' ? 10 : 1;
  const activeTeamIndex = activeTeam?.index;

  function stealPointsForTeam(teamIndex: number): number {
    const a = stealAwards[teamIndex];
    if (!a) return 0;
    return (a.song ? stealPtsPerPart : 0) + (a.artist ? stealPtsPerPart : 0);
  }

  function activeTeamPenalty(): number {
    // Reduced penalty when steal was available (which it always is
    // when the steal UI is showing).
    return gameMode === 'blitz' ? -20 : -1;
  }

  function handleConfirmStealAdvance() {
    const awardsSummary = eligibleTeams
      .map((t) => {
        const p = stealPointsForTeam(t.index);
        return p > 0 ? `${t.name}: +${p}` : null;
      })
      .filter(Boolean)
      .join('\n');
    const penalty = activeTeamPenalty();
    const activeName = activeTeam?.name ?? 'Active team';
    const summary =
      (awardsSummary || 'No one scored.') + `\n${activeName}: ${penalty}`;
    Alert.alert('Apply steal awards?', summary, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, next round',
        onPress: () => confirmStealAndAdvance(),
      },
    ]);
  }
  const pct = (elapsed / PREVIEW_DURATION_S) * 100;

  // Family test feedback flag actions - also present on RevealView.
  // Duplicated here (not extracted to a shared component yet) because
  // both InRoundView and RevealView already have their own dense
  // prop signatures; a shared FlagButtons component would fit fine
  // but the extraction can wait. currentPlaylistId now comes in as
  // a prop (also used by the steal/source-heavy scoring logic).
  const flagRemove = useFeedbackStore((s) => s.flagRemove);
  const flagBadVersion = useFeedbackStore((s) => s.flagBadVersion);
  const feedbackEntries = useFeedbackStore((s) => s.entries);
  const alreadyFlagged =
    currentPlaylistId != null &&
    feedbackEntries.some(
      (e) =>
        e.packId === currentPlaylistId &&
        e.title === song.title &&
        e.artist === song.artist
    );
  function handleFlag(kind: 'remove' | 'bad-version') {
    if (!currentPlaylistId) return;
    const input = {
      packId: currentPlaylistId,
      packName: currentPlaylistId,
      title: song.title,
      artist: song.artist,
      coverUrl: song.coverUrl,
      source: song.source,
      previewUrl: song.previewUrl,
    };
    if (kind === 'remove') flagRemove(input);
    else flagBadVersion(input);
  }

  // Live preview of points the awarding team would receive. Passes
  // isStealPhase + playlistId so the number reflects steal + source-heavy
  // scoring rules (steal caps at 2, source-heavy weights source higher).
  const previewPoints =
    gameMode === 'elimination'
      ? null
      : calculateRoundPoints(songCorrect, artistCorrect, elapsed, gameMode, {
          isSteal: isStealPhase,
          playlistId: currentPlaylistId,
        });

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
          {song.source ? (
            <View className="mt-2 px-2.5 py-1 bg-primary/15 rounded-md">
              <Text className="text-primary text-xs font-semibold">
                from {song.source}
              </Text>
            </View>
          ) : null}
        </View>
        {attempts > 1 ? (
          <Text className="text-textMuted text-xs">Track found after {attempts} tries</Text>
        ) : null}
      </View>

      {/* Family test feedback - flag mid-song without waiting for reveal. */}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => handleFlag('remove')}
          className="flex-1 rounded-lg px-3 py-2 items-center bg-surface active:bg-surfaceAlt border border-border"
        >
          <Text className="text-textPrimary text-xs font-semibold">🗑  Remove</Text>
        </Pressable>
        <Pressable
          onPress={() => handleFlag('bad-version')}
          className="flex-1 rounded-lg px-3 py-2 items-center bg-surface active:bg-surfaceAlt border border-border"
        >
          <Text className="text-textPrimary text-xs font-semibold">🎵  Bad version</Text>
        </Pressable>
      </View>
      {alreadyFlagged ? (
        <Text className="text-accent text-[10px] text-center -mt-2">
          ✓ Flagged — see /feedback
        </Text>
      ) : null}

      {isStealPhase ? (
        <View className="bg-accent rounded-lg p-3 items-center">
          <Text className="text-black text-sm font-bold">
            ⚡ STEAL — any other team can guess (1 or 2 points)
          </Text>
        </View>
      ) : null}

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

      {isStealPhase ? (
        /* STEAL PHASE — per-team matrix. Song and Artist independently
           awarded to any non-active team; multiple teams can be awarded
           the same part. Confirm dialog before advancing so host can
           double-check the moving parts. */
        <View className="gap-3">
          <Text className="text-textMuted text-xs uppercase">
            Tap what each team got (multiple teams can be awarded same part)
          </Text>
          <View className="gap-2">
            {eligibleTeams.map((t) => {
              const award = stealAwards[t.index] ?? { song: false, artist: false };
              const total = stealPointsForTeam(t.index);
              return (
                <View
                  key={t.id}
                  className="flex-row items-center gap-2 bg-surface rounded-md p-2 border border-border"
                >
                  <Text className="text-textPrimary font-semibold w-24" numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Pressable
                    onPress={() => toggleStealAward(t.index, 'song')}
                    className={`flex-1 rounded px-2 py-2 items-center ${
                      award.song ? 'bg-success' : 'bg-surfaceAlt'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        award.song ? 'text-bg' : 'text-textPrimary'
                      }`}
                    >
                      {songLabel} +{stealPtsPerPart}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleStealAward(t.index, 'artist')}
                    className={`flex-1 rounded px-2 py-2 items-center ${
                      award.artist ? 'bg-success' : 'bg-surfaceAlt'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        award.artist ? 'text-bg' : 'text-textPrimary'
                      }`}
                    >
                      Artist +{stealPtsPerPart}
                    </Text>
                  </Pressable>
                  <Text className="text-accent font-bold w-10 text-right">
                    {total > 0 ? `+${total}` : ''}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text className="text-textMuted text-xs text-center">
            {activeTeam?.name ?? 'Active team'} will get {activeTeamPenalty()} regardless
          </Text>
          <Pressable
            onPress={handleConfirmStealAdvance}
            className="bg-primary active:bg-primaryHover rounded-md px-3 py-4 items-center"
          >
            <Text className="text-textPrimary font-bold text-base">
              Confirm & Next Round
            </Text>
          </Pressable>
        </View>
      ) : (
        /* Standard award UI (first 30s + non-alternating turns). */
        <>
          <View className="gap-2">
            <Toggle label={`${songLabel} correct?`} value={songCorrect} onToggle={onToggleSong} />
            <Toggle label="Artist correct?" value={artistCorrect} onToggle={onToggleArtist} />
          </View>

          {eliminationBlockOpen ? (
            /* Block window — the active team got the required field but not
               the bonus one, so everyone else gets a shot at the bonus.
               Landing it denies the clear. Nobody gains a tile here. */
            <View className="gap-2">
              <View className="bg-warning/15 border border-warning rounded-md px-3 py-2">
                <Text className="text-warning font-bold text-sm">
                  🛡 BLOCK — {activeTeam?.name ?? 'the picking team'} got the{' '}
                  {requiredFieldLabel(currentPlaylistId).toLowerCase()} only
                </Text>
                <Text className="text-textMuted text-xs mt-1">
                  Anyone else name the{' '}
                  {primaryFieldLabel(currentPlaylistId).toLowerCase()}? If so
                  they block the clear.
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {eligibleTeams.map((t) => {
                  const picked = eliminationStealPicks.includes(t.index);
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => onToggleStealPick(t.index)}
                      className={`rounded-md px-3 py-3 flex-1 min-w-[110px] items-center border ${
                        picked
                          ? 'bg-danger border-danger'
                          : 'bg-surface border-border active:bg-surfaceAlt'
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          picked ? 'text-textPrimary' : 'text-textMuted'
                        }`}
                        numberOfLines={1}
                      >
                        {picked ? '🛡 ' : ''}
                        {t.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={onConfirmBlock}
                className="bg-primary active:bg-primaryHover rounded-md px-3 py-3 items-center"
              >
                <Text className="text-textPrimary font-bold">
                  {eliminationStealPicks.length > 0
                    ? 'Confirm block — no clear'
                    : `Nobody got it — ${activeTeam?.name ?? 'team'} clears`}
                </Text>
              </Pressable>
            </View>
          ) : eliminationStealOpen ? (
            /* Elimination steal window — the active team missed, so anyone
               else who still needs this pack can take it. Multi-select
               because two teams can shout the answer at once; each one
               clears the pack on their own grid. */
            <View className="gap-2">
              <View className="bg-warning/15 border border-warning rounded-md px-3 py-2">
                <Text className="text-warning font-bold text-sm">
                  ⚡ STEAL — {activeTeam?.name ?? 'the picking team'} missed it
                </Text>
                <Text className="text-textMuted text-xs mt-1">
                  Tap every team that got it. Each one clears this pack on
                  their own grid.
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {eligibleTeams.length === 0 ? (
                  <Text className="text-textMuted text-sm">
                    No other team still needs this pack.
                  </Text>
                ) : (
                  eligibleTeams.map((t) => {
                    const picked = eliminationStealPicks.includes(t.index);
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => onToggleStealPick(t.index)}
                        className={`rounded-md px-3 py-3 flex-1 min-w-[110px] items-center border ${
                          picked
                            ? 'bg-success border-success'
                            : 'bg-surface border-border active:bg-surfaceAlt'
                        }`}
                      >
                        <Text
                          className={`font-semibold ${
                            picked ? 'text-textPrimary' : 'text-textMuted'
                          }`}
                          numberOfLines={1}
                        >
                          {picked ? '✓ ' : ''}
                          {t.name}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
              <Pressable
                onPress={onConfirmSteal}
                className="bg-primary active:bg-primaryHover rounded-md px-3 py-3 items-center"
              >
                <Text className="text-textPrimary font-bold">
                  {eliminationStealPicks.length > 0
                    ? `Confirm steal (${eliminationStealPicks.length}) & next round`
                    : 'Nobody got it — next round'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="gap-2">
              <Text className="text-textMuted text-xs uppercase">
                {gameMode === 'elimination'
                  ? `${requiredFieldLabel(currentPlaylistId)} required to clear`
                  : `Award ${formatPoints(previewPoints ?? 0)} to…`}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {eligibleTeams.length === 0 ? (
                  <Text className="text-textMuted text-sm">
                    All teams have cleared this playlist already.
                  </Text>
                ) : (
                  eligibleTeams.map((t) => {
                    // Elimination: one button, and it stays dead until the
                    // required field is marked. It used to fire on any tap and
                    // silently end the round as a non-clear.
                    const canAward =
                      gameMode !== 'elimination' ||
                      canClearElimination(songCorrect, artistCorrect, currentPlaylistId);
                    const label =
                      gameMode === 'elimination'
                        ? songCorrect && artistCorrect
                          ? '✓ Clear + hot streak'
                          : `✓ ${t.name} clears`
                        : t.name;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => canAward && onAwardTeam(t.index)}
                        disabled={!canAward}
                        className={`rounded-md px-3 py-3 flex-1 min-w-[110px] items-center ${
                          canAward
                            ? 'bg-primary active:bg-primaryHover'
                            : 'bg-surfaceAlt'
                        }`}
                      >
                        <Text
                          className={`font-semibold ${
                            canAward ? 'text-textPrimary' : 'text-textMuted'
                          }`}
                          numberOfLines={1}
                        >
                          {canAward
                            ? label
                            : `Mark ${requiredFieldLabel(
                                currentPlaylistId
                              ).toLowerCase()} first`}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
              <Pressable
                onPress={onNoAnswer}
                className="bg-surface active:bg-surfaceAlt rounded-md px-3 py-3 items-center border border-danger"
              >
                <Text className="text-danger font-semibold">
                  {gameMode === 'elimination' ? 'Not cleared →' : noAnswerLabel}
                </Text>
              </Pressable>
            </View>
          )}
        </>
      )}
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
  currentPlaylistId,
}: {
  summary: NonNullable<ReturnType<typeof useGameStore.getState>['lastSummary']>;
  gameMode: GameMode;
  onNext: () => void;
  currentPlaylistId: string | null;
}) {
  const isElimination = gameMode === 'elimination';
  const flagRemove = useFeedbackStore((s) => s.flagRemove);
  const flagBadVersion = useFeedbackStore((s) => s.flagBadVersion);
  const entries = useFeedbackStore((s) => s.entries);
  const currentSong = summary.song;

  const alreadyFlagged =
    currentSong &&
    entries.some(
      (e) =>
        e.title === currentSong.title &&
        e.artist === currentSong.artist &&
        e.packId === (currentPlaylistId ?? '')
    );

  function handleFlag(kind: 'remove' | 'bad-version') {
    if (!currentSong || !currentPlaylistId) return;
    const input = {
      packId: currentPlaylistId,
      packName: summary.playlistName ?? currentPlaylistId,
      title: currentSong.title,
      artist: currentSong.artist,
      coverUrl: currentSong.coverUrl,
      source: currentSong.source,
      previewUrl: currentSong.previewUrl,
    };
    if (kind === 'remove') flagRemove(input);
    else flagBadVersion(input);
  }
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

      {/* Family test feedback flags — quick tap during reveal to mark
          the song for post-weekend curation. Local-only capture; Dan
          collects via the /feedback screen's share sheet after the test. */}
      {currentSong && currentPlaylistId ? (
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => handleFlag('remove')}
            className="flex-1 rounded-lg px-3 py-3 items-center bg-surface active:bg-surfaceAlt border border-border"
          >
            <Text className="text-textPrimary text-sm font-semibold">🗑  Remove</Text>
            <Text className="text-textMuted text-[10px] mt-1">Skip forever</Text>
          </Pressable>
          <Pressable
            onPress={() => handleFlag('bad-version')}
            className="flex-1 rounded-lg px-3 py-3 items-center bg-surface active:bg-surfaceAlt border border-border"
          >
            <Text className="text-textPrimary text-sm font-semibold">🎵  Bad version</Text>
            <Text className="text-textMuted text-[10px] mt-1">Song good, recording bad</Text>
          </Pressable>
        </View>
      ) : null}
      {alreadyFlagged ? (
        <Text className="text-accent text-xs text-center">
          ✓ Flagged — you can flag again for the other reason if you want
        </Text>
      ) : null}

      <Pressable
        onPress={onNext}
        className="bg-primary active:bg-primaryHover rounded-lg px-4 py-4 items-center"
      >
        <Text className="text-textPrimary text-lg font-bold">Next round</Text>
      </Pressable>
    </View>
  );
}
