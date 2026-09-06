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

import { SongRevealCard } from '@/components/SongRevealCard';
import { usePlayer } from '@/hooks/usePlayer';
import { TEST_TOOLS_ENABLED } from '@/lib/featureFlags';
import { PREVIEW_DURATION_S } from '@/lib/scoring';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { useFeedbackStore } from '@/stores/feedbackStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { colors, radii } from '../../theme';

/**
 * What the host should say out loud. Sudden death has two different rules
 * depending on how many teams are tied, and the host is the one explaining
 * it to the room.
 */
function suddenDeathBlurb(host: {
  suddenDeathContenders: string[];
  suddenDeathSafe: string[];
  teams: Record<string, { teamId: string; name: string }>;
}): string {
  const nameOf = (id: string) => host.teams[id]?.name ?? 'a team';
  const contenders = host.suddenDeathContenders;
  if (contenders.length <= 2) {
    return `${contenders.map(nameOf).join(' vs ')} — tied. First correct answer wins it.`;
  }
  const unsafe = contenders.filter((id) => !host.suddenDeathSafe.includes(id));
  return (
    `${contenders.length} teams tied. A correct answer puts you through; ` +
    `the last team left goes out. Still to survive: ${unsafe.map(nameOf).join(', ')}.`
  );
}

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
  const hostSetPaused = useBuzzGameStore((s) => s.hostSetPaused);
  const hostTimeoutRound = useBuzzGameStore((s) => s.hostTimeoutRound);
  const hostAwardRound = useBuzzGameStore((s) => s.hostAwardRound);
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

  // Pause/resume the audio alongside the buzzers. Resume continues the clip
  // rather than restarting it — the same reasoning as a wrong answer: the
  // room shouldn't re-hear what it already heard, and the teams waiting
  // shouldn't get a longer listen because someone's phone dropped.
  const wasPausedRef = useRef(host.paused);
  useEffect(() => {
    const was = wasPausedRef.current;
    wasPausedRef.current = host.paused;
    if (host.paused === was) return;
    if (host.paused) {
      void controls.pause();
    } else if (host.roundSubPhase === 'playing' && host.currentSong) {
      void controls
        .play(host.currentSong, { resume: true })
        .catch(() => {});
    }
  }, [host.paused, host.roundSubPhase, host.currentSong, controls]);

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
      // Goes through the store so the guests are TOLD. Writing the reveal
      // straight into state here broadcast nothing, so on every round where
      // nobody buzzed the guests kept a live-looking buzzer that silently
      // swallowed their taps and never showed them the answer.
      hostTimeoutRound();
    }
  }, [status.didJustFinish, host.roundSubPhase, hostTimeoutRound]);

  const answeringTeam = host.answeringTeamId
    ? host.teams[host.answeringTeamId]
    : null;
  const pickingTeam = host.pickingTeamId ? host.teams[host.pickingTeamId] : null;
  const gamePacks = allPlaylists.filter((p) => host.playlistIds.includes(p.id));

  // A team can't take the same pack twice in a row on their own turns —
  // otherwise one team just picks Broadway every time it comes round. They
  // can still come back to it after picking something else.
  //
  // Only applies when there's somewhere else to go: with a single pack in
  // the game, blocking it would leave the picker with nothing to tap.
  const blockedPackId =
    gamePacks.length > 1 && host.pickingTeamId
      ? (host.lastPickByTeam[host.pickingTeamId] ?? null)
      : null;

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
          <Text
            style={{
              color: host.suddenDeath ? colors.danger : colors.textPrimary,
              fontSize: 20,
              fontWeight: '700',
            }}
          >
            {host.suddenDeath
              ? 'SUDDEN DEATH'
              : `Round ${host.currentRound} / ${host.totalRounds}`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {host.currentPlaylistName}
            </Text>
            {/* Only offer pause when there's something to pause — during a
                pick or a reveal the game is already waiting on the host. */}
            {/* Skip the track. Previews occasionally just don't start, and
                without this the round is dead air the host can only wait out
                — an empty round with nothing to buzz on. Reloads the same
                round rather than advancing, so the count stays honest. */}
            {!host.paused &&
            !loadingTrack &&
            (host.roundSubPhase === 'playing' || trackError) ? (
              <Pressable
                onPress={() => {
                  void controls.pause();
                  void loadAndPlay();
                }}
                hitSlop={8}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                  ⏭ Skip
                </Text>
              </Pressable>
            ) : null}
            {!host.paused &&
            (host.roundSubPhase === 'playing' ||
              host.roundSubPhase === 'answering') ? (
              <Pressable
                onPress={() => hostSetPaused(true)}
                hitSlop={8}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                  ⏸ Pause
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Paused banner + the control to lift it. Sits above everything
            else because while it's up, nothing else on screen is live. */}
        {host.paused ? (
          <View
            style={{
              padding: 14,
              borderRadius: radii.md,
              backgroundColor: colors.warning,
              marginBottom: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#000', fontWeight: '800', fontSize: 16 }}>
              ⏸  Game paused
            </Text>
            {host.pausedReason ? (
              <Text
                style={{ color: '#000', opacity: 0.75, fontSize: 13, marginTop: 2 }}
              >
                {host.pausedReason}
              </Text>
            ) : null}
            <Pressable
              onPress={() => hostSetPaused(false)}
              style={{
                marginTop: 10,
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderRadius: radii.md,
                backgroundColor: '#000',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Resume</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Sudden death explainer — the host is the MC and has to announce
            what's going on, so spell out the rule rather than assuming. */}
        {host.suddenDeath ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              marginBottom: 12,
              lineHeight: 17,
            }}
          >
            {suddenDeathBlurb(host)}
          </Text>
        ) : null}

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
                <View style={{ marginTop: 8 }}>
                  <SongRevealCard
                    title={host.currentSong.title}
                    artist={host.currentSong.artist}
                    source={host.currentSong.source}
                    coverUrl={host.currentSong.coverUrl}
                    size="peek"
                    tone="onColor"
                  />
                </View>
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
                <View style={{ marginTop: 8 }}>
                  <SongRevealCard
                    title={host.currentSong.title}
                    artist={host.currentSong.artist}
                    source={host.currentSong.source}
                    coverUrl={host.currentSong.coverUrl}
                    size="compact"
                    tone="onColor"
                  />
                </View>
              ) : null}
            </View>
          ) : host.roundSubPhase === 'reveal' && host.lastReveal ? (
            <SongRevealCard
              title={host.lastReveal.songTitle}
              artist={host.lastReveal.artist}
              source={host.lastReveal.source}
              coverUrl={host.lastReveal.coverUrl}
              size="full"
              label="ANSWER"
            />
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
              {gamePacks.map((p) => {
                const blocked = p.id === blockedPackId;
                return (
                  <Pressable
                    key={p.id}
                    disabled={blocked}
                    onPress={() => hostPickPlaylist(p.id)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderRadius: radii.md,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: blocked
                        ? colors.border
                        : (pickingTeam?.color ?? colors.border),
                      minWidth: '47%',
                      opacity: blocked ? 0.4 : 1,
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
                    <Text
                      style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}
                    >
                      {blocked ? 'your last pick' : `${p.totalTracks} tracks`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Action buttons for 'answering' sub-phase */}
        {host.roundSubPhase === 'answering' ? (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <Pressable
              onPress={() => {
                // Resume, don't restart: the remaining teams pick up the
                // clip where it stopped. A restart would replay what the
                // room already heard and give them a longer listen than
                // the team that just missed.
                void controls
                  .play(host.currentSong!, { resume: true })
                  .catch(() => {});
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

{TEST_TOOLS_ENABLED ? (
        <>
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
        </>
        ) : null}

        {/* Host override. Judging a buzz is a person making a call in a
            noisy room, and sometimes the call is wrong — a team answered
            before the buzz registered, or the wrong button got tapped.
            Reassigns the point rather than adding one, so corrections can't
            inflate anyone's score. Hidden in sudden death once awarded,
            because that advances a bracket there's no safe way to unwind. */}
        {host.roundSubPhase === 'reveal' &&
        !(host.suddenDeath && host.roundAwardedTo != null) ? (
          <View style={{ marginBottom: 16 }}>
            <Text
              style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}
            >
              {host.roundAwardedTo
                ? 'Point went to the wrong team? Give it to:'
                : 'Award this round to:'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {teamsArray.map((t) => {
                const holder = host.roundAwardedTo === t.teamId;
                return (
                  <Pressable
                    key={t.teamId}
                    onPress={() => hostAwardRound(holder ? null : t.teamId)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: radii.md,
                      backgroundColor: holder ? t.color : colors.surface,
                      borderWidth: 1,
                      borderColor: holder ? t.color : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: holder ? '#fff' : colors.textPrimary,
                        fontWeight: '700',
                        fontSize: 13,
                      }}
                    >
                      {holder ? '✓ ' : ''}
                      {t.name}
                    </Text>
                  </Pressable>
                );
              })}
              {!host.suddenDeath && host.roundAwardedTo ? (
                <Pressable
                  onPress={() => hostAwardRound(null)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.textMuted, fontWeight: '700', fontSize: 13 }}>
                    No one
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
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
                  Name the destination instead of the action.

                  In sudden death currentRound runs past totalRounds, so the
                  round count can't decide this — whether the play-off has
                  produced a winner does. */}
              {host.suddenDeath
                ? host.suddenDeathContenders.length <= 1
                  ? 'See Final Scores'
                  : 'Next Sudden-Death Round'
                : host.currentRound >= host.totalRounds
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
