/**
 * Client-side buzz gameplay screen.
 *
 * The simple side: render a giant BUZZ button in your team color whose
 * appearance + behavior reflect the `buzzButton` state pushed from the
 * host:
 *   'locked'        → dim, no-op
 *   'armed'         → huge colored button, tap to send BUZZ
 *   'i_buzzed'      → "Your turn!" — tell the host the answer
 *   'other_buzzed'  → "<other team> is answering…"
 *   'eliminated'    → "Out this round" (waiting for next round)
 *
 * When the round ends, the host broadcasts ROUND_END with the reveal.
 * The store puts the reveal into client.lastReveal and resets the
 * button to 'locked'; we display the reveal banner briefly.
 *
 * On GAME_END the store phase becomes 'client:ended' → bounce home.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { colors, radii } from '../../theme';

export default function BuzzClientGameScreen() {
  const phase = useBuzzGameStore((s) => s.phase);
  const client = useBuzzGameStore((s) => s.client);
  const pressBuzz = useBuzzGameStore((s) => s.pressBuzz);
  const disconnect = useBuzzGameStore((s) => s.disconnect);

  // 'none' means the session is gone (host ended it, or we disconnected)
  // → nothing to show, go home. 'client:ended' is a FINISHED game, which
  // now renders final standings below rather than bouncing.
  useEffect(() => {
    if (phase === 'none') {
      router.replace('/');
    }
  }, [phase]);

  const state = client.buzzButton;
  const myColor = client.myColor ?? colors.primary;

  if (phase === 'client:ended') {
    const nameFor = (teamId: string) =>
      client.lobbyTeams.find((t) => t.teamId === teamId)?.name ?? 'Team';
    const myPlace = client.finalRanking.indexOf(client.myTeamId ?? '');
    const topScore = client.finalScores[client.finalRanking[0]] ?? 0;
    const myScore = client.finalScores[client.myTeamId ?? ''] ?? 0;
    const iWon = myScore === topScore && topScore > 0;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 30,
              fontWeight: '800',
              textAlign: 'center',
              marginTop: 12,
            }}
          >
            {iWon ? '🏆 You win!' : 'Game over'}
          </Text>
          {myPlace >= 0 ? (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 16,
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              {iWon
                ? `${myScore} rounds`
                : `You finished #${myPlace + 1} with ${myScore}`}
            </Text>
          ) : null}

          <View style={{ marginTop: 24, gap: 8 }}>
            {client.finalRanking.map((teamId, i) => {
              const mine = teamId === client.myTeamId;
              return (
                <View
                  key={teamId}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    borderRadius: radii.md,
                    backgroundColor: mine ? colors.surfaceAlt : colors.surface,
                    borderWidth: mine ? 2 : 1,
                    borderColor: mine ? myColor : colors.border,
                  }}
                >
                  <Text style={{ color: colors.textMuted, width: 30, fontSize: 16 }}>
                    {i + 1}.
                  </Text>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 16,
                      fontWeight: mine ? '800' : '600',
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {nameFor(teamId)}
                    {mine ? ' (you)' : ''}
                  </Text>
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: 18,
                      fontWeight: '700',
                    }}
                  >
                    {client.finalScores[teamId] ?? 0}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              textAlign: 'center',
              marginTop: 20,
            }}
          >
            Stay here — if the host starts another game you&apos;ll rejoin from
            the lobby.
          </Text>

          <Pressable
            onPress={() => {
              void disconnect().then(() => router.replace('/'));
            }}
            style={{
              marginTop: 20,
              padding: 14,
              borderRadius: radii.md,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.textMuted, fontWeight: '600' }}>
              Leave game
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const otherTeamName = (() => {
    // 'other_buzzed' means SOME team buzzed; in Phase 3 we don't pass
    // the winning team's identity down separately, but it's in the
    // host LOBBY_STATE → not quite right. For Phase 3 just say
    // "Another team buzzed". Phase 4 polishes this.
    return 'Another team';
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: 16, flexGrow: 1 }}>
        {/* My team header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            padding: 12,
            backgroundColor: colors.surface,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            marginBottom: 24,
          }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: myColor,
              marginRight: 12,
            }}
          />
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 16,
              fontWeight: '700',
              flex: 1,
            }}
          >
            {client.myName ?? 'You'}
          </Text>
          {client.pingMs != null ? (
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {Math.round(client.pingMs)}ms
            </Text>
          ) : null}
        </View>

        {/* Reveal banner (when most recently a round ended) */}
        {state === 'locked' && client.lastReveal ? (
          <View
            style={{
              padding: 14,
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 24,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              ANSWER
            </Text>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 18,
                fontWeight: '700',
                marginTop: 4,
                textAlign: 'center',
              }}
            >
              {client.lastReveal.songTitle}
            </Text>
            <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
              {client.lastReveal.artist}
            </Text>
            {client.lastReveal.source ? (
              <Text
                style={{ color: colors.accent, fontSize: 13, marginTop: 4 }}
              >
                from {client.lastReveal.source}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* The big buzz button */}
        <Pressable
          onPress={() => {
            if (state !== 'armed') return;
            void pressBuzz();
          }}
          disabled={state !== 'armed'}
          style={{
            flex: 1,
            minHeight: 280,
            backgroundColor:
              state === 'armed'
                ? myColor
                : state === 'i_buzzed'
                  ? colors.primary
                  : state === 'eliminated'
                    ? colors.danger
                    : colors.surface,
            borderRadius: radii.xl,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            marginBottom: 16,
            opacity:
              state === 'locked' || state === 'other_buzzed' ? 0.5 : 1,
            borderWidth: 2,
            borderColor:
              state === 'armed' ? '#fff' : colors.border,
          }}
        >
          {state === 'armed' ? (
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 56 }}>
              BUZZ
            </Text>
          ) : state === 'i_buzzed' ? (
            <>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 28 }}>
                YOUR TURN!
              </Text>
              <Text
                style={{
                  color: '#fff',
                  fontSize: 14,
                  textAlign: 'center',
                  marginTop: 8,
                  paddingHorizontal: 12,
                }}
              >
                Tell the host the song + artist
              </Text>
            </>
          ) : state === 'other_buzzed' ? (
            <Text
              style={{
                color: colors.textPrimary,
                fontWeight: '600',
                fontSize: 18,
                textAlign: 'center',
              }}
            >
              {otherTeamName} is answering…
            </Text>
          ) : state === 'eliminated' ? (
            <>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>
                OUT
              </Text>
              <Text style={{ color: '#fff', fontSize: 13, marginTop: 6 }}>
                Wait for next round
              </Text>
            </>
          ) : (
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 16,
                textAlign: 'center',
              }}
            >
              Get ready…
            </Text>
          )}
        </Pressable>

        {/* Leave button */}
        <Pressable
          onPress={() => {
            void disconnect().then(() => router.replace('/'));
          }}
          style={{
            padding: 12,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.textMuted }}>Leave game</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
