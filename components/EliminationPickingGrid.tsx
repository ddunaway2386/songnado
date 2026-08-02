/**
 * EliminationPickingGrid — big tile grid for the active team's turn in
 * Elimination mode. Replaces the vertical PickingView list.
 *
 * Design brief from Daniel: "The actual play screen should appear more
 * like all of the playlists in a grid type structure with the ones that
 * have been selected grayed out basically covering the majority of the
 * screen with the user selecting a playlist it hasn't been grayed out
 * as the next playlist they want to try to eliminate."
 *
 * Per-team grid: each team clears their own tiles. Displayed here is the
 * ACTIVE team's grid — cleared tiles are grayed out (non-tappable),
 * untouched tiles are the tappable choices. First team to fully clear
 * their grid wins (findEliminationWinner in lib/scoring.ts).
 */

import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import type { Playlist, Team } from '@/lib/types';

interface EliminationPickingGridProps {
  activeTeam: Team | undefined;
  /** All playlists in this game's selected set. Grayed if in activeTeam.completedPlaylists. */
  playlists: Playlist[];
  onPick: (playlistId: string) => void;
  /** Current hot-streak count; 0 = no streak. Shows a banner when > 0. */
  streakCount: number;
  loadError: string | null;
}

export function EliminationPickingGrid({
  activeTeam,
  playlists,
  onPick,
  streakCount,
  loadError,
}: EliminationPickingGridProps) {
  const clearedSet = new Set(activeTeam?.completedPlaylists ?? []);
  const remaining = playlists.filter((p) => !clearedSet.has(p.id));

  return (
    <View className="gap-3">
      <Text className="text-textPrimary text-lg">
        <Text className="text-primary font-bold">{activeTeam?.name ?? '…'}</Text>
        <Text className="text-textPrimary">, pick a playlist</Text>
      </Text>

      {streakCount > 0 ? (
        <View className="bg-primary/15 border border-primary rounded-md px-3 py-2">
          <Text className="text-primary font-semibold text-sm">
            🔥 Hot streak ×{streakCount}! Pick again — keep it going.
          </Text>
        </View>
      ) : null}

      {loadError ? (
        <View className="bg-surface border border-danger rounded-lg p-3">
          <Text className="text-danger text-sm">{loadError}</Text>
        </View>
      ) : null}

      {remaining.length === 0 ? (
        <View className="bg-surface rounded-lg p-4">
          <Text className="text-textMuted">
            Your grid is clear — nothing left to play! Waiting for the game to end.
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {playlists.map((p) => {
            const isCleared = clearedSet.has(p.id);
            return (
              <Pressable
                key={p.id}
                onPress={() => (isCleared ? undefined : onPick(p.id))}
                disabled={isCleared}
                style={{
                  // 3 across, squat tiles — the whole grid should be visible
                  // without scrolling even with 8-10 packs in play.
                  width: '31.5%',
                  aspectRatio: 1.15,
                  borderRadius: 10,
                  overflow: 'hidden',
                  borderWidth: 2,
                  borderColor: isCleared ? '#3F3F46' : '#7C3AED',
                  backgroundColor: isCleared ? '#1F1F23' : '#141419',
                  opacity: isCleared ? 0.35 : 1,
                }}
              >
                {p.imageUrl ? (
                  <Image
                    source={{ uri: p.imageUrl }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: isCleared ? 0.15 : 0.35,
                    }}
                    contentFit="cover"
                  />
                ) : null}
                <View
                  style={{
                    flex: 1,
                    padding: 7,
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontWeight: '700',
                      fontSize: 12,
                      lineHeight: 14,
                    }}
                    numberOfLines={3}
                  >
                    {p.name}
                  </Text>
                  {isCleared ? (
                    <Text
                      style={{
                        color: '#22C55E',
                        fontSize: 11,
                        fontWeight: '800',
                      }}
                    >
                      ✓ CLEARED
                    </Text>
                  ) : (
                    <Text style={{ color: '#A1A1AA', fontSize: 10 }}>
                      {p.totalTracks} tracks
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
