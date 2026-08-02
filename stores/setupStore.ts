import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  /**
   * Called from onRehydrateStorage to publish the hydrated values through
   * set() so subscribers re-render. Must be an action on the store (rather
   * than `useSetupStore.setState` inside the callback) — referencing the
   * exported const from within its own initializer is a temporal-dead-zone
   * error when the bundler statically renders this module for web.
   */
  finishHydration: (patch: Partial<SetupStoreState>) => void;

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

      finishHydration: (patch) => set({ ...patch, hasHydrated: true }),

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
        // zustand passes an error as the 2nd arg when hydration itself failed
        // upstream (storage read / JSON parse).
        if (error) {
          Sentry.captureException(error, { tags: { hydration: 'setup-upstream' } });
        }
        if (!state) {
          // Storage read / parse failed upstream. Previously we returned here
          // and hasHydrated stayed false forever — a guaranteed spinner hang.
          // No `state` means no action to call; defer so the store binding
          // exists, then boot with defaults.
          //
          // Native only — see the matching comment in playlistStore: on web
          // static render AsyncStorage is absent, this path always fires, and
          // the persist write it triggers rejects and fails the export.
          if (Platform.OS !== 'web') {
            setTimeout(() => useSetupStore.setState({ hasHydrated: true }), 0);
          }
          return;
        }
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
          // CRITICAL: publish hasHydrated through the store's set(), never by
          // mutating `state`. zustand only notifies subscribers on set() — a
          // raw mutation updates memory silently, so React keeps rendering the
          // stale `false` and the app sits on the pre-hydration spinner
          // forever. This store hydrates last, so nothing else triggers a
          // render afterward; that was the three-day OTA "hang."
          state.finishHydration({
            gameMode: state.gameMode,
            gameProvider: state.gameProvider,
            turnStyle: state.turnStyle,
            hotStreakSetting: state.hotStreakSetting,
            targetScore: state.targetScore,
          });
        } catch (err) {
          Sentry.captureException(err, { tags: { hydration: 'setup' } });
          // Same protective fallback as playlistStore — set hasHydrated so the
          // app can boot even if rehydration threw. User gets default settings.
          // Via set() (not mutation) so subscribers actually re-render.
          state.finishHydration({});
        }
      },
    }
  )
);
