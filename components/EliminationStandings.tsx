/**
 * EliminationStandings — per-team progress grid for Elimination mode.
 *
 * Rendered above the picker on the in-game setup screen between rounds.
 * Shows each team's cleared (✓) vs remaining (●) playlists so players
 * can see at a glance:
 *  - How close each team is to winning
 *  - Which playlists are most contested (multiple teams haven't cleared)
 *  - Who's eligible to steal which playlist (anyone with ● on that column)
 *
 * Visual approach: one row per team, playlists as chips within the row.
 * Active team's row is highlighted. Compact enough for mobile, scrolls
 * horizontally if you have many playlists.
 *
 * Why this exists: without it, players have to mentally track who's
 * cleared what. With it, the strategic state of the game is always
 * visible — which is half of what makes Elimination interesting.
 */

import { ScrollView, Text, View } from 'react-native';

import type { Playlist, Team } from '@/lib/types';

interface EliminationStandingsProps {
  teams: Team[];
  /** All playlists in this game's selected set (id-ordered). */
  playlists: Playlist[];
  /** Highlight this team's row as the current picker. */
  activeTeamIndex: number;
}

export function EliminationStandings({
  teams,
  playlists,
  activeTeamIndex,
}: EliminationStandingsProps) {
  if (teams.length === 0 || playlists.length === 0) return null;

  return (
    <View className="bg-surface rounded-lg p-3 gap-2 border border-border">
      <Text className="text-textMuted text-xs uppercase tracking-wider">
        Standings
      </Text>
      {teams.map((team) => {
        const isActive = team.index === activeTeamIndex;
        const cleared = team.completedPlaylists.length;
        const total = playlists.length;
        const remaining = total - cleared;

        return (
          <View
            key={team.id}
            className={`rounded-md p-2 gap-2 ${
              isActive ? 'bg-primary/15 border border-primary' : 'bg-bg'
            }`}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Text
                  className={`font-semibold ${isActive ? 'text-primary' : 'text-textPrimary'}`}
                  numberOfLines={1}
                >
                  {team.name}
                </Text>
                {isActive ? (
                  <View className="bg-primary rounded-full px-2 py-0.5">
                    <Text className="text-textPrimary text-xs font-semibold">
                      Your turn
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-textMuted text-xs">
                {cleared}/{total} cleared · {remaining} to go
              </Text>
            </View>

            {/* Per-playlist chips — horizontally scrollable when many */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {playlists.map((p) => {
                const isCleared = team.completedPlaylists.includes(p.id);
                return (
                  <View
                    key={p.id}
                    className={`rounded-full px-3 py-1 flex-row items-center gap-1 ${
                      isCleared
                        ? 'bg-success/20 border border-success'
                        : 'bg-surfaceAlt border border-border'
                    }`}
                  >
                    <Text
                      className={`text-xs ${
                        isCleared ? 'text-success' : 'text-textMuted'
                      }`}
                    >
                      {isCleared ? '✓' : '●'}
                    </Text>
                    <Text
                      className={`text-xs ${
                        isCleared ? 'text-textPrimary' : 'text-textMuted'
                      }`}
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}
