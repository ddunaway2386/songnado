import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { SEED_PLAYLISTS } from '@/lib/playlists';
import { getProvider } from '@/lib/providers';
import { selectNextIndex } from '@/lib/rotation';
import type { Playlist, PlaylistMeta, ProviderId, Song } from '@/lib/types';

// Sentry disabled at runtime until the 1.0.2 native build ships — see
// app/_layout.tsx comment. Local no-op shims keep the try/catch fallback
// code paths intact (they still protect against silent hydration hangs)
// without pulling in the native module.
const Sentry = {
  addBreadcrumb: (_: unknown): void => undefined,
  captureException: (_err: unknown, _ctx?: unknown): void => undefined,
};

const MAX_NULL_PREVIEW_RETRIES = 10;

// ─── Recency filter (no back-to-back same artist / same source) ─────
//
// In-memory rolling window per playlist. Not persisted — restarts
// each app launch. Party games don't need cross-session recency.
//
// ARTIST_WINDOW: same artist can't reappear within this many tracks
// SOURCE_WINDOW: same source (movie/show/musical) same rule, tighter
//
// If the pack is small enough that the filter can't find a candidate,
// fetchNextPlayableTrack falls back to no-recency in a second pass —
// better a mild repeat than a stalled game.

const ARTIST_WINDOW = 15;
const SOURCE_WINDOW = 10;
const recentPlaysByPlaylist = new Map<
  string,
  { artist: string; source: string }[]
>();

function shouldSkipForRecency(playlistId: string, song: Song): boolean {
  const recent = recentPlaysByPlaylist.get(playlistId);
  if (!recent || recent.length === 0) return false;
  const artist = (song.artist || '').toLowerCase();
  const source = (song.source || '').toLowerCase();
  const artistCheck = recent.slice(-ARTIST_WINDOW);
  if (artist && artistCheck.some((r) => r.artist === artist)) return true;
  if (source) {
    const sourceCheck = recent.slice(-SOURCE_WINDOW);
    if (sourceCheck.some((r) => r.source === source)) return true;
  }
  return false;
}

function recordRecentPlay(playlistId: string, song: Song): void {
  const recent = recentPlaysByPlaylist.get(playlistId) ?? [];
  recent.push({
    artist: (song.artist || '').toLowerCase(),
    source: (song.source || '').toLowerCase(),
  });
  // Cap window growth — 2x the max keeps trim rare
  const cap = Math.max(ARTIST_WINDOW, SOURCE_WINDOW) * 2;
  if (recent.length > cap) recent.splice(0, recent.length - cap);
  recentPlaysByPlaylist.set(playlistId, recent);
}

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
 * Persisted playlist IDs that used to be seed entries but have since been
 * migrated to a different provider/ID. If we leave them in state, mergeSeeds
 * treats them as "extras" and they persist forever with isBuiltIn:true, so
 * they show up in the wizard as ghost duplicates (e.g. two "70's Mega Hits"
 * rows — old live-Deezer + new curated-Deezer). Filter them out on hydration.
 */
const ORPHANED_SEED_IDS = new Set<string>([
  '13700823521', // was "70's Mega Hits" live-Deezer, migrated to songnado-70s-mega-hits
  '13700822841', // was "2020's Mega Hits" live-Deezer, migrated to songnado-2020s-mega-hits
]);

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
 *   - Entries in ORPHANED_SEED_IDS are dropped (migrated seeds that would
 *     otherwise dangle in the persisted extras bucket forever).
 */
function mergeSeeds(stored: Playlist[]): Playlist[] {
  const cleaned = stored.filter((p) => !ORPHANED_SEED_IDS.has(p.id));
  const storedById = new Map(cleaned.map((p) => [p.id, p]));
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

        // First pass: honor the recency window (prevents same artist
        // within 15 tracks, same source within 10). Loosened budget
        // so a filter-heavy pack has room to search.
        const maxAttempts = skipIf
          ? MAX_NULL_PREVIEW_RETRIES * 3
          : MAX_NULL_PREVIEW_RETRIES * 2;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const index = get().pickNextIndex(playlistId);
          if (index == null) return null;
          const song = await provider.getTrackAtIndex(playlistId, index);
          if (!song) continue;
          if (skipIf && skipIf(song)) continue;
          if (shouldSkipForRecency(playlistId, song)) continue;
          recordRecentPlay(playlistId, song);
          return { song, index, attempts: attempt };
        }

        // Fallback: recency window couldn't find a match (small pack,
        // or all remaining tracks are same-artist). Drop the recency
        // filter and take any non-flagged track — better a mild
        // repeat than a stalled game.
        for (let attempt = 1; attempt <= MAX_NULL_PREVIEW_RETRIES; attempt++) {
          const index = get().pickNextIndex(playlistId);
          if (index == null) return null;
          const song = await provider.getTrackAtIndex(playlistId, index);
          if (!song) continue;
          if (skipIf && skipIf(song)) continue;
          recordRecentPlay(playlistId, song);
          return { song, index, attempts: maxAttempts + attempt };
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
        if (!state) return;
        try {
          Sentry.addBreadcrumb({
            category: 'store.playlist',
            message: `rehydrate: start, ${state.playlists?.length ?? 0} persisted`,
            level: 'info',
          });
          const backfilled = state.playlists.map(backfillProvider);
          Sentry.addBreadcrumb({
            category: 'store.playlist',
            message: `rehydrate: backfilled ${backfilled.length}`,
            level: 'info',
          });
          state.playlists = mergeSeeds(backfilled);
          Sentry.addBreadcrumb({
            category: 'store.playlist',
            message: `rehydrate: merged, ${state.playlists.length} total`,
            level: 'info',
          });
          state.hasHydrated = true;
        } catch (err) {
          Sentry.captureException(err, {
            tags: { hydration: 'playlist' },
            extra: {
              storedCount: state.playlists?.length,
              // Cap to first 5 entries to avoid PII bloat; each is small metadata
              storedSample: state.playlists?.slice(0, 5),
            },
          });
          // FALLBACK: use fresh seed playlists so the app can boot. User loses
          // playedIndices (song rotation resets) but avoids the infinite-spinner
          // hang we couldn't diagnose all night. Any future hydration crash
          // recovers gracefully instead of black-screening the whole app.
          state.playlists = SEED_PLAYLISTS;
          state.hasHydrated = true;
        }
      },
    }
  )
);
