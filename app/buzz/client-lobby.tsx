/**
 * Client-side buzz lobby screen.
 *
 * Shown after a successful JOIN. The client sees their own team
 * identity, the host's lobby roster, and can toggle Ready. When the
 * host starts the game, phase advances to client:playing and we'll
 * route into the gameplay screen (Phase 4).
 */

import { router } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { colors, radii } from '../../theme';

export default function BuzzClientLobbyScreen() {
  // Guests often join then set the phone down waiting for the host to start.
  // A screen lock closes their socket and silently removes them from the lobby.
  useKeepAwake();

  const phase = useBuzzGameStore((s) => s.phase);
  const client = useBuzzGameStore((s) => s.client);
  const setReady = useBuzzGameStore((s) => s.setReady);
  const disconnect = useBuzzGameStore((s) => s.disconnect);

  const me = client.lobbyTeams.find((t) => t.teamId === client.myTeamId);
  const myReady = me?.ready ?? false;

  // Phase transitions:
  // - 'none' → host disconnected, bounce home
  // - 'client:playing' → host started game, route to gameplay screen
  // - 'client:ended' → game ended, route to game-over (Phase 4 will polish)
  useEffect(() => {
    if (phase === 'none') {
      router.replace('/');
    } else if (phase === 'client:playing') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
      router.replace('/buzz/client-game' as any);
    }
  }, [phase]);

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Me header */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 24,
              fontWeight: '700',
            }}
          >
            You&apos;re in
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 12,
              padding: 14,
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: client.myColor ?? colors.surfaceAlt,
                marginRight: 12,
              }}
            />
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 18,
                fontWeight: '600',
                flex: 1,
              }}
            >
              {client.myName ?? 'Your team'}
            </Text>
            {client.pingMs != null ? (
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {Math.round(client.pingMs)}ms
              </Text>
            ) : null}
          </View>
        </View>

        {/* Ready toggle */}
        <Pressable
          onPress={() => {
            void setReady(!myReady);
          }}
          style={{
            backgroundColor: myReady ? colors.success : colors.surface,
            padding: 18,
            borderRadius: radii.md,
            alignItems: 'center',
            marginBottom: 24,
            borderWidth: 1,
            borderColor: myReady ? colors.success : colors.border,
          }}
        >
          <Text
            style={{
              color: myReady ? '#fff' : colors.textPrimary,
              fontWeight: '700',
              fontSize: 18,
            }}
          >
            {myReady ? '✓ Ready' : 'Tap when ready'}
          </Text>
        </Pressable>

        {/* Roster */}
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 16,
            fontWeight: '600',
            marginBottom: 8,
          }}
        >
          All teams ({client.lobbyTeams.length})
        </Text>
        {client.lobbyTeams.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>
            Waiting for the host to broadcast the lobby roster…
          </Text>
        ) : (
          client.lobbyTeams.map((team) => {
            const isMe = team.teamId === client.myTeamId;
            return (
              <View
                key={team.teamId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 12,
                  backgroundColor: isMe ? colors.surfaceAlt : colors.surface,
                  borderRadius: radii.md,
                  marginBottom: 8,
                  opacity: team.connected ? 1 : 0.5,
                  borderWidth: 1,
                  borderColor: isMe ? colors.primary : colors.border,
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
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontSize: 15,
                    flex: 1,
                    fontWeight: isMe ? '700' : '400',
                  }}
                >
                  {team.name}
                  {isMe ? ' (you)' : ''}
                </Text>
                {team.ready ? (
                  <Text style={{ color: colors.success, fontSize: 12 }}>
                    READY
                  </Text>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    not ready
                  </Text>
                )}
              </View>
            );
          })
        )}

        {/* Leave */}
        <Pressable
          onPress={() => {
            Alert.alert('Leave this game?', 'You can rejoin if the host is still open.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Leave',
                style: 'destructive',
                onPress: () => {
                  void disconnect().then(() => router.replace('/'));
                },
              },
            ]);
          }}
          style={{
            backgroundColor: 'transparent',
            padding: 14,
            borderRadius: radii.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.border,
            marginTop: 16,
          }}
        >
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>
            Leave
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
