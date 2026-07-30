/**
 * Game mode selection — first page of the setup wizard.
 *
 * Big, obvious cards. Each mode gets a big emoji, bold title, one-liner
 * description, and a distinctive selected state. Buzz mode shows a
 * "NEW" pill since it's the marquee v1.0 feature and users won't
 * recognize it from the previous single-page setup.
 *
 * Subsequent wizard pages (setup/playlist, setup/teams, etc.) will
 * be added as we build the flow. For now, "Continue" routes to the
 * old home-screen setup so existing configuration (playlist, teams,
 * target score) can still be completed — until the wizard is fully
 * built. Buzz routes to the existing buzz lobby flow.
 */

import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { GameMode } from '@/lib/types';
import { useSetupStore } from '@/stores/setupStore';
import { colors, radii } from '../../theme';

interface ModeCard {
  mode: GameMode;
  emoji: string;
  title: string;
  tagline: string;
  isNew?: boolean;
}

const MODES: ModeCard[] = [
  {
    mode: 'classic',
    emoji: '🎵',
    title: 'Classic',
    tagline: 'Take turns. First team to the target score wins.',
  },
  {
    mode: 'blitz',
    emoji: '⚡',
    title: 'Blitz',
    tagline: 'Fastest guess wins. Points × seconds left on the clock.',
  },
  {
    mode: 'elimination',
    emoji: '🏆',
    title: 'Elimination',
    tagline: 'Clear the grid. Draft strong packs, eliminate weak ones — first team to solve every remaining pack wins.',
  },
  {
    mode: 'buzz',
    emoji: '📱',
    title: 'Buzz',
    tagline: 'Each team on their own phone. First to buzz gets the answer.',
    isNew: true,
  },
];

export default function GameModeScreen() {
  const gameMode = useSetupStore((s) => s.gameMode);
  const setGameMode = useSetupStore((s) => s.setGameMode);

  function handleContinue() {
    if (gameMode === 'buzz') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router typed routes
      router.push('/buzz/host-lobby' as any);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- expo-router regenerates types on start
      router.push('/setup/details' as any);
    }
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.bg }}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Header */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              color: colors.textMuted,
              fontSize: 12,
              letterSpacing: 2,
              textTransform: 'uppercase',
              fontWeight: '600',
            }}
          >
            Step 1 of 3
          </Text>
          <Text
            style={{
              color: colors.textPrimary,
              fontSize: 32,
              fontWeight: '800',
              marginTop: 8,
              lineHeight: 38,
            }}
          >
            How do you want{'\n'}to play?
          </Text>
        </View>

        {/* Mode cards */}
        {MODES.map((m) => {
          const selected = gameMode === m.mode;
          return (
            <Pressable
              key={m.mode}
              onPress={() => setGameMode(m.mode)}
              style={{
                backgroundColor: selected ? colors.primary : colors.surface,
                borderRadius: radii.lg,
                borderWidth: 2,
                borderColor: selected ? colors.textPrimary : colors.border,
                padding: 20,
                marginBottom: 12,
                minHeight: 120,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 44, marginRight: 18 }}>{m.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <Text
                    style={{
                      color: selected ? '#fff' : colors.textPrimary,
                      fontSize: 22,
                      fontWeight: '700',
                    }}
                  >
                    {m.title}
                  </Text>
                  {m.isNew ? (
                    <View
                      style={{
                        backgroundColor: colors.accent,
                        borderRadius: radii.full,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        marginLeft: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: '#000',
                          fontSize: 10,
                          fontWeight: '800',
                          letterSpacing: 1,
                        }}
                      >
                        NEW
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={{
                    color: selected
                      ? 'rgba(255,255,255,0.85)'
                      : colors.textMuted,
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {m.tagline}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Sticky continue button */}
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
          disabled={!gameMode}
          style={{
            backgroundColor: gameMode ? colors.primary : colors.surfaceAlt,
            padding: 18,
            borderRadius: radii.md,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              color: gameMode ? '#fff' : colors.textMuted,
              fontSize: 18,
              fontWeight: '700',
            }}
          >
            {gameMode === 'buzz' ? 'Set up buzz lobby' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
