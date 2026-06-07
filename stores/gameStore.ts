import { create } from 'zustand';

import {
  calculateRoundPoints,
  findEliminationWinner,
  findWinnerIndex,
  noAnswerPenalty,
  PREVIEW_DURATION_S,
} from '@/lib/scoring';
import type { GameMode, ProviderId, Song, Team } from '@/lib/types';
import type { TurnStyle } from './setupStore';
import { usePlaylistStore } from './playlistStore';
import { useRemoteConfigStore } from './remoteConfigStore';

// ensureSpotifyAwake / SPOTIFY_BACKED_PROVIDERS were removed June 4 2026.
// The eager device-active pre-check was bailing to the wake-up banner on
// every round transition (our own team-award pause briefly puts iOS
// Spotify into a dormant state where is_active=false, even though it's
// still reachable via transferPlayback). withDeviceRecovery in
// lib/spotify/playback.ts handles dormancy recovery automatically;
// gating ahead of it was skipping that work and surfacing the banner
// unnecessarily. signalWakeNeeded() still flips the banner if recovery
// genuinely fails — that's the proper trigger point.

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
  turnStyle: TurnStyle;
}

interface GameStoreState {
  isActive: boolean;
  teams: Team[];
  selectedPlaylistIds: string[];
  gameMode: GameMode;
  targetScore: number;
  turnStyle: TurnStyle;

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

  /**
   * Fetch a different track from the same playlist and replace the round's
   * current song. Used by the "Skip song" button — "we don't like this one,
   * give us another." Timer resets to full on the new song.
   */
  skipCurrentSong: () => Promise<void>;
  /**
   * Abandon the current round and go back to the playlist picker without
   * awarding points or advancing teams. Used by the "End round" button.
   */
  endRoundEarly: () => void;

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
  | 'turnStyle'
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
  turnStyle: 'alternating',
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
    // For alternating turns, randomly pick the first team. nextRound's
    // `(idx + 1) % length` rotation then carries the order forward
    // naturally — e.g. start at team 2 → 3 → 4 → 1 → 2 → ... For
    // free-for-all, the starting team doesn't materially matter but
    // we still seed it at 0 for picker-screen consistency.
    const startingTeamIndex =
      cfg.turnStyle === 'alternating' && teams.length > 0
        ? Math.floor(Math.random() * teams.length)
        : 0;
    set({
      ...INITIAL,
      isActive: true,
      teams,
      selectedPlaylistIds: cfg.selectedPlaylistIds,
      gameMode: cfg.gameMode,
      targetScore: cfg.targetScore,
      turnStyle: cfg.turnStyle,
      currentTeamIndex: startingTeamIndex,
      roundStatus: 'picking',
    });
  },

  endGame: () => set({ ...INITIAL }),

  pickPlaylistForRound: async (playlistId) => {
    set({ roundStatus: 'loading', loadError: null, currentPlaylistId: playlistId });
    // Kill-switch safety net: even though index.tsx filters Deezer
    // playlists out of the picker when the remote config has disabled
    // Deezer, a race between fetch completion and a user tap could in
    // theory let one through. Refuse here so we don't burn an API call
    // on a disabled service.
    const playlist = usePlaylistStore
      .getState()
      .playlists.find((p) => p.id === playlistId);
    if (playlist?.provider === 'deezer') {
      const cfg = useRemoteConfigStore.getState().config;
      if (!cfg.deezerEnabled) {
        set({
          roundStatus: 'picking',
          currentPlaylistId: null,
          loadError:
            cfg.killSwitchReason.trim().length > 0
              ? cfg.killSwitchReason
              : 'This playlist is temporarily unavailable.',
        });
        return;
      }
    }
    // No pre-check: withDeviceRecovery in the playback layer attempts
    // a programmatic transferPlayback wake before surfacing the banner.
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

  skipCurrentSong: async () => {
    const playlistId = get().currentPlaylistId;
    if (!playlistId) return;
    set({ roundStatus: 'loading', loadError: null });
    // No pre-check (see pickPlaylistForRound).
    try {
      const result = await usePlaylistStore.getState().fetchNextPlayableTrack(playlistId);
      if (!result) {
        set({
          roundStatus: 'in-round',
          loadError: 'Could not find another track in this playlist. Try ending the round.',
        });
        return;
      }
      // Reset round-level fields but KEEP currentPlaylistId so we stay on
      // the same playlist for the next song.
      set({
        ...resetRoundFields(),
        currentPlaylistId: playlistId,
        currentSong: result.song,
        currentAttempts: result.attempts,
        roundStatus: 'in-round',
      });
    } catch (e) {
      set({
        roundStatus: 'in-round',
        loadError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  endRoundEarly: () => {
    // Abandon round without advancing teams or awarding points — straight
    // back to the picker. Does not pause Spotify (audio keeps playing as
    // we can't reliably stop it on iOS); does pause Deezer via the
    // useEffect in game.tsx that watches roundStatus.
    set({ ...resetRoundFields(), roundStatus: 'picking' });
  },

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
