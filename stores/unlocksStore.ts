/**
 * Unlocks store — tracks which locked packs the user has earned access to.
 *
 * Soft-lock model:
 *  - Seed playlists carry a `tier` field ('free' | 'locked').
 *  - Free packs are visible AND playable to everyone, always.
 *  - Locked packs are visible but render with a lock icon in the picker.
 *  - Tapping a locked pack opens a modal with three unlock paths:
 *      1. Engagement — play N more games (Apple-policy-clean)
 *      2. Share — share Songnado with a friend via native share sheet
 *      3. IAP — buy this specific pack ($2.99) or subscribe to Pro
 *
 * All state local to the device (AsyncStorage). No backend dependency.
 * IAP receipts will be validated via StoreKit when we wire that up in
 * Phase D — for now, isPro is a manual setter for testing.
 *
 * NOTE: Apple App Store Guideline 5.6.1 prohibits incentivizing reviews
 * specifically. "Leave a review to unlock" would get the app rejected.
 * Engagement (play X games) and sharing (general share sheet, not
 * review-specific) are both allowed.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Playlist } from '@/lib/types';

/** Games-played threshold to unlock one pack of the user's choosing. */
export const UNLOCK_VIA_PLAY_GAMES_THRESHOLD = 5;

interface UnlocksState {
  /** Pro subscription state — when true, all locked packs are unlocked. */
  isPro: boolean;
  /** Manually unlocked pack IDs (via play count, share, or IAP). */
  unlockedPackIds: string[];
  /** Total games played, ever. Drives the play-to-unlock counter. */
  gamesPlayed: number;
  /** Total shares completed, ever. Drives the share-to-unlock counter. */
  sharesCompleted: number;
  /** True after the store has rehydrated from AsyncStorage. */
  hasHydrated: boolean;

  // ---- Actions ----

  /** Bump games played by 1. Called from gameStore when a round ends. */
  recordGamePlayed: () => void;
  /** Bump shares by 1. Called from the share sheet completion handler. */
  recordShareCompleted: () => void;
  /** Mark a specific pack as unlocked. Idempotent. */
  unlockPack: (packId: string) => void;
  /** Toggle Pro state. For now exposed for testing; StoreKit will own this later. */
  setIsPro: (v: boolean) => void;
  /**
   * Reset everything. Useful for a "factory reset" debug action; not
   * exposed in production UI.
   */
  clearAll: () => void;
}

export const useUnlocksStore = create<UnlocksState>()(
  persist(
    (set, get) => ({
      isPro: false,
      unlockedPackIds: [],
      gamesPlayed: 0,
      sharesCompleted: 0,
      hasHydrated: false,

      recordGamePlayed: () => set({ gamesPlayed: get().gamesPlayed + 1 }),
      recordShareCompleted: () =>
        set({ sharesCompleted: get().sharesCompleted + 1 }),
      unlockPack: (packId) => {
        const current = get().unlockedPackIds;
        if (current.includes(packId)) return;
        set({ unlockedPackIds: [...current, packId] });
      },
      setIsPro: (isPro) => set({ isPro }),
      clearAll: () =>
        set({
          isPro: false,
          unlockedPackIds: [],
          gamesPlayed: 0,
          sharesCompleted: 0,
        }),
    }),
    {
      name: 'songnado.unlocks.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        isPro: state.isPro,
        unlockedPackIds: state.unlockedPackIds,
        gamesPlayed: state.gamesPlayed,
        sharesCompleted: state.sharesCompleted,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasHydrated = true;
      },
    }
  )
);

/**
 * Pure helper — checks whether a playlist is currently playable for the user.
 *
 * - Non-locked playlists (free, or user-added URL playlists with no tier):
 *   always unlocked.
 * - Locked playlists: unlocked if Pro OR if specifically in unlockedPackIds.
 *
 * Designed to be called per-render in the picker; no side effects.
 */
export function isPackUnlocked(
  playlist: Playlist,
  state: Pick<UnlocksState, 'isPro' | 'unlockedPackIds'>
): boolean {
  if (playlist.tier !== 'locked') return true;
  if (state.isPro) return true;
  return state.unlockedPackIds.includes(playlist.id);
}

/**
 * Progress hint shown next to a locked pack — "Play 2 more games to
 * unlock for free" etc. Returns null when no engagement-based unlock
 * is in reach (e.g., already past the threshold but user hasn't picked
 * which pack to unlock yet — that's handled by the unlock modal).
 */
export function getUnlockProgressHint(
  state: Pick<UnlocksState, 'gamesPlayed'>
): string | null {
  const remaining = UNLOCK_VIA_PLAY_GAMES_THRESHOLD - (state.gamesPlayed % UNLOCK_VIA_PLAY_GAMES_THRESHOLD);
  if (remaining === UNLOCK_VIA_PLAY_GAMES_THRESHOLD && state.gamesPlayed > 0) {
    return 'Pick a pack to unlock — you earned it';
  }
  if (state.gamesPlayed === 0) {
    return `Play ${UNLOCK_VIA_PLAY_GAMES_THRESHOLD} games to unlock 1 pack free`;
  }
  return `Play ${remaining} more game${remaining === 1 ? '' : 's'} to unlock for free`;
}
