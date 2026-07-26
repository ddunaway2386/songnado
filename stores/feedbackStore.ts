/**
 * Family test feedback store.
 *
 * Two flag actions available on the reveal screen after each round:
 *  - 'remove' → this song shouldn't be in this pack at all
 *  - 'bad-version' → the song is good but this recording is bad
 *    (wrong artist / karaoke / tribute / live / mono / etc.)
 *
 * Everything is stored locally in AsyncStorage. There's no backend.
 * Family members flag on their own phones during the weekend; Daniel
 * collects the exported JSON at the end via the Feedback screen's
 * native Share sheet, then runs scripts/apply-feedback.mjs to merge
 * the flags into the curated-Deezer JSON packs.
 *
 * Not filtered from playback locally — a flag captures intent, it
 * doesn't hide the song from the current session. Reasoning: during
 * a stress test we want to know what everyone's flagging without the
 * pack silently shrinking mid-game. Post-weekend merge applies the
 * removals.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type FeedbackKind = 'remove' | 'bad-version';

export interface FeedbackEntry {
  packName: string;
  packId: string;
  title: string;
  artist: string;
  /** Preserved so Daniel can eyeball which song a title refers to. */
  coverUrl?: string;
  /** Source label (movie/show/musical/brand) — helps disambiguate covers. */
  source?: string;
  /** Deezer preview URL if available — helps re-locate the exact track. */
  previewUrl?: string;
  kind: FeedbackKind;
  timestamp: number;
}

interface FeedbackState {
  entries: FeedbackEntry[];
  hasHydrated: boolean;

  flagRemove: (input: FlagInput) => void;
  flagBadVersion: (input: FlagInput) => void;
  removeEntry: (index: number) => void;
  clearAll: () => void;
}

interface FlagInput {
  packId: string;
  packName: string;
  title: string;
  artist: string;
  coverUrl?: string;
  source?: string;
  previewUrl?: string;
}

export const useFeedbackStore = create<FeedbackState>()(
  persist(
    (set, get) => ({
      entries: [],
      hasHydrated: false,

      flagRemove: (input) => {
        // De-dup: don't re-add the same title+artist+pack+kind twice
        const existing = get().entries.find(
          (e) =>
            e.packId === input.packId &&
            e.kind === 'remove' &&
            e.title === input.title &&
            e.artist === input.artist
        );
        if (existing) return;
        set((s) => ({
          entries: [...s.entries, { ...input, kind: 'remove', timestamp: Date.now() }],
        }));
      },

      flagBadVersion: (input) => {
        const existing = get().entries.find(
          (e) =>
            e.packId === input.packId &&
            e.kind === 'bad-version' &&
            e.title === input.title &&
            e.artist === input.artist
        );
        if (existing) return;
        set((s) => ({
          entries: [...s.entries, { ...input, kind: 'bad-version', timestamp: Date.now() }],
        }));
      },

      removeEntry: (index) => {
        set((s) => ({ entries: s.entries.filter((_, i) => i !== index) }));
      },

      clearAll: () => {
        set({ entries: [] });
      },
    }),
    {
      name: 'songnado.feedback.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ entries: state.entries }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hasHydrated = true;
      },
    }
  )
);
