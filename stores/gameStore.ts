import { create } from 'zustand';

import {
  calculateRoundPoints,
  findEliminationWinner,
  findWinnerIndex,
  noAnswerPenalty,
  PREVIEW_DURATION_S,
} from '@/lib/scoring';
import type { GameMode, Song, Team } from '@/lib/types';
import { usePlaylistStore } from './playlistStore';

export type RoundStatus = 'picking' | 'loading' | 'in-round' | 'revealed';

export interface RoundSummary {
  teamIndex: number;
  teamName: string;
  points: number;
  noAnswer: boolean;
  song: Song | null;
  // Elimination-only:
  eliminationCleared?: boolean;
  playlistName?: string;
}

export interface StartGameConfig {
  teamNames: string[];
  selectedPlaylistIds: string[];
  gameMode: GameMode;
  targetScore: number;
}

interface GameStoreState {
  isActive: boolean;
  teams: Team[];
  selectedPlaylistIds: string[];
  gameMode: GameMode;
  targetScore: number;

  currentTeamIndex: number;
  currentPlaylistId: string | null;
  currentSong: Song | null;
  currentAttempts: number;
  lastPlayedSeconds: number;
  songCorrect: boolean;
  artistCorrect: boolean;
  roundStatus: RoundStatus;
  roundCount: number;
  loadError: string | null;

  lastSummary: RoundSummary | null;
  winnerTeamIndex: number | null;

  startGame: (cfg: StartGameConfig) => void;
  endGame: () => void;

  pickPlaylistForRound: (playlistId: string) => Promise<void>;
  setSongCorrect: (v: boolean) => void;
  setArtistCorrect: (v: boolean) => void;
  setLastPlayedSeconds: (s: number) => void;

  awardToTeam: (teamIndex: number) => void;
  noAnswerPenalty: () => void;
  nextRound: () => void;
}

const INITIAL: Pick<
  GameStoreState,
  | 'isActive'
  | 'teams'
  | 'selectedPlaylistIds'
  | 'gameMode'
  | 'targetScore'
  | 'currentTeamIndex'
  | 'currentPlaylistId'
  | 'currentSong'
  | 'currentAttempts'
  | 'lastPlayedSeconds'
  | 'songCorrect'
  | 'artistCorrect'
  | 'roundStatus'
  | 'roundCount'
  | 'loadError'
  | 'lastSummary'
  | 'winnerTeamIndex'
> = {
  isActive: false,
  teams: [],
  selectedPlaylistIds: [],
  gameMode: 'classic',
  targetScore: 15,
  currentTeamIndex: 0,
  currentPlaylistId: null,
  currentSong: null,
  currentAttempts: 0,
  lastPlayedSeconds: 0,
  songCorrect: false,
  artistCorrect: false,
  roundStatus: 'picking',
  roundCount: 1,
  loadError: null,
  lastSummary: null,
  winnerTeamIndex: null,
};

function resetRoundFields() {
  return {
    currentPlaylistId: null,
    currentSong: null,
    currentAttempts: 0,
    lastPlayedSeconds: 0,
    songCorrect: false,
    artistCorrect: false,
    loadError: null,
    lastSummary: null,
  };
}

