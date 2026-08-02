import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { diag } from '@/lib/diagLog';
import { targetScoreBounds } from '@/lib/scoring';
import type { GameMode } from '@/lib/types';

export const MIN_TEAMS = 1;
export const MAX_TEAMS = 6;

const VALID_GAME_MODES: GameMode[] = ['classic', 'blitz', 'elimination', 'buzz'];

/**
 * Game-type selection drives which provider's playlists show in the
 * picker. Single-provider games avoid the iOS cross-provider wake-banner
 * issue we hit with mixed sessions — and clarify the value tiers
 * (Spotify = your library; Deezer = no-account demo packs).
 */
export type GameProvider = 'spotify' | 'deezer';
const VALID_GAME_PROVIDERS: GameProvider[] = ['spotify', 'deezer'];

/**
 * Who can answer each round:
 *  - 'alternating' — one team gets the round, rotates in index order
 *    starting from a randomly-picked first team. Only that team's
 *    award button shows on the guessing screen.
 *  - 'free-for-all' — any team can answer; the host taps whichever
 *    team buzzed in first. All team buttons shown.
 */
export type TurnStyle = 'alternating' | 'free-for-all';
const VALID_TURN_STYLES: TurnStyle[] = ['alternating', 'free-for-all'];

/**
 * Elimination bonus-turn cap. When the active team gets BOTH song + artist
 * correct on their own pick, they earn a 'hot streak' — pick again immediately.
 * Steal recipients don't earn the bonus (only the picker).
 *
 *  - 'off' — bonus turns disabled, normal rotation always
 *  - 'limit-3' — max 3 consecutive bonus turns, then forced rotation
 *  - 'unlimited' — chain forever (dominant teams may snowball — power-user setting)
 *
 * Only meaningful in Elimination mode; other modes ignore this setting.
 */
export type HotStreakSetting = 'off' | 'limit-3' | 'unlimited';
const VALID_HOT_STREAK_SETTINGS: HotStreakSetting[] = ['off', 'limit-3', 'unlimited'];

interface SetupStoreState {
  teamCount: number;
  teamNames: string[];
  targetScore: number;
  gameMode: GameMode;
  gameProvider: GameProvider;
  turnStyle: TurnStyle;
  hotStreakSetting: HotStreakSetting;
  selectedPlaylistIds: string[];
  hasHydrated: boolean;

  setTeamCount: (n: number) => void;
  setTeamName: (index: number, name: string) => void;
  setTargetScore: (score: number) => void;
  setGameMode: (mode: GameMode) => void;
  /**
   * Switching providers clears selectedPlaylistIds — the IDs from one
   * provider's library aren't meaningful for the other and would just
   * cause the picker to show "0 of N selected" wrongly.
   */
  setGameProvider: (p: GameProvider) => void;
  setTurnStyle: (s: TurnStyle) => void;
  setHotStreakSetting: (s: HotStreakSetting) => void;
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
      // Default to Spotify game — the primary path. If the user has
      // never connected Spotify, the setup screen surfaces the Connect
      // CTA prominently; if they prefer Deezer demo packs, they tap
      // the Deezer chip and we remember it (persisted via partialize).
      gameProvider: 'spotify',
      // Default to alternating turns — matches how most party music
      // games actually play (host points at a team, they buzz in).
      // Power hosts can switch to free-for-all in setup.
      turnStyle: 'alternating',
      // Default to limit-3 — gives the hot-streak feel without runaway
      // snowball games. Only applies to Elimination; ignored in other
      // modes.
      hotStreakSetting: 'limit-3',
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
      setGameProvider: (gameProvider) => {
        set({ gameProvider, selectedPlaylistIds: [] });
      },
      setTurnStyle: (turnStyle) => set({ turnStyle }),
      setHotStreakSetting: (hotStreakSetting) => set({ hotStreakSetting }),
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
      partialize: (state) => ({
        gameMode: state.gameMode,
        gameProvider: state.gameProvider,
        turnStyle: state.turnStyle,
        hotStreakSetting: state.hotStreakSetting,
      }),
      onRehydrateStorage: () => (state, error) => {
        diag(
          `setup rehydrate cb: state=${state ? 'yes' : 'NO'} error=${
            error ? String(error) : 'none'
          }`
        );
        if (!state) return;
        try {
          // Migrate old 'classic-timed' → 'blitz'; sanitize anything else.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const persistedMode = state.gameMode as any;
          if (persistedMode === 'classic-timed') {
            state.gameMode = 'blitz';
          } else if (!VALID_GAME_MODES.includes(persistedMode)) {
            state.gameMode = 'classic';
          }
          // Sanitize gameProvider — installs from before this field existed
          // (or any junk) fall back to 'spotify' as the primary path.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const persistedProvider = state.gameProvider as any;
          if (!VALID_GAME_PROVIDERS.includes(persistedProvider)) {
            state.gameProvider = 'spotify';
          }
          // Same sanitization for turnStyle — default to 'alternating'.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const persistedTurn = state.turnStyle as any;
          if (!VALID_TURN_STYLES.includes(persistedTurn)) {
            state.turnStyle = 'alternating';
          }
          // hotStreakSetting sanitization. Field new in June 7 build, so
          // older installs won't have it — default 'limit-3'.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const persistedStreak = state.hotStreakSetting as any;
          if (!VALID_HOT_STREAK_SETTINGS.includes(persistedStreak)) {
            state.hotStreakSetting = 'limit-3';
          }
          state.targetScore = targetScoreBounds(state.gameMode).default;
          state.hasHydrated = true;
          diag('setup rehydrate: hasHydrated=true DONE');
        } catch (err) {
          diag(`setup rehydrate THREW: ${String(err)}`);
          Sentry.captureException(err, { tags: { hydration: 'setup' } });
          // Same protective fallback as playlistStore — set hasHydrated so the
          // app can boot even if rehydration threw. User gets default settings.
          state.hasHydrated = true;
        }
      },
    }
  )
);
