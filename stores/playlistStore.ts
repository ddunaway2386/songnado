import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { SEED_PLAYLISTS } from '@/lib/playlists';
import { getProvider } from '@/lib/providers';
import { selectNextIndex } from '@/lib/rotation';
import type { Playlist, PlaylistMeta, ProviderId, Song } from '@/lib/types';

const MAX_NULL_PREVIEW_RETRIES = 10;

export interface PlayableTrack {
  song: Song;
  index: number;
  attempts: number;
}

const META_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface PlaylistStoreState {
  playlists: Playlist[];
  didReset: boolean;
  hasHydrated: boolean;
  lastMetaRefresh: number | null;

  pickNextIndex: (playlistId: string) => number | null;
  fetchNextPlayableTrack: (playlistId: string) => Promise<PlayableTrack | null>;
  resetPlaylist: (playlistId: string) => void;
  clearDidReset: () => void;
  addPlaylist: (providerId: ProviderId, meta: PlaylistMeta) => void;
  removePlaylist: (playlistId: string) => void;
  refreshMeta: (options?: { force?: boolean }) => Promise<void>;
}

function mergeSeeds(stored: Playlist[]): Playlist[] {
  const byId = new Map(stored.map((p) => [p.id, p]));
  for (const seed of SEED_PLAYLISTS) {
    if (!byId.has(seed.id)) byId.set(seed.id, seed);
  }
  return Array.from(byId.values());
}

/**
 * Backfill `provider: 'deezer'` on persisted playlists from before the
 * multi-provider refactor. Safe to remove once all installs have migrated.
 */
function backfillProvider(playlist: Playlist): Playlist {
  if (playlist.provider) return playlist;
  return { ...playlist, provider: 'deezer' };
}

export const usePlaylistStore = create<PlaylistStoreState>()(
  persist(
    (set, get) => ({
      playlists: SEED_PLAYLISTS,
      didReset: false,
      hasHydrated: false,
      lastMetaRefresh: null,

      pickNextIndex: (playlistId) => {
        const playlist = get().playlists.find((p) => p.id === playlistId);
        if (!playlist) return null;
        const result = selectNextIndex(playlist.playedIndices, playlist.totalTracks);
        if (!result) return null;
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId ? { ...p, playedIndices: result.nextPlayed } : p
          ),
          didReset: result.didReset,
        }));
        return result.index;
      },

      fetchNextPlayableTrack: async (playlistId) => {
        const playlist = get().playlists.find((p) => p.id === playlistId);
        if (!playlist) return null;
        const provider = getProvider(playlist.provider);
        for (let attempt = 1; attempt <= MAX_NULL_PREVIEW_RETRIES; attempt++) {
          const index = get().pickNextIndex(playlistId);
          if (index == null) return null;
          const song = await provider.getTrackAtIndex(playlistId, index);
          if (song) return { song, index, attempts: attempt };
        }
        return null;
      },

      resetPlaylist: (playlistId) => {
        set((state) => ({
          playlists: state.playlists.map((p) =>
            p.id === playlistId ? { ...p, playedIndices: [] } : p
          ),
        }));
      },

      clearDidReset: () => set({ didReset: false }),

      addPlaylist: (providerId, meta) => {
        const existing = get().playlists.find((p) => p.id === meta.id);
        if (existing) return;
        const playlist: Playlist = {
          ...meta,
          provider: providerId,
          isBuiltIn: false,
          playedIndices: [],
        };
        set((state) => ({ playlists: [...state.playlists, playlist] }));
      },

      removePlaylist: (playlistId) => {
        set((state) => ({
          playlists: state.playlists.filter(
            (p) => p.id !== playlistId || p.isBuiltIn
          ),
        }));
      },

      refreshMeta: async ({ force = false } = {}) => {
        const { lastMetaRefresh, playlists } = get();
        if (
          !force &&
          lastMetaRefresh != null &&
          Date.now() - lastMetaRefresh < META_REFRESH_COOLDOWN_MS
        ) {
          return;
        }
        const results = await Promise.allSettled(
          playlists.map((p) => getProvider(p.provider).getPlaylistMeta(p.id))
        );
        set((state) => ({
          lastMetaRefresh: Date.now(),
          playlists: state.playlists.map((p, i) => {
            const r = results[i];
            if (r.status !== 'fulfilled') return p;
            return {
              ...p,
              name: p.isBuiltIn ? p.name : r.value.name,
              imageUrl: r.value.imageUrl || p.imageUrl,
              totalTracks: r.value.totalTracks,
            };
          }),
        }));
      },
    }),
    {
      name: 'songster-playlists',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        playlists: state.playlists,
        lastMetaRefresh: state.lastMetaRefresh,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.playlists = mergeSeeds(state.playlists.map(backfillProvider));
          state.hasHydrated = true;
        }
      },
    }
  )
);
