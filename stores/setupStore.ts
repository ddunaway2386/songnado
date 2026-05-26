import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { targetScoreBounds } from '@/lib/scoring';
import type { GameMode } from '@/lib/types';

export const MIN_TEAMS = 1;
export const MAX_TEAMS = 6;

const VALID_GAME_MODES: GameMode[] = ['classic', 'blitz', 'elimination'];

interface SetupStoreState {
  teamCount: number;
  teamNames: string[];
  targetScore: number;
  gameMode: GameMode;
  selectedPlaylistIds: string[];
  hasHydrated: boolean;

  setTeamCount: (n: number) => void;
  setTeamName: (index: number, name: string) => void;
  setTargetScore: (score: number) => void;
  setGameMode: (mode: GameMode) => void;
  togglePlaylist: (id: string) => void;
  setSelectedPlaylists: (ids: string[]) => void;
}

function defaultTeamNames(count: number, existing: string[] = []): string[] {
  return Array.from({ length: count }, (_, i) => existing[i] ?? `Team ${i + 1}`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampTarget(score: number, mode: GameMode): number {
  const { min, max, step } = targetScoreBounds(mode);
  const clamped = clamp(score, min, max);
  // Snap to nearest valid step
  return min + Math.round((clamped - min) / step) * step;
}

export const useSetupStore = create<SetupStoreState>()(
  persist(
    (set) => ({
      teamCount: 2,
      teamNames: defaultTeamNames(2),
      targetScore: targetScoreBounds('classic').default,
      gameMode: 'classic',
      selectedPlaylistIds: [],
      hasHydrated: false,

      setTeamCount: (n) => {
        const clamped = clamp(n, MIN_TEAMS, MAX_TEAMS);
        set((state) => ({
          teamCount: clamped,
          teamNames: defaultTeamNames(clamped, state.teamNames),
        }));
      },
      setTeamName: (index, name) => {
        set((state) => ({
          teamNames: state.teamNames.map((t, i) => (i === index ? name : t)),
        }));
      },
      setTargetScore: (score) => {
        set((state) => ({ targetScore: clampTarget(score, state.gameMode) }));
      },
      setGameMode: (gameMode) => {
        set({ gameMode, targetScore: targetScoreBounds(gameMode).default });
      },
      togglePlaylist: (id) => {
        set((state) => ({
          selectedPlaylistIds: state.selectedPlaylistIds.includes(id)
            ? state.selectedPlaylistIds.filter((x) => x !== id)
            : [...state.selectedPlaylistIds, id],
        }));
      },
      setSelectedPlaylists: (ids) => set({ selectedPlaylistIds: ids }),
    }),
    {
      name: 'songster-setup',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ gameMode: state.gameMode }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate old 'classic-timed' → 'blitz'; sanitize anything else.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const persistedMode = state.gameMode as any;
          if (persistedMode === 'classic-timed') {
            state.gameMode = 'blitz';
          } else if (!VALID_GAME_MODES.includes(persistedMode)) {
            state.gameMode = 'classic';
          }
          state.targetScore = targetScoreBounds(state.gameMode).default;
          state.hasHydrated = true;
        }
      },
    }
  )
);
