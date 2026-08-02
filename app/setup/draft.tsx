/**
 * Elimination draft screen — teams shape the pack pool before the game starts.
 *
 * Rules:
 *  - 2 teams: snake draft — team A protects, team B protects, team B eliminates,
 *    team A eliminates. (Draft order is randomized per game; snake reverses on
 *    the eliminate phase for fairness.)
 *  - 3+ teams: single random-order pass. Each team picks ONE action (protect
 *    OR eliminate). No snake; simpler flow scales better.
 *  - Protected packs can't be eliminated. If a team tries, we visually block it.
 *
 * On complete: filters eliminated packs out of selectedPlaylistIds and calls
 * startGame with playOrder = inverse of draft order (whoever picked last
 * plays first — fairness gap covers the info-disadvantage of drafting first).
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Playlist } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSetupStore } from '@/stores/setupStore';
import { colors, radii } from '../../theme';

type Action = 'protect' | 'eliminate';

/** Fisher-Yates shuffle for the initial draft order. */
function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build the sequence of (teamIndex, allowedActions) tuples for the draft.
 *  - 2 teams (snake): [ (A, protect), (B, protect), (B, eliminate), (A, eliminate) ]
 *  - 3+ teams:       [ (T1, both), (T2, both), (T3, both), ... ]
 */
function buildDraftSequence(
  draftOrder: number[]
): Array<{ teamIndex: number; allowed: Action[] }> {
  if (draftOrder.length === 2) {
    const [a, b] = draftOrder;
    return [
      { teamIndex: a, allowed: ['protect'] },
      { teamIndex: b, allowed: ['protect'] },
      { teamIndex: b, allowed: ['eliminate'] },
      { teamIndex: a, allowed: ['eliminate'] },
    ];
  }
  return draftOrder.map((teamIndex) => ({
    teamIndex,
    allowed: ['protect', 'eliminate'] as Action[],
  }));
}

