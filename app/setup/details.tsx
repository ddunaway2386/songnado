/**
 * Setup wizard step 2 — teams and rules.
 *
 * One scrollable screen because three decisions aren't three screens
 * of value. Order top-to-bottom is deliberate: team count first
 * (drives what name inputs appear), then names, then rules that
 * depend on game mode (target score vs hot-streak).
 *
 * Buzz mode never reaches this screen — step 1 routes buzz users
 * straight into /buzz/host-lobby which has its own multi-device flow.
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TEAM_COLORS } from '@/lib/buzz/protocol';
import { targetScoreBounds } from '@/lib/scoring';
import type { HotStreakSetting, TurnStyle } from '@/stores/setupStore';
import {
  MAX_TEAMS,
  MIN_TEAMS,
  useSetupStore,
} from '@/stores/setupStore';
import { colors, radii } from '../../theme';

const TURN_STYLES: { id: TurnStyle; title: string; tagline: string }[] = [
  {
    id: 'alternating',
    title: 'Alternating turns',
    tagline: 'Teams take turns in order. Only one team answers each round.',
  },
  {
    id: 'free-for-all',
    title: 'Free-for-all',
    tagline: 'Any team can answer. Host taps whoever buzzed first.',
  },
];

const HOT_STREAK_OPTIONS: { id: HotStreakSetting; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'limit-3', label: 'Limit 3' },
  { id: 'unlimited', label: 'Unlimited' },
];

export default function GameDetailsScreen() {
  const gameMode = useSetupStore((s) => s.gameMode);
  const teamCount = useSetupStore((s) => s.teamCount);
  const teamNames = useSetupStore((s) => s.teamNames);
  const turnStyle = useSetupStore((s) => s.turnStyle);
  const targetScore = useSetupStore((s) => s.targetScore);
  const hotStreakSetting = useSetupStore((s) => s.hotStreakSetting);
  const setTeamCount = useSetupStore((s) => s.setTeamCount);
  const setTeamName = useSetupStore((s) => s.setTeamName);
  const setTurnStyle = useSetupStore((s) => s.setTurnStyle);
  const setTargetScore = useSetupStore((s) => s.setTargetScore);
  const setHotStreakSetting = useSetupStore((s) => s.setHotStreakSetting);

  const showTargetScore = gameMode === 'classic' || gameMode === 'blitz';
  const showHotStreak = gameMode === 'elimination';
  const bounds = targetScoreBounds(gameMode);

  const teamCountChips = Array.from(
    { length: MAX_TEAMS - MIN_TEAMS + 1 },
    (_, i) => MIN_TEAMS + i
  );

  function handleContinue() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router regenerates types on start
    router.push('/setup/playlists' as any);
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ marginBottom: 24 }}>
          <Text style={styles.stepChip}>Step 2 of 3</Text>
          <Text style={styles.stepHeader}>Teams and rules</Text>
        </View>

        {/* Team count chips */}
        <Text style={styles.sectionLabel}>Number of teams</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
          {teamCountChips.map((n) => {
            const active = teamCount === n;
            return (
              <Pressable
                key={n}
                onPress={() => setTeamCount(n)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  borderRadius: radii.md,
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: active ? '#fff' : colors.textPrimary,
                    fontSize: 20,
                    fontWeight: '700',
                  }}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Team names */}
        <Text style={styles.sectionLabel}>Team names</Text>
        <View style={{ gap: 10, marginBottom: 24 }}>
          {teamNames.slice(0, teamCount).map((name, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 12,
                paddingVertical: 4,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: TEAM_COLORS[i % TEAM_COLORS.length],
                  marginRight: 12,
                }}
              />
              <TextInput
                value={name}
                onChangeText={(t) => setTeamName(i, t)}
                placeholder={`Team ${i + 1}`}
                placeholderTextColor={colors.textMuted}
                maxLength={24}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  color: colors.textPrimary,
                  fontSize: 16,
                }}
              />
            </View>
          ))}
        </View>

        {/* Turn style — big cards */}
        <Text style={styles.sectionLabel}>Turn style</Text>
        <View style={{ gap: 10, marginBottom: 24 }}>
          {TURN_STYLES.map((t) => {
            const active = turnStyle === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTurnStyle(t.id)}
                style={{
                  padding: 16,
                  borderRadius: radii.lg,
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderWidth: 2,
                  borderColor: active ? colors.textPrimary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? '#fff' : colors.textPrimary,
                    fontSize: 16,
                    fontWeight: '700',
                    marginBottom: 4,
                  }}
                >
                  {t.title}
                </Text>
                <Text
                  style={{
                    color: active ? 'rgba(255,255,255,0.85)' : colors.textMuted,
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  {t.tagline}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Target score — Classic + Blitz */}
        {showTargetScore ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={styles.sectionLabel}>Target score</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: colors.surface,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 8,
              }}
            >
              <Pressable
                onPress={() =>
                  setTargetScore(Math.max(bounds.min, targetScore - bounds.step))
                }
                disabled={targetScore <= bounds.min}
                style={styles.stepBtn(targetScore <= bounds.min)}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <View style={{ alignItems: 'center', flex: 1 }}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 32,
                    fontWeight: '800',
                  }}
                >
                  {targetScore}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {bounds.min}–{bounds.max}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  setTargetScore(Math.min(bounds.max, targetScore + bounds.step))
                }
                disabled={targetScore >= bounds.max}
                style={styles.stepBtn(targetScore >= bounds.max)}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Hot Streak — Elimination only */}
        {showHotStreak ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={styles.sectionLabel}>Hot Streak</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
              {HOT_STREAK_OPTIONS.map((opt) => {
                const active = hotStreakSetting === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => setHotStreakSetting(opt.id)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: radii.full,
                      backgroundColor: active
                        ? colors.primary
                        : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: active ? '#fff' : colors.textPrimary,
                        fontSize: 14,
                        fontWeight: '600',
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              Get both song + artist on your own pick? Pick again immediately.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky continue */}
      <View
        style={{
          padding: 16,
          paddingBottom: 20,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={handleContinue}
          style={{
            backgroundColor: colors.primary,
            padding: 18,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
            Continue
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = {
  stepChip: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
  },
  stepHeader: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: '800' as const,
    marginTop: 8,
    lineHeight: 38,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
    fontWeight: '600' as const,
    marginBottom: 10,
  },
  stepBtn: (disabled: boolean) => ({
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: disabled ? colors.surfaceAlt : colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }),
  stepBtnText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700' as const,
    marginTop: -4,
  },
};