export const useGameStore = create<GameStoreState>()((set, get) => ({
  ...INITIAL,

  startGame: (cfg) => {
    const teams: Team[] = cfg.teamNames.map((raw, i) => {
      const trimmed = raw.trim();
      return {
        id: `team-${i}`,
        index: i,
        name: trimmed.length > 0 ? trimmed : `Team ${i + 1}`,
        score: 0,
        completedPlaylists: [],
      };
    });
    set({
      ...INITIAL,
      isActive: true,
      teams,
      selectedPlaylistIds: cfg.selectedPlaylistIds,
      gameMode: cfg.gameMode,
      targetScore: cfg.targetScore,
      roundStatus: 'picking',
    });
  },

  endGame: () => set({ ...INITIAL }),

  pickPlaylistForRound: async (playlistId) => {
    set({ roundStatus: 'loading', loadError: null, currentPlaylistId: playlistId });
    try {
      const result = await usePlaylistStore.getState().fetchNextPlayableTrack(playlistId);
      if (!result) {
        set({
          roundStatus: 'picking',
          currentPlaylistId: null,
          loadError: 'No playable track found after 10 tries. Pick another playlist.',
        });
        return;
      }
      set({
        ...resetRoundFields(),
        currentPlaylistId: playlistId,
        currentSong: result.song,
        currentAttempts: result.attempts,
        roundStatus: 'in-round',
      });
    } catch (e) {
      set({
        roundStatus: 'picking',
        currentPlaylistId: null,
        loadError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setSongCorrect: (v) => set({ songCorrect: v }),
  setArtistCorrect: (v) => set({ artistCorrect: v }),
  setLastPlayedSeconds: (s) =>
    set({ lastPlayedSeconds: Math.max(0, Math.min(PREVIEW_DURATION_S, s)) }),

  awardToTeam: (teamIndex) => {
    const state = get();
    const {
      teams,
      gameMode,
      songCorrect,
      artistCorrect,
      lastPlayedSeconds,
      currentSong,
      currentPlaylistId,
      targetScore,
      selectedPlaylistIds,
    } = state;
    const team = teams.find((t) => t.index === teamIndex);
    if (!team) return;

    if (gameMode === 'elimination') {
      const cleared = songCorrect || artistCorrect;
      const playlistName =
        usePlaylistStore.getState().playlists.find((p) => p.id === currentPlaylistId)?.name;

      // Tapped a team but neither toggle is on → not a clear; just reveal nothing happened.
      if (!cleared || !currentPlaylistId) {
        set({
          lastSummary: {
            teamIndex,
            teamName: team.name,
            points: 0,
            noAnswer: false,
            song: currentSong,
            eliminationCleared: false,
            playlistName,
          },
          roundStatus: 'revealed',
        });
        return;
      }

      const newTeams = teams.map((t) =>
        t.index === teamIndex && !t.completedPlaylists.includes(currentPlaylistId)
          ? { ...t, completedPlaylists: [...t.completedPlaylists, currentPlaylistId] }
          : t
      );
      const winner = findEliminationWinner(newTeams, selectedPlaylistIds);
      set({
        teams: newTeams,
        lastSummary: {
          teamIndex,
          teamName: team.name,
          points: 0,
          noAnswer: false,
          song: currentSong,
          eliminationCleared: true,
          playlistName,
        },
        roundStatus: 'revealed',
        winnerTeamIndex: winner,
      });
      return;
    }

    // Classic / Blitz
    const points = calculateRoundPoints(songCorrect, artistCorrect, lastPlayedSeconds, gameMode);
    const newTeams = teams.map((t) =>
      t.index === teamIndex ? { ...t, score: t.score + points } : t
    );
    const winner = findWinnerIndex(newTeams, targetScore);
    set({
      teams: newTeams,
      lastSummary: {
        teamIndex,
        teamName: team.name,
        points,
        noAnswer: false,
        song: currentSong,
      },
      roundStatus: 'revealed',
      winnerTeamIndex: winner,
    });
  },

  noAnswerPenalty: () => {
    const state = get();
    const {
      teams,
      currentTeamIndex,
      currentSong,
      gameMode,
      targetScore,
      currentPlaylistId,
    } = state;
    const team = teams.find((t) => t.index === currentTeamIndex);
    if (!team) return;

    if (gameMode === 'elimination') {
      const playlistName =
        usePlaylistStore.getState().playlists.find((p) => p.id === currentPlaylistId)?.name;
      // Nothing happens — round just ends.
      set({
        lastSummary: {
          teamIndex: currentTeamIndex,
          teamName: team.name,
          points: 0,
          noAnswer: true,
          song: currentSong,
          eliminationCleared: false,
          playlistName,
        },
        roundStatus: 'revealed',
      });
      return;
    }

    const penalty = noAnswerPenalty(gameMode);
    const newTeams = teams.map((t) =>
      t.index === currentTeamIndex ? { ...t, score: t.score + penalty } : t
    );
    const winner = findWinnerIndex(newTeams, targetScore);
    set({
      teams: newTeams,
      lastSummary: {
        teamIndex: currentTeamIndex,
        teamName: team.name,
        points: penalty,
        noAnswer: true,
        song: currentSong,
      },
      roundStatus: 'revealed',
      winnerTeamIndex: winner,
    });
  },

  nextRound: () => {
    set((state) => ({
      ...resetRoundFields(),
      currentTeamIndex: (state.currentTeamIndex + 1) % Math.max(1, state.teams.length),
      roundStatus: 'picking',
      roundCount: state.roundCount + 1,
    }));
  },
}));
