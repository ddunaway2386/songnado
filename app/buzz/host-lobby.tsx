/**
 * Host-side buzz lobby screen.
 *
 * Phase 2 scope:
 *  - Starts the BuzzServer when this screen mounts (idempotent — if a
 *    session is already running we just show its info).
 *  - Displays the connection string (host:port:sessionId) prominently
 *    so the host can read it to teammates typing it on their phones.
 *    Phase 2.5 will replace this with a QR code once the dev client
 *    picks up react-native-qrcode-svg.
 *  - Live-updates the joined-teams list as clients arrive.
 *  - Lets host tap "Start Game" once at least 2 teams are connected
 *    (Phase 3 will gate this on "all ready" instead).
 *  - Stop / cancel cleanly stops the server before unmount.
 */

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { encodeConnectionString } from '@/lib/buzz/protocol';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { colors, radii } from '../../theme';

export default function BuzzHostLobbyScreen() {
  const phase = useBuzzGameStore((s) => s.phase);
  const role = useBuzzGameStore((s) => s.role);
  const host = useBuzzGameStore((s) => s.host);
  const startHosting = useBuzzGameStore((s) => s.startHosting);
  const stopHosting = useBuzzGameStore((s) => s.stopHosting);
  const hostStartGame = useBuzzGameStore((s) => s.hostStartGame);

  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    // Start hosting on mount if not already.
    if (role !== 'host') {
      startHosting().catch((e) => {
        setStartError(e instanceof Error ? e.message : String(e));
      });
    }
    // Stop on unmount.
    return () => {
      void stopHosting();
    };
    // Only run on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectionString =
    host.localIp && host.port && host.sessionId
      ? encodeConnectionString({
          host: host.localIp,
          port: host.port,
          sessionId: host.sessionId,
        })
      : null;

  // Short manual-entry form (everything after the prefix) — easier to
  // type onto a teammate's phone than the full URI.
  const shortCode =
    host.localIp && host.port && host.sessionId
      ? `${host.localIp}:${host.port}:${host.sessionId}`
      : null;

  const teamsArray = Object.values(host.teams);
  const connectedCount = teamsArray.filter((t) => t.connected).length;
  const readyCount = teamsArray.filter((t) => t.connected && t.ready).length;

  // Phase 3 will require everyone Ready; for Phase 2 testing we allow
  // start with 2+ connected even without explicit ready.
  const canStart = connectedCount >= 2;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Status header */}
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 24,
              fontWeight: '700',
            }}
          >
            Buzz Lobby
          </Text>
          <Text style={{ color: colors.textMuted, marginTop: 4 }}>
            {phase === 'host:lobby_starting'
              ? 'Starting server…'
              : phase === 'host:lobby_open'
                ? 'Waiting for teams to join'
                : phase}
          </Text>
        </View>

        {startError ? (
          <View
            style={{
              backgroundColor: colors.danger,
              padding: 12,
              borderRadius: radii.md,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#fff' }}>{startError}</Text>
          </View>
        ) : null}

        {/* Connection info */}
        {shortCode ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              padding: 20,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              Have each team type this on their phone
            </Text>
            <Text
              selectable
              style={{
                color: colors.textPrimary,
                fontSize: 22,
                fontFamily: 'Courier',
                fontWeight: '600',
                marginTop: 12,
                lineHeight: 32,
              }}
            >
              {shortCode}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 11,
                marginTop: 12,
              }}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {connectionString}
            </Text>
          </View>
        ) : null}

        {/* Teams list */}
        <View style={{ marginBottom: 16 }}>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 16,
              fontWeight: '600',
              marginBottom: 8,
            }}
          >
            Teams ({connectedCount} connected, {readyCount} ready)
          </Text>
          {teamsArray.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>
              No teams yet. Open Songnado on another phone and tap
              &quot;Join a buzz game&quot;.
            </Text>
          ) : (
            teamsArray.map((team) => (
              <View
                key={team.teamId}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 12,
                  backgroundColor: colors.surface,
                  borderRadius: radii.md,
                  marginBottom: 8,
                  opacity: team.connected ? 1 : 0.5,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: team.color,
                    marginRight: 12,
                  }}
                />
                <Text
                  style={{ color: colors.textPrimary, fontSize: 16, flex: 1 }}
                >
                  {team.name}
                </Text>
                {!team.connected ? (
                  <Text style={{ color: colors.danger, fontSize: 12 }}>
                    DISCONNECTED
                  </Text>
                ) : team.ready ? (
                  <Text style={{ color: colors.success, fontSize: 12 }}>
                    READY
                  </Text>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                    Not ready
                  </Text>
                )}
              </View>
            ))
          )}
        </View>

        {/* Action buttons */}
        <Pressable
          onPress={() => {
            void hostStartGame(10);
          }}
          disabled={!canStart}
          style={{
            backgroundColor: canStart ? colors.primary : colors.surfaceAlt,
            padding: 16,
            borderRadius: radii.md,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              color: canStart ? '#fff' : colors.textMuted,
              fontWeight: '700',
              fontSize: 16,
            }}
          >
            Start Game
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            Alert.alert('End buzz session?', 'All connected teams will be disconnected.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'End',
                style: 'destructive',
                onPress: () => {
                  void stopHosting().then(() => router.back());
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
          }}
        >
          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>
            End Session
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