export default function DraftScreen() {
  const teamCount = useSetupStore((s) => s.teamCount);
  const teamNames = useSetupStore((s) => s.teamNames);
  const targetScore = useSetupStore((s) => s.targetScore);
  const gameMode = useSetupStore((s) => s.gameMode);
  const turnStyle = useSetupStore((s) => s.turnStyle);
  const hotStreakSetting = useSetupStore((s) => s.hotStreakSetting);
  const selectedPlaylistIds = useSetupStore((s) => s.selectedPlaylistIds);

  const allPlaylists = usePlaylistStore((s) => s.playlists);
  const startGame = useGameStore((s) => s.startGame);

  // Frozen at first render — same order for the entire draft session.
  const draftOrder = useMemo(
    () => shuffled(Array.from({ length: teamCount }, (_, i) => i)),
    [teamCount]
  );
  const sequence = useMemo(() => buildDraftSequence(draftOrder), [draftOrder]);

  const [stepIdx, setStepIdx] = useState(0);
  const [protectedIds, setProtectedIds] = useState<Set<string>>(new Set());
  const [eliminatedIds, setEliminatedIds] = useState<Set<string>>(new Set());
  const [pickedActionThisStep, setPickedActionThisStep] = useState<Action | null>(
    null
  );

  const draftedPlaylists: Playlist[] = allPlaylists.filter((p) =>
    selectedPlaylistIds.includes(p.id)
  );
  const isDone = stepIdx >= sequence.length;
  const currentStep = sequence[stepIdx];
  const currentTeamName = currentStep
    ? teamNames[currentStep.teamIndex] ?? `Team ${currentStep.teamIndex + 1}`
    : '';

  // For 3+ teams, the team chooses protect or eliminate. Locked in when they
  // tap the action button. For 2 teams, allowed is a single action so we
  // pre-select it.
  const effectiveAction: Action | null = currentStep
    ? currentStep.allowed.length === 1
      ? currentStep.allowed[0]
      : pickedActionThisStep
    : null;

  function handleTilePress(playlistId: string) {
    if (isDone || !currentStep || !effectiveAction) return;
    if (effectiveAction === 'eliminate' && protectedIds.has(playlistId)) return;
    if (effectiveAction === 'protect' && eliminatedIds.has(playlistId)) return;
    // Can't re-mark the same tile.
    if (protectedIds.has(playlistId) || eliminatedIds.has(playlistId)) return;

    if (effectiveAction === 'protect') {
      const next = new Set(protectedIds);
      next.add(playlistId);
      setProtectedIds(next);
    } else {
      const next = new Set(eliminatedIds);
      next.add(playlistId);
      setEliminatedIds(next);
    }
    setStepIdx(stepIdx + 1);
    setPickedActionThisStep(null);
  }

  function handleSkip() {
    // 3+ team flow only: let a team pass their turn if they don't want to
    // protect or eliminate anything. Advances without changing sets.
    setStepIdx(stepIdx + 1);
    setPickedActionThisStep(null);
  }

  function handleStart() {
    const remaining = selectedPlaylistIds.filter((id) => !eliminatedIds.has(id));
    // playOrder = inverse of draft (last to pick plays first). If any
    // eliminates dropped everyone's packs to zero (shouldn't happen — draft
    // caps at teamCount actions), fall back to selectedPlaylistIds.
    const playOrder = draftOrder.slice().reverse();
    startGame({
      teamNames: teamNames.slice(0, teamCount),
      selectedPlaylistIds: remaining.length > 0 ? remaining : selectedPlaylistIds,
      gameMode,
      targetScore,
      turnStyle,
      hotStreakSetting,
      playOrder,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev start
    router.replace('/game' as any);
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {/* Header */}
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              letterSpacing: 2,
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Draft
          </Text>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 28,
              fontWeight: '800',
              marginTop: 6,
              lineHeight: 32,
            }}
          >
            {isDone ? 'Draft complete' : `${currentTeamName}'s turn`}
          </Text>
          {!isDone && currentStep ? (
            <Text style={{ color: colors.textMuted, marginTop: 6 }}>
              {currentStep.allowed.length === 1
                ? currentStep.allowed[0] === 'protect'
                  ? 'Tap a playlist to PROTECT it (can’t be eliminated).'
                  : 'Tap a playlist to ELIMINATE it (removed from the game).'
                : effectiveAction == null
                  ? 'Choose an action, then tap a playlist.'
                  : effectiveAction === 'protect'
                    ? 'Tap a playlist to PROTECT it.'
                    : 'Tap a playlist to ELIMINATE it.'}
            </Text>
          ) : (
            <Text style={{ color: colors.textMuted, marginTop: 6 }}>
              {selectedPlaylistIds.filter((id) => !eliminatedIds.has(id)).length}{' '}
              playlists remain. First team to clear their grid wins.
            </Text>
          )}
        </View>

        {/* Turn tracker */}
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            marginBottom: 20,
          }}
        >
          {sequence.map((step, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx && !isDone;
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: done
                    ? colors.primary
                    : active
                      ? colors.textMuted
                      : colors.border,
                }}
              />
            );
          })}
        </View>

        {/* Action chooser (3+ team flow when team hasn't picked yet) */}
        {!isDone &&
        currentStep &&
        currentStep.allowed.length === 2 &&
        effectiveAction == null ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Pressable
              onPress={() => setPickedActionThisStep('protect')}
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                padding: 16,
                borderWidth: 2,
                borderColor: colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 24 }}>🛡️</Text>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                Protect
              </Text>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  textAlign: 'center',
                  marginTop: 2,
                }}
              >
                Can’t be eliminated
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPickedActionThisStep('eliminate')}
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                padding: 16,
                borderWidth: 2,
                borderColor: colors.border,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 24 }}>❌</Text>
              <Text
                style={{
                  color: colors.textPrimary,
                  fontWeight: '700',
                  marginTop: 4,
                }}
              >
                Eliminate
              </Text>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 11,
                  textAlign: 'center',
                  marginTop: 2,
                }}
              >
                Remove from game
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Playlist grid */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {draftedPlaylists.map((p) => {
            const isProtected = protectedIds.has(p.id);
            const isEliminated = eliminatedIds.has(p.id);
            const blocked =
              isProtected ||
              isEliminated ||
              (effectiveAction === 'eliminate' && protectedIds.has(p.id));
            const disabled = isDone || !effectiveAction || blocked;

            return (
              <Pressable
                key={p.id}
                onPress={() => handleTilePress(p.id)}
                disabled={disabled}
                style={{
                  width: '48%',
                  aspectRatio: 1,
                  borderRadius: radii.md,
                  padding: 10,
                  borderWidth: 2,
                  borderColor: isProtected
                    ? '#22C55E'
                    : isEliminated
                      ? '#EF4444'
                      : colors.border,
                  backgroundColor: isEliminated
                    ? '#3F1717'
                    : isProtected
                      ? '#0F2E1B'
                      : colors.surface,
                  opacity: disabled && !isProtected && !isEliminated ? 0.4 : 1,
                  justifyContent: 'space-between',
                }}
              >
                <View>
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
                    style={{
                      color: colors.textMuted,
                      fontSize: 11,
                      marginTop: 4,
                    }}
                  >
                    {p.totalTracks} tracks
                  </Text>
                </View>
                {isProtected ? (
                  <Text style={{ fontSize: 20 }}>🛡️</Text>
                ) : isEliminated ? (
                  <Text style={{ fontSize: 20 }}>❌</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Skip button for 3+ team turns (they can pass entirely) */}
        {!isDone &&
        currentStep &&
        currentStep.allowed.length === 2 &&
        effectiveAction == null ? (
          <Pressable
            onPress={handleSkip}
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: radii.md,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              Skip turn (no protect or eliminate)
            </Text>
          </Pressable>
        ) : null}

        {/* Start Game button */}
        {isDone ? (
          <Pressable
            onPress={handleStart}
            style={{
              marginTop: 24,
              backgroundColor: colors.primary,
              padding: 16,
              borderRadius: radii.md,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                color: '#fff',
                fontWeight: '700',
                fontSize: 16,
              }}
            >
              Start Game
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.back()}
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            Back to playlist picker
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
