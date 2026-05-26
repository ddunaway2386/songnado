import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { GameMode, Team } from '@/lib/types';
import { useGameStore } from '@/stores/gameStore';

export default function GameOverScreen() {
  const teams = useGameStore((s) => s.teams);
  const winnerTeamIndex = useGameStore((s) => s.winnerTeamIndex);
  const selectedPlaylistIds = useGameStore((s) => s.selectedPlaylistIds);
  const gameMode = useGameStore((s) => s.gameMode);
  const targetScore = useGameStore((s) => s.targetScore);
  const startGame = useGameStore((s) => s.startGame);
  const endGame = useGameStore((s) => s.endGame);

  useEffect(() => {
    if (winnerTeamIndex == null) router.replace('/');
  }, [winnerTeamIndex]);

  if (winnerTeamIndex == null) return null;
  const winner = teams[winnerTeamIndex];

  const ranked =
    gameMode === 'elimination'
      ? [...teams].sort((a, b) => b.completedPlaylists.length - a.completedPlaylists.length)
      : [...teams].sort((a, b) => b.score - a.score);

  function rematch() {
    startGame({
      teamNames: teams.map((t) => t.name),
      selectedPlaylistIds,
      gameMode,
      targetScore,
    });
    router.replace('/game');
  }

  function backToSetup() {
    endGame();
    router.replace('/');
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="p-6 gap-6">
        <View className="items-center gap-1">
          <Text className="text-textMuted text-xs uppercase tracking-wider">Winner</Text>
          <Text className="text-primary text-4xl font-bold text-center">
            {winner?.name ?? '—'}
          </Text>
          <Text className="text-textPrimary text-lg">
            {gameMode === 'elimination'
              ? `Cleared all ${selectedPlaylistIds.length} playlists`
              : `${winner?.score} pts`}
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-textMuted text-xs uppercase">Final standings</Text>
          {ranked.map((t, i) => (
            <StandingRow
              key={t.id}
              rank={i + 1}
              team={t}
              isWinner={t.index === winnerTeamIndex}
              gameMode={gameMode}
              totalPlaylists={selectedPlaylistIds.length}
            />
          ))}
        </View>

        <View className="gap-2">
          <Pressable
            onPress={rematch}
            className="bg-primary active:bg-primaryHover rounded-lg px-4 py-4 items-center"
          >
            <Text className="text-textPrimary text-lg font-bold">
              Rematch (same teams &amp; playlists)
            </Text>
          </Pressable>
          <Pressable
            onPress={backToSetup}
            className="bg-surface active:bg-surfaceAlt rounded-lg px-4 py-4 items-center border border-border"
          >
            <Text className="text-textPrimary font-semibold">Back to setup</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StandingRow({
  rank,
  team,
  isWinner,
  gameMode,
  totalPlaylists,
}: {
  rank: number;
  team: Team;
  isWinner: boolean;
  gameMode: GameMode;
  totalPlaylists: number;
}) {
  return (
    <View
      className={`flex-row items-center justify-between rounded-md px-3 py-3 border ${
        isWinner ? 'bg-primary/20 border-primary' : 'bg-surface border-border'
      }`}
    >
      <View className="flex-row items-center gap-3">
        <Text className="text-textMuted w-6">#{rank}</Text>
        <Text className="text-textPrimary font-semibold">{team.name}</Text>
      </View>
      <Text className="text-textPrimary font-bold">
        {gameMode === 'elimination'
          ? `${team.completedPlaylists.length} / ${totalPlaylists}`
          : team.score}
      </Text>
    </View>
  );
}
