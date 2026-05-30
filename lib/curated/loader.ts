/**
 * Curated-playlist data loader.
 *
 * Curated playlists are pre-baked at curation time: track URIs, titles,
 * artists, and durations are captured once (from outside the Songnado dev
 * app's Web API context — see CURATED_PLAYLISTS_DESIGN.md §5) and shipped
 * as JSON in the app bundle under `assets/curated/`. At runtime this module
 * resolves a playlist ID to its data with no network call, dodging the
 * Spotify dev-mode `/playlists/{id}/tracks` block entirely.
 *
 * Adding a new curated playlist:
 *   1. Drop the JSON file into `assets/curated/`.
 *   2. Add an entry to `playlistLoaders` below — Metro requires literal
 *      `require()` paths for static analysis, so dynamic discovery isn't
 *      an option here.
 *   3. The seeds in `lib/playlists.ts` will pick it up automatically.
 *
 * See `assets/curated/README.md` for the JSON schema and curation workflow.
 */

export interface CuratedTrack {
  /** Full Spotify URI (e.g. `spotify:track:abc...`). Passed to `playUri()`. */
  uri: string;
  title: string;
  artist: string;
  /** Optional. Falls back to the playlist's `imageUrl` on the reveal screen. */
  albumImageUrl?: string;
  /** Required for `pickRandomStartMs` so the 30s window fits inside the track. */
  durationMs: number;
}

export interface CuratedPlaylistData {
  /** Stable opaque ID; convention is `songnado-<slug>` to avoid Spotify-ID collisions. */
  id: string;
  name: string;
  /** Cover image URL (usually a Spotify CDN URL); empty string for a gray placeholder. */
  imageUrl: string;
  /** Songnado Premium gating: `free` = available to all users, `pro` = Premium-only. */
  tier: 'free' | 'pro';
  /** Bumped when the playlist is regenerated; used by future OTA + index-reset logic. */
  version: number;
  tracks: CuratedTrack[];
}

/**
 * Source of truth for which curated playlists ship in the app. Metro
 * statically analyzes these `require()` calls at bundle time, so new entries
 * must be added by hand — dynamic discovery via `manifest.json` (the older
 * design) doesn't survive Metro's require-resolution.
 */
const playlistLoaders: Record<string, () => unknown> = {
  'songnado-smoke-test': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated/songnado-smoke-test.json'),
};

/** First-load cache. Curated data is immutable at runtime, so cache forever. */
const cache = new Map<string, CuratedPlaylistData>();

/**
 * Resolve a curated playlist by ID. Throws if the ID isn't in the loader map
 * (which would mean a stale registry — the seed playlist was added without
 * adding the loader entry). Throws if the JSON file's `id` field doesn't
 * match the map key (which would mean someone renamed a playlist without
 * updating both places).
 */
export function getCuratedPlaylist(id: string): CuratedPlaylistData {
  const cached = cache.get(id);
  if (cached) return cached;

  const loader = playlistLoaders[id];
  if (!loader) {
    throw new Error(`Unknown curated playlist: "${id}"`);
  }

  const data = loader() as CuratedPlaylistData;

  if (!data || typeof data !== 'object' || data.id !== id) {
    throw new Error(
      `Curated playlist file id "${data?.id}" doesn't match registry key "${id}"`
    );
  }

  cache.set(id, data);
  return data;
}

/** IDs of every curated playlist registered. Used by the seed builder. */
export function listCuratedPlaylistIds(): string[] {
  return Object.keys(playlistLoaders);
}

/** Eagerly load every curated playlist. Used by the seed builder at app init. */
export function getAllCuratedPlaylists(): CuratedPlaylistData[] {
  return listCuratedPlaylistIds().map(getCuratedPlaylist);
}
