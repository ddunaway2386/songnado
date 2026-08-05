/**
 * Client-side buzz join screen.
 *
 * The user lands here after tapping "Join a buzz game" on the home
 * screen. They type the short code (ip:port:sessionId) the host read
 * to them, pick a team name + color, and tap Connect. On JOIN_ACK we
 * router.replace() into the client lobby.
 *
 * Phase 2.5 will add camera-based QR scanning to avoid manual typing.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as Network from 'expo-network';

import {
  TEAM_COLORS,
  decodeConnectionString,
  decodeShortCode,
  encodeConnectionString,
} from '@/lib/buzz/protocol';
import type { TeamColor } from '@/lib/buzz/protocol';
import { useBuzzGameStore } from '@/stores/buzzGameStore';
import { colors, radii } from '../../theme';

export default function BuzzJoinScreen() {
  const joinAsClient = useBuzzGameStore((s) => s.joinAsClient);

  const [shortCode, setShortCode] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<TeamColor>(TEAM_COLORS[0]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Accepts three forms, most-convenient first:
   *   1. Room code — 1-3 digits, e.g. "42". Combined with this phone's own
   *      IP (same Wi-Fi ⇒ same /24) to rebuild the host address.
   *   2. ip:port:sessionId
   *   3. Full songnado-buzz: URI
   */
  async function parseAnyCode(code: string) {
    const trimmed = code.trim();

    if (/^\d{1,3}$/.test(trimmed)) {
      const myIp = await Network.getIpAddressAsync();
      if (!myIp || myIp === '0.0.0.0') return null;
      return decodeShortCode(trimmed, myIp);
    }

    if (trimmed.startsWith('songnado-buzz:')) {
      return decodeConnectionString(trimmed);
    }

    const m = trimmed.match(/^(\d+\.\d+\.\d+\.\d+):(\d+):([a-f0-9]+)$/i);
    if (!m) return null;
    // Re-encode to canonical form and parse to validate
    return decodeConnectionString(
      encodeConnectionString({
        host: m[1],
        port: parseInt(m[2], 10),
        sessionId: m[3].toLowerCase(),
      })
    );
  }

  async function handleConnect() {
    setError(null);
    const parsed = await parseAnyCode(shortCode);
    if (!parsed) {
      setError(
        `That doesn't look like a valid join code. Enter the room code shown on the host's phone (e.g. 42), or the full 192.168.1.42:52341:abc123 form.`
      );
      return;
    }
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > 24) {
      setError('Team name must be 1–24 characters.');
      return;
    }
    setConnecting(true);
    try {
      await joinAsClient(parsed, displayName, color);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router types regenerate on next dev server start
      router.replace('/buzz/client-lobby' as any);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConnecting(false);
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 24,
            fontWeight: '700',
            marginBottom: 4,
          }}
        >
          Join a Buzz Game
        </Text>
        <Text style={{ color: colors.textMuted, marginBottom: 20 }}>
          Make sure you&apos;re on the same Wi-Fi as the host phone.
        </Text>

        {/* Room code. Big and numeric — this is usually 2 digits shouted
            across a room, so it gets the number pad and matching type. */}
        <Text style={labelStyle}>Room code</Text>
        <TextInput
          value={shortCode}
          onChangeText={setShortCode}
          placeholder="42"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="numbers-and-punctuation"
          editable={!connecting}
          style={{
            ...inputStyle,
            fontSize: 32,
            fontWeight: '700',
            textAlign: 'center',
            letterSpacing: 2,
          }}
        />
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 11,
            marginTop: -12,
            marginBottom: 20,
          }}
        >
          The number shown on the host&apos;s phone. If that doesn&apos;t
          connect, paste the long code instead.
        </Text>

        {/* Team name */}
        <Text style={labelStyle}>Team name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. The Brothers"
          placeholderTextColor={colors.textMuted}
          maxLength={24}
          editable={!connecting}
          style={inputStyle}
        />

        {/* Color picker */}
        <Text style={labelStyle}>Team color</Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 20,
          }}
        >
          {TEAM_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              disabled={connecting}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: c,
                borderWidth: color === c ? 3 : 0,
                borderColor: colors.textPrimary,
              }}
            />
          ))}
        </View>

        {error ? (
          <View
            style={{
              backgroundColor: colors.danger,
              padding: 12,
              borderRadius: radii.md,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: '#fff' }}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={handleConnect}
          disabled={connecting || !shortCode || !name}
          style={{
            backgroundColor:
              !connecting && shortCode && name
                ? colors.primary
                : colors.surfaceAlt,
            padding: 16,
            borderRadius: radii.md,
            alignItems: 'center',
            marginBottom: 12,
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {connecting ? <ActivityIndicator color="#fff" /> : null}
          <Text
            style={{
              color:
                !connecting && shortCode && name
                  ? '#fff'
                  : colors.textMuted,
              fontWeight: '700',
              fontSize: 16,
            }}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          disabled={connecting}
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
            Cancel
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const labelStyle = {
  color: colors.textMuted,
  fontSize: 12,
  letterSpacing: 1,
  textTransform: 'uppercase' as const,
  marginBottom: 6,
};

const inputStyle = {
  backgroundColor: colors.surface,
  color: colors.textPrimary,
  padding: 12,
  borderRadius: radii.md,
  borderWidth: 1,
  borderColor: colors.border,
  fontSize: 16,
  marginBottom: 20,
};
