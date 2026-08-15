/**
 * Buzz game-over screen (host).
 *
 * Previously the host was dumped straight to the home screen when the last
 * round finished — no winner, no final scores, nothing to react to. The
 * clients received a GAME_END with the standings and the host displayed
 * none of it, which is a strange way to end a party game.
 *
 * The server is deliberately kept alive while this screen is up so the
 * connected phones stay attached and can show their own placement. It's
 * torn down when the host leaves via either button below.
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { finalRanking, useBuzzGameStore } from '@/stores/buzzGameStore';
import { colors, radii } from '../../theme';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function BuzzGameOverScreen() {
  const host = useBuzzGameStore((s) => s.host);
  const stopHosting = useBuzzGameStore((s) => s.stopHosting);
  const startHosting = useBuzzGameStore((s) => s.startHosting);

  const teams = Object.values(host.teams);
  const byScore = teams
    .map((t) => ({ ...t, score: host.scores[t.teamId] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // After a play-off the tied teams still hold identical scores — that's
  // the whole reason it happened — so score order would announce a tie that
  // sudden death just settled. Use the resolved order instead.
  const standings = host.suddenDeath
    ? (finalRanking(host)
        .map((id) => byScore.find((t) => t.teamId === id))
        .filter(Boolean) as typeof byScore)
    : byScore;

  const topScore = byScore[0]?.score ?? 0;
  // Flat 1-point-per-round scoring makes genuine ties common, so the screen
  // has to handle more than one winner rather than crowning standings[0].
  const winners = host.suddenDeath
    ? standings.slice(0, 1)
    : standings.filter((t) => t.score === topScore && topScore > 0);
  const isTie = winners.length > 1;

  function leave(then: () => void) {
    void stopHosting().finally(then);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
            fontWeight: '600',
            textAlign: 'center',
          }}
        >
          {host.totalRounds} rounds
          {host.suddenDeath ? ' · settled in sudden death' : ' · game over'}
        </Text>

        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 34,
            fontWeight: '800',
            textAlign: 'center',
            marginTop: 8,
            lineHeight: 40,
          }}
        >
          {winners.length === 0
            ? 'Nobody scored!'
            : isTie
              ? `Tie — ${winners.map((w) => w.name).join(' & ')}`
              : `${winners[0].name} wins!`}
        </Text>

        {winners.length > 0 ? (
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 15,
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            {topScore} of {host.totalRounds} rounds
          </Text>
        ) : null}

        {/* Standings */}
        <View style={{ marginTop: 28, gap: 10 }}>
          {standings.map((t, i) => {
            const isWinner = t.score === topScore && topScore > 0;
            return (
              <View
                key={t.teamId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 16,
                  borderRadius: radii.md,
                  backgroundColor: isWinner ? colors.surfaceAlt : colors.surface,
                  borderWidth: 2,
                  borderColor: isWinner ? t.color : colors.border,
                }}
              >
                <Text style={{ fontSize: 24, width: 34 }}>
                  {MEDALS[i] ?? `${i + 1}.`}
                </Text>
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: t.color,
                  }}
                />
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 18,
                    fontWeight: isWinner ? '800' : '600',
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {t.name}
                </Text>
                <Text
                  style={{
                    color: isWinner ? colors.textPrimary : colors.textMuted,
                    fontSize: 22,
                    fontWeight: '800',
                  }}
                >
                  {t.score}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Rematch keeps everyone connected: stop the old session, start a
            fresh one, and land back in the lobby so teams can re-join. */}
        <Pressable
          onPress={() =>
            leave(() => {
              void startHosting().finally(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev start
                router.replace('/buzz/host-lobby' as any);
              });
            })
          }
          style={{
            marginTop: 28,
            backgroundColor: colors.primary,
            padding: 16,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
            Play again
          </Text>
        </Pressable>

        <Pressable
          onPress={() => leave(() => router.replace('/'))}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: radii.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>
            Done
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
