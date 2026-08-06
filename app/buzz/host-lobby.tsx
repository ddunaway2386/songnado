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

import { encodeConnectionString, encodeShortCode } from '@/lib/buzz/protocol';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSetupStore } from '@/stores/setupStore';
import { colors, radii } from '../../theme';

/** Round-count choices. 10 stays the default. */
const ROUND_OPTIONS = [5, 10, 15, 20] as const;
const DEFAULT_ROUNDS = 10;

export default function BuzzHostLobbyScreen() {
  const phase = useBuzzGameStore((s) => s.phase);
  const role = useBuzzGameStore((s) => s.role);
  const host = useBuzzGameStore((s) => s.host);
  const startHosting = useBuzzGameStore((s) => s.startHosting);
  const stopHosting = useBuzzGameStore((s) => s.stopHosting);
  const hostStartGame = useBuzzGameStore((s) => s.hostStartGame);

  const selectedPlaylistIds = useSetupStore((s) => s.selectedPlaylistIds);
  const playlists = usePlaylistStore((s) => s.playlists);
  // Every selected pack plays — a round draws from one at random. Buzz used
  // to take only the first, which made a 10-round game a slog through a
  // single pack.
  const gamePlaylists = playlists.filter((p) =>
    selectedPlaylistIds.includes(p.id)
  );
  const firstPlaylist = gamePlaylists[0];
  const totalTracks = gamePlaylists.reduce((n, p) => n + p.totalTracks, 0);

  const [startError, setStartError] = useState<string | null>(null);
  const [totalRounds, setTotalRounds] = useState<number>(DEFAULT_ROUNDS);

  useEffect(() => {
    // Start hosting on mount if not already.
    if (role !== 'host') {
      startHosting().catch((e) => {
        setStartError(e instanceof Error ? e.message : String(e));
      });
    }
    // Tear the server down when the host genuinely LEAVES the lobby (back
    // button, cancel) — but not when we navigate forward into the game,
    // which also unmounts this screen.
    //
    // Without this guard: Start Game sets phase to 'host:playing', the
    // router replaces this screen, this cleanup fires stopHosting(), which
    // resets phase to 'none' and drops every connected client — and the
    // game screen then bounces home because phase is 'none'. That's the
    // "Start Game kicks me back to the first screen" bug. It could only
    // ever reproduce with two phones connected, since canStart requires
    // them, so it survived until the first real multi-device test.
    //
    // Read phase at cleanup time rather than closing over it; the value
    // captured at mount is always a lobby phase.
    return () => {
      const phaseNow = useBuzzGameStore.getState().phase;
      const stillInLobby =
        phaseNow === 'host:lobby_starting' || phaseNow === 'host:lobby_open';
      if (stillInLobby) void stopHosting();
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

  // Long manual-entry form — fallback when a room code isn't available.
  const shortCode =
    host.localIp && host.port && host.sessionId
      ? `${host.localIp}:${host.port}:${host.sessionId}`
      : null;

  // The 1-3 digit room code. Null when the host had to fall back to an
  // ephemeral port, in which case guests need the long form above.
  const roomCode =
    host.localIp && host.port
      ? encodeShortCode(host.localIp, host.port)
      : null;

  const teamsArray = Object.values(host.teams);
  const connectedCount = teamsArray.filter((t) => t.connected).length;
  const readyCount = teamsArray.filter((t) => t.connected && t.ready).length;

  // Phase 3 will require everyone Ready; for Phase 2 testing we allow
  // start with 2+ connected even without explicit ready.
  const canStart = connectedCount >= 2 && firstPlaylist != null;

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
                textAlign: 'center',
              }}
            >
              {roomCode ? 'Room code' : 'Have each team type this on their phone'}
            </Text>

            {roomCode ? (
              <>
                {/* The whole point: something you can shout across a room. */}
                <Text
                  selectable
                  style={{
                    color: colors.primary,
                    fontSize: 72,
                    fontWeight: '800',
                    textAlign: 'center',
                    letterSpacing: 4,
                    marginTop: 4,
                  }}
                >
                  {roomCode}
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 13,
                    textAlign: 'center',
                    marginTop: 4,
                  }}
                >
                  On the other phone: Join a Buzz Game → enter {roomCode}
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: 11,
                    textAlign: 'center',
                    marginTop: 10,
                  }}
                >
                  Everyone must be on the same Wi-Fi
                </Text>
              </>
            ) : (
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
            )}

            {/* Long form kept as a fallback — needed when the fixed port was
                taken, or on networks where the /24 assumption doesn't hold. */}
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 10,
                marginTop: 12,
                textAlign: 'center',
              }}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {shortCode}
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

        {/* Playlist info + round count */}
        {firstPlaylist ? (
          <>
          <View
            style={{
              padding: 12,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radii.md,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              {gamePlaylists.length === 1 ? 'PLAYLIST' : 'PLAYLISTS'}
            </Text>
            <Text
              style={{
                color: colors.textPrimary,
                fontSize: 16,
                fontWeight: '600',
                marginTop: 2,
              }}
            >
              {gamePlaylists.map((p) => p.name).join(' · ')}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                marginTop: 2,
              }}
            >
              {totalTracks} tracks
              {gamePlaylists.length > 1
                ? ' · each round drawn from a random pack'
                : ''}
            </Text>
          </View>

          {/* Round count */}
          <View style={{ marginBottom: 12 }}>
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 11,
                marginBottom: 6,
              }}
            >
              ROUNDS
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ROUND_OPTIONS.map((n) => {
                const active = totalRounds === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setTotalRounds(n)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: radii.md,
                      alignItems: 'center',
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? '#fff' : colors.textMuted,
                        fontWeight: '700',
                        fontSize: 16,
                      }}
                    >
                      {n}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          </>
        ) : (
          <View
            style={{
              padding: 12,
              backgroundColor: colors.danger,
              borderRadius: radii.md,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13 }}>
              No playlists selected — go back and pick at least one.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => {
            if (gamePlaylists.length === 0) return;
            void hostStartGame(
              totalRounds,
              gamePlaylists.map((p) => p.id),
              gamePlaylists.length === 1
                ? gamePlaylists[0].name
                : `${gamePlaylists.length} packs`,
              totalTracks
            ).then(() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
              router.replace('/buzz/host-game' as any);
            });
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
