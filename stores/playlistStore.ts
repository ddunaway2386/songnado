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
  /**
   * Fetch the next playable track from the rotation, skipping any
   * that fail preview-URL retrieval OR match `skipIf`. Used by
   * gameplay to hide songs the user has flagged for removal during
   * a family test.
   */
  fetchNextPlayableTrack: (
    playlistId: string,
    skipIf?: (song: Song) => boolean
  ) => Promise<PlayableTrack | null>;
  resetPlaylist: (playlistId: string) => void;
  clearDidReset: () => void;
  addPlaylist: (providerId: ProviderId, meta: PlaylistMeta) => void;
  /**
   * Bulk-add playlists for a provider. Skips IDs that already exist in
   * the store (preserves their `playedIndices`). Used by the Spotify
   * connect flow to push the user's library in one shot.
   */
  addPlaylists: (providerId: ProviderId, metas: PlaylistMeta[]) => void;
  removePlaylist: (playlistId: string) => void;
  /**
   * Remove all playlists from a single provider. Used on Spotify
   * disconnect to clear the user's library from the picker.
   */
  removePlaylistsByProvider: (providerId: ProviderId) => void;
  refreshMeta: (options?: { force?: boolean }) => Promise<void>;
}

/**
 * Merge persisted playlists with the current SEED_PLAYLISTS such that:
 *
 *   - Seed metadata (tier, name, totalTracks, imageUrl, provider) always
 *     wins over persisted values. This lets us ship retiering + rename
 *     updates via OTA without users needing to reinstall.
 *   - Rotation state (playedIndices) is preserved from persisted so users
 *     don't hear the same songs twice after an update.
 *   - Non-seed playlists (user-added URLs, Spotify-hydrated entries)
 *     survive untouched.
 */
function mergeSeeds(stored: Playlist[]): Playlist[] {
  const storedById = new Map(stored.map((p) => [p.id, p]));
  const result: Playlist[] = [];
  for (const seed of SEED_PLAYLISTS) {
    const persisted = storedById.get(seed.id);
    result.push({
      ...seed,
      playedIndices: persisted?.playedIndices ?? [],
    });
    storedById.delete(seed.id);
  }
  for (const extra of storedById.values()) result.push(extra);
  return result;
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

      fetchNextPlayableTrack: async (playlistId, skipIf) => {
        const playlist = get().playlists.find((p) => p.id === playlistId);
        if (!playlist) return null;
        const provider = getProvider(playlist.provider);
        // Allow more retries when a filter is provided — we're skipping
        // whole tracks not just null previews. Cap at 2x the base
        // retry count so a heavily-flagged pack doesn't loop forever.
        const maxAttempts = skipIf
          ? MAX_NULL_PREVIEW_RETRIES * 2
          : MAX_NULL_PREVIEW_RETRIES;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const index = get().pickNextIndex(playlistId);
          if (index == null) return null;
          const song = await provider.getTrackAtIndex(playlistId, index);
          if (!song) continue;
          if (skipIf && skipIf(song)) continue;
          return { song, index, attempts: attempt };
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

      addPlaylists: (providerId, metas) => {
        set((state) => {
          const existingIds = new Set(state.playlists.map((p) => p.id));
          const newOnes: Playlist[] = metas
            .filter((m) => !existingIds.has(m.id))
            .map((m) => ({
              ...m,
              provider: providerId,
              isBuiltIn: false,
              playedIndices: [],
            }));
          if (newOnes.length === 0) return state;
          return { ...state, playlists: [...state.playlists, ...newOnes] };
        });
      },

      removePlaylist: (playlistId) => {
        set((state) => ({
          playlists: state.playlists.filter(
            (p) => p.id !== playlistId || p.isBuiltIn
          ),
        }));
      },

      removePlaylistsByProvider: (providerId) => {
        set((state) => ({
          playlists: state.playlists.filter((p) => p.provider !== providerId),
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
            // Race-safe: `state.playlists` may have grown since we kicked off
            // the parallel allSettled (e.g. spotifyStore's fire-and-forget
            // hydrateSpotifyPlaylists added entries). Newly-added playlists
            // have no result slot — leave them as-is rather than crashing on
            // a `.status` read against undefined.
            const r = results[i];
            if (!r || r.status !== 'fulfilled') return p;
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
        // Persist Deezer + custom Deezer playlists. Spotify playlists are
        // tied to the user's account and refetched fresh on each connect —
        // don't persist them or we risk showing stale entries from a prior
        // session (or a different user, if the app is shared).
        playlists: state.playlists.filter((p) => p.provider !== 'spotify'),
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
