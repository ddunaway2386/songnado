/**
 * Host-side buzz gameplay screen.
 *
 * Drives the round loop:
 *   idle → load next track → hostBeginRound() → audio plays + buzzers armed
 *      ↓ a team buzzes (handled in store, sub-phase → 'answering')
 *   answering → host taps Correct or Wrong
 *      Correct → hostJudgeCorrect → sub-phase 'reveal'
 *      Wrong:
 *        If teams remain → re-armed (sub-phase back to 'playing')
 *        If none remain → sub-phase 'reveal' (no-winner round)
 *   reveal → host taps Next Round → hostAdvanceRound → loops or ends game
 *
 * Audio orchestration:
 *  - sub-phase becomes 'playing' → player.play(currentSong)
 *  - sub-phase becomes 'answering' → player.pause()
 *  - 30s preview ends naturally (didJustFinish) → no buzz, force reveal as
 *    no-winner round (treat like wrong-answer for all teams)
 */

import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePlayer } from '@/hooks/usePlayer';
import { PREVIEW_DURATION_S } from '@/lib/scoring';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { useFeedbackStore } from '@/stores/feedbackStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { colors, radii } from '../../theme';

export default function BuzzHostGameScreen() {
  // Host screen sleeping mid-game suspends the app and drops every connected
  // team at once — the worst possible failure, since it looks like the guests'
  // phones broke rather than the host's.
  useKeepAwake();

  const phase = useBuzzGameStore((s) => s.phase);
  const host = useBuzzGameStore((s) => s.host);
  const hostBeginRound = useBuzzGameStore((s) => s.hostBeginRound);
  const hostSetRoundPlaylist = useBuzzGameStore((s) => s.hostSetRoundPlaylist);
  const hostPickPlaylist = useBuzzGameStore((s) => s.hostPickPlaylist);
  const hostJudgeCorrect = useBuzzGameStore((s) => s.hostJudgeCorrect);
  const hostJudgeWrong = useBuzzGameStore((s) => s.hostJudgeWrong);
  const hostAdvanceRound = useBuzzGameStore((s) => s.hostAdvanceRound);
  const stopHosting = useBuzzGameStore((s) => s.stopHosting);

  const allPlaylists = usePlaylistStore((s) => s.playlists);
  const fetchNextPlayableTrack = usePlaylistStore(
    (s) => s.fetchNextPlayableTrack
  );
  const flagRemove = useFeedbackStore((s) => s.flagRemove);
  const flagBadVersion = useFeedbackStore((s) => s.flagBadVersion);
  const feedbackEntries = useFeedbackStore((s) => s.entries);
  const [status, controls] = usePlayer();

  function handleFlagCurrent(kind: 'remove' | 'bad-version') {
    const song = host.currentSong;
    const packId = host.currentPlaylistId;
    const packName = host.currentPlaylistName;
    if (!song || !packId) return;
    const input = {
      packId,
      packName: packName ?? packId,
      title: song.title,
      artist: song.artist,
      coverUrl: song.coverUrl,
      source: song.source,
      previewUrl: song.previewUrl,
    };
    if (kind === 'remove') flagRemove(input);
    else flagBadVersion(input);
  }

  const currentFlagged =
    host.currentSong &&
    host.currentPlaylistId &&
    feedbackEntries.some(
      (e) =>
        e.packId === host.currentPlaylistId &&
        e.title === host.currentSong!.title &&
        e.artist === host.currentSong!.artist
    );

  /**
   * Whether the answer is shown during playback. Defaults ON — the host has
   * to judge and generally wants to follow along, and the host never buzzes
   * so there's nothing to spoil. Tap the banner to hide it for a round where
   * the phone is sitting where players can see it. Persists across rounds.
   */
  const [showAnswer, setShowAnswer] = useState(true);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  // A finished game goes to the winner screen, which owns tearing the
  // server down (it keeps the session alive so connected phones can show
  // their placement). phase 'none' means the session is already gone.
  useEffect(() => {
    if (phase === 'host:ended') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev start
      router.replace('/buzz/game-over' as any);
    } else if (phase === 'none') {
      router.replace('/');
    }
  }, [phase]);

  // Load + play next track when sub-phase becomes 'idle' (start of a round).
  // Uses the shared playlistStore rotation (so buzz mode shares the same
  // "what's been played recently" state as normal gameplay).
  const loadAndPlay = useCallback(async () => {
    // The picking team already chose this round's pack (hostPickPlaylist),
    // so no random draw here. Falls back to the first selected pack only if
    // something went wrong and nothing was chosen.
    const playlistId = host.currentPlaylistId ?? host.playlistIds[0];
    if (!playlistId) return;

    setLoadingTrack(true);
    setTrackError(null);
    try {
      const { useFeedbackStore } = await import('@/stores/feedbackStore');
      const isFlagged = useFeedbackStore.getState().isFlagged;
      const result = await fetchNextPlayableTrack(playlistId, (song) =>
        isFlagged(playlistId, song.title, song.artist)
      );
      if (!result) {
        setTrackError('No playable track in this playlist.');
        setLoadingTrack(false);
        return;
      }
      hostSetRoundPlaylist(playlistId);
      hostBeginRound(result.song, result.index);
      await controls.play(result.song);
    } catch (e) {
      setTrackError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTrack(false);
    }
  }, [
    host.playlistIds,
    host.currentPlaylistId,
    fetchNextPlayableTrack,
    hostSetRoundPlaylist,
    hostBeginRound,
    controls,
  ]);

  // Track the previous sub-phase so we react only on changes.
  const prevSubPhaseRef = useRef(host.roundSubPhase);
  useEffect(() => {
    const prev = prevSubPhaseRef.current;
    prevSubPhaseRef.current = host.roundSubPhase;
    if (host.roundSubPhase === 'idle' && prev !== 'idle') {
      void loadAndPlay();
    } else if (host.roundSubPhase === 'answering' && prev !== 'answering') {
      void controls.pause();
    } else if (host.roundSubPhase === 'reveal') {
      void controls.pause();
    }
  }, [host.roundSubPhase, loadAndPlay, controls]);

  // Mount: only auto-load if a pack is already chosen. A fresh game opens
  // on 'picking', where the team chooses first.
  useEffect(() => {
    if (host.roundSubPhase === 'idle' && phase === 'host:playing') {
      void loadAndPlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 30s window ended with nobody buzzing → reveal as no-winner round.
  // Reuses the store's hostJudgeWrong action with a synthetic answering
  // teamId set to a sentinel, OR simpler: drop straight into reveal.
  // Phase 3 minimum: set local sub-phase; broadcast happens on advance.
  useEffect(() => {
    if (status.didJustFinish && host.roundSubPhase === 'playing') {
      const reveal = {
        songTitle: host.currentSong?.title ?? '',
        artist: host.currentSong?.artist ?? '',
        source: host.currentSong?.source ?? null,
        coverUrl: host.currentSong?.coverUrl ?? '',
      };
      useBuzzGameStore.setState((s) => ({
        host: {
          ...s.host,
          roundSubPhase: 'reveal',
          lastReveal: reveal,
        },
      }));
    }
  }, [status.didJustFinish, host.roundSubPhase, host.currentSong]);

  const answeringTeam = host.answeringTeamId
    ? host.teams[host.answeringTeamId]
    : null;
  const pickingTeam = host.pickingTeamId ? host.teams[host.pickingTeamId] : null;
  const gamePacks = allPlaylists.filter((p) => host.playlistIds.includes(p.id));

  const teamsArray = Object.values(host.teams);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '700' }}>
            Round {host.currentRound} / {host.totalRounds}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {host.currentPlaylistName}
          </Text>
        </View>

        {/* Sub-phase banner */}
        <View
          style={{
            padding: 14,
            borderRadius: radii.md,
            backgroundColor:
              host.roundSubPhase === 'playing'
                ? colors.success
                : host.roundSubPhase === 'answering'
                  ? colors.warning
                  : host.roundSubPhase === 'reveal'
                    ? colors.surface
                    : colors.surfaceAlt,
            marginBottom: 16,
            alignItems: 'center',
          }}
        >
          {loadingTrack ? (
            <ActivityIndicator color="#fff" />
          ) : trackError ? (
            <Text style={{ color: '#fff' }}>{trackError}</Text>
          ) : host.roundSubPhase === 'picking' ? (
            <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 16 }}>
              {pickingTeam ? `${pickingTeam.name} picks the pack` : 'Pick a pack'}
            </Text>
          ) : host.roundSubPhase === 'playing' ? (
            /* Peek is opt-in during play. The host never buzzes so there's no
               competitive reason to hide it, but the host's phone is often
               face-up on a table where players can see it. */
            <Pressable onPress={() => setShowAnswer((v) => !v)} style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>
                ♪ Playing… {Math.round(status.currentTime)}s / {PREVIEW_DURATION_S}s
              </Text>
              {showAnswer && host.currentSong ? (
                <>
                  <Text
                    style={{
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: '800',
                      marginTop: 6,
                      textAlign: 'center',
                    }}
                  >
                    {host.currentSong.title}
                  </Text>
                  <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center' }}>
                    {host.currentSong.artist}
                  </Text>
                </>
              ) : (
                <Text style={{ color: '#fff', opacity: 0.7, fontSize: 11, marginTop: 4 }}>
                  tap to hide the answer
                </Text>
              )}
            </Pressable>
          ) : host.roundSubPhase === 'answering' && answeringTeam ? (
            /* The host has to judge, so the host has to know the answer.
               This used to say only "X buzzed in — judge their answer",
               which asked for a ruling without supplying the information.
               No spoiler risk: the host runs the board and never buzzes —
               the teams are the connected phones. */
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                {answeringTeam.name} buzzed in
              </Text>
              {host.currentSong ? (
                <>
                  <Text
                    style={{
                      color: '#fff',
                      fontSize: 20,
                      fontWeight: '800',
                      marginTop: 8,
                      textAlign: 'center',
                    }}
                  >
                    {host.currentSong.title}
                  </Text>
                  <Text
                    style={{ color: '#fff', fontSize: 15, textAlign: 'center' }}
                  >
                    {host.currentSong.artist}
                  </Text>
                  {host.currentSong.source ? (
                    <Text
                      style={{
                        color: '#fff',
                        opacity: 0.85,
                        fontSize: 12,
                        marginTop: 2,
                        textAlign: 'center',
                      }}
                    >
                      from {host.currentSong.source}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : host.roundSubPhase === 'reveal' && host.lastReveal ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>ANSWER</Text>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontSize: 18,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                {host.lastReveal.songTitle}
              </Text>
              <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
                {host.lastReveal.artist}
              </Text>
              {host.lastReveal.source ? (
                <Text style={{ color: colors.accent, fontSize: 13, marginTop: 4 }}>
                  from {host.lastReveal.source}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={{ color: colors.textMuted }}>Loading round…</Text>
          )}
        </View>

        {/* Pack chooser. The picking team calls it out and the host taps —
            no new protocol messages, and it keeps the host as the MC in the
            same way a real game show works. Letting the picking client
            choose on their own phone is the natural v1.1 upgrade. */}
        {host.roundSubPhase === 'picking' ? (
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              {pickingTeam
                ? `${pickingTeam.name}, which pack?`
                : 'Choose a pack for this round'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {gamePacks.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => hostPickPlaylist(p.id)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderRadius: radii.md,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: pickingTeam?.color ?? colors.border,
                    minWidth: '47%',
                  }}
                >
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontWeight: '700',
                      fontSize: 14,
                    }}
                    numberOfLines={2}
                  >
                    {p.name}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    {p.totalTracks} tracks
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Action buttons for 'answering' sub-phase */}
        {host.roundSubPhase === 'answering' ? (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <Pressable
              onPress={() => {
                void controls.play(host.currentSong!).catch(() => {});
                hostJudgeWrong();
              }}
              style={{
                flex: 1,
                padding: 18,
                backgroundColor: colors.danger,
                borderRadius: radii.md,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                Wrong
              </Text>
            </Pressable>
            <Pressable
              onPress={hostJudgeCorrect}
              style={{
                flex: 1,
                padding: 18,
                backgroundColor: colors.success,
                borderRadius: radii.md,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                Correct
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Family test feedback flags — appears during reveal + answering
            sub-phases so host can flag while judging or after the fact. */}
        {(host.roundSubPhase === 'reveal' || host.roundSubPhase === 'answering') &&
        host.currentSong &&
        host.currentPlaylistId ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Pressable
              onPress={() => handleFlagCurrent('remove')}
              style={{
                flex: 1,
                padding: 12,
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                🗑  Remove
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                Skip forever
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleFlagCurrent('bad-version')}
              style={{
                flex: 1,
                padding: 12,
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '600' }}>
                🎵  Bad version
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                Song good, recording bad
              </Text>
            </Pressable>
          </View>
        ) : null}
        {currentFlagged ? (
          <Text
            style={{
              color: colors.accent,
              fontSize: 11,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            ✓ Flagged — visible in /feedback screen
          </Text>
        ) : null}

        {/* Reveal next-round button */}
        {host.roundSubPhase === 'reveal' ? (
          <Pressable
            onPress={hostAdvanceRound}
            style={{
              padding: 16,
              backgroundColor: colors.primary,
              borderRadius: radii.md,
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              {/* "End Game" read as "abandon this game" next to the
                  "End Session" button below it, which actually does that.
                  Name the destination instead of the action. */}
              {host.currentRound >= host.totalRounds
                ? 'See Final Scores'
                : 'Next Round'}
            </Text>
          </Pressable>
        ) : null}

        {/* Team status grid */}
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 14,
            fontWeight: '600',
            marginBottom: 8,
          }}
        >
          Teams
        </Text>
        {teamsArray.map((team) => {
          const isAnswering = team.teamId === host.answeringTeamId;
          const isEliminated = host.eliminatedThisRound.includes(team.teamId);
          const score = host.scores[team.teamId] ?? 0;
          return (
            <View
              key={team.teamId}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 12,
                marginBottom: 6,
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                opacity: team.connected ? (isEliminated ? 0.45 : 1) : 0.35,
                borderWidth: isAnswering ? 2 : 1,
                borderColor: isAnswering ? colors.warning : colors.border,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: team.color,
                  marginRight: 12,
                }}
              />
              <Text style={{ color: colors.textPrimary, fontSize: 15, flex: 1 }}>
                {team.name}
              </Text>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontWeight: '700',
                  fontSize: 18,
                  marginLeft: 12,
                }}
              >
                {score}
              </Text>
              {isEliminated ? (
                <Text style={{ color: colors.danger, fontSize: 11, marginLeft: 8 }}>
                  out
                </Text>
              ) : null}
            </View>
          );
        })}

        {/* End game */}
        <Pressable
          onPress={() => {
            void stopHosting().then(() => router.replace('/'));
          }}
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textMuted }}>End Session</Text>
        </Pressable>

        {/* Now-playing song info — useful during dev */}
        {host.currentSong ? (
          <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 16, textAlign: 'center' }}>
            now playing: {host.currentSong.title} — {host.currentSong.artist}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
