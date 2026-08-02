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
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import type { Playlist, Team } from '@/lib/types';

/**
 * Column count scales with pack count, capped at 3.
 *
 * 4+ columns did fit more packs above the fold, but at ~83px wide with
 * 9px labels. This is a party game read from across a room by whoever is
 * guessing — legibility beats eliminating a short scroll. Three columns
 * holds a comfortable 114px tile, and 12 packs (the expected practical
 * ceiling: draft from ~14, two get eliminated) lands in 4 rows.
 */
export function gridColumnsFor(count: number): number {
  if (count <= 4) return 2;
  return 3;
}

/** Tile label sizing has to shrink alongside the tiles. */
function tileTypeScale(columns: number): { title: number; meta: number; pad: number } {
  if (columns <= 2) return { title: 15, meta: 11, pad: 10 };
  return { title: 12, meta: 10, pad: 7 };
}

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

  // Exact pixel widths, not percentages: percentage widths ignore the gaps,
  // so three 31.5% tiles plus two 10px gaps overflowed the row and wrapped
  // back to two columns. Parent ScrollView uses p-4 (16px each side).
  const { width: windowWidth } = useWindowDimensions();
  const GAP = 8;
  const CONTAINER_PADDING = 16;
  const columns = gridColumnsFor(playlists.length);
  const available = windowWidth - CONTAINER_PADDING * 2;
  const tileWidth = Math.floor((available - GAP * (columns - 1)) / columns);
  const type = tileTypeScale(columns);

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
            gap: GAP,
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
                  width: tileWidth,
                  // Slightly wide tiles keep 4 rows of 12 packs compact
                  // while leaving room for 3 lines of pack name.
                  aspectRatio: 1.3,
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
                    padding: type.pad,
                    justifyContent: 'space-between',
                  }}
                >
                  <Text
                    style={{
                      color: '#FFFFFF',
                      fontWeight: '700',
                      fontSize: type.title,
                      lineHeight: type.title + 2,
                    }}
                    numberOfLines={3}
                  >
                    {p.name}
                  </Text>
                  {isCleared ? (
                    <Text
                      style={{
                        color: '#22C55E',
                        fontSize: type.meta,
                        fontWeight: '800',
                      }}
                    >
                      ✓ CLEARED
                    </Text>
                  ) : (
                    <Text style={{ color: '#A1A1AA', fontSize: type.meta }}>
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
