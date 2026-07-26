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
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePlayer } from '@/hooks/usePlayer';
import { PREVIEW_DURATION_S } from '@/lib/scoring';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { colors, radii } from '../../theme';

export default function BuzzHostGameScreen() {
  const phase = useBuzzGameStore((s) => s.phase);
  const host = useBuzzGameStore((s) => s.host);
  const hostBeginRound = useBuzzGameStore((s) => s.hostBeginRound);
  const hostJudgeCorrect = useBuzzGameStore((s) => s.hostJudgeCorrect);
  const hostJudgeWrong = useBuzzGameStore((s) => s.hostJudgeWrong);
  const hostAdvanceRound = useBuzzGameStore((s) => s.hostAdvanceRound);
  const stopHosting = useBuzzGameStore((s) => s.stopHosting);

  const fetchNextPlayableTrack = usePlaylistStore(
    (s) => s.fetchNextPlayableTrack
  );
  const [status, controls] = usePlayer();

  const [loadingTrack, setLoadingTrack] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  // Bounce home if the game ends.
  useEffect(() => {
    if (phase === 'host:ended') {
      router.replace('/');
    } else if (phase === 'none') {
      router.replace('/');
    }
  }, [phase]);

  // Load + play next track when sub-phase becomes 'idle' (start of a round).
  // Uses the shared playlistStore rotation (so buzz mode shares the same
  // "what's been played recently" state as normal gameplay).
  const loadAndPlay = useCallback(async () => {
    if (!host.currentPlaylistId) return;
    setLoadingTrack(true);
    setTrackError(null);
    try {
      const { useFeedbackStore } = await import('@/stores/feedbackStore');
      const isFlagged = useFeedbackStore.getState().isFlagged;
      const result = await fetchNextPlayableTrack(
        host.currentPlaylistId,
        (song) => isFlagged(host.currentPlaylistId!, song.title, song.artist)
      );
      if (!result) {
        setTrackError('No playable track in this playlist.');
        setLoadingTrack(false);
        return;
      }
      hostBeginRound(result.song, result.index);
      await controls.play(result.song);
    } catch (e) {
      setTrackError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTrack(false);
    }
  }, [host.currentPlaylistId, fetchNextPlayableTrack, hostBeginRound, controls]);

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

  // Mount: kick off first round.
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
          ) : host.roundSubPhase === 'playing' ? (
            <Text style={{ color: '#fff', fontWeight: '700' }}>
              ♪ Playing… {Math.round(status.currentTime)}s / {PREVIEW_DURATION_S}s
            </Text>
          ) : host.roundSubPhase === 'answering' && answeringTeam ? (
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              {answeringTeam.name} buzzed in — judge their answer
            </Text>
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
              {host.currentRound >= host.totalRounds ? 'End Game' : 'Next Round'}
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
