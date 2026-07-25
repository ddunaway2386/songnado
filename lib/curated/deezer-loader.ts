/**
 * Curated-Deezer playlist data loader.
 *
 * For Movies/TV/Musical/Brand packs where every track has a known `source`
 * (movie/show/musical/brand label) and we need fast curator iteration.
 * The track list ships as JSON in the app bundle under
 * `assets/curated-deezer/`. At runtime the Deezer track API still gets
 * called once per round to fetch a fresh preview URL (Deezer's previews
 * carry time-limited tokens), but the catalog and source data is local.
 *
 * Why a separate loader from `loader.ts`:
 *  - Different track schema. Curated-Spotify tracks carry a Spotify URI;
 *    curated-Deezer tracks carry a Deezer track ID + source field.
 *  - Curated-Spotify plays through Spotify Connect; curated-Deezer plays
 *    via the same 30-second preview pipeline as the live Deezer provider.
 *  - Keeps the two surface areas independently auditable as the Spotify
 *    side evolves toward its eventual EQM unlock.
 *
 * Adding a new curated-Deezer playlist:
 *   1. Drop the JSON file into `assets/curated-deezer/`.
 *   2. Add an entry to `playlistLoaders` below — Metro requires literal
 *      require() paths for static analysis.
 *   3. Add the matching seed entry to `lib/playlists.ts`.
 */

export interface CuratedDeezerTrack {
  /** Deezer track ID. Used at play time to fetch a fresh preview URL. */
  deezerId: string;
  title: string;
  artist: string;
  /**
   * Movie / TV show / musical / brand this track is associated with.
   * Surfaces on the reveal screen as a "from X" badge so the host can
   * credit any of (title, artist, source) as a correct guess.
   *
   * Empty string for tracks with no known media tie (rare for these
   * pack types — curated-Deezer packs should aim for full source coverage).
   */
  source: string;
}

export interface CuratedDeezerPlaylistData {
  /** Stable ID. Convention: `songnado-<slug>` to avoid Deezer-ID collisions. */
  id: string;
  name: string;
  /** Cover image URL; empty string for a gray placeholder. */
  imageUrl: string;
  /** v1 launch tier: 'free' or 'locked'. */
  tier: 'free' | 'locked';
  /** Bumped when the playlist is regenerated. */
  version: number;
  tracks: CuratedDeezerTrack[];
}

/**
 * Source of truth for which curated-Deezer playlists ship in the app.
 * Metro statically analyzes these require() calls at bundle time.
 */
const playlistLoaders: Record<string, () => unknown> = {
  'songnado-movie-classics': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/movie-classics.json'),
  'songnado-modern-movies': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/modern-movies.json'),
  'songnado-classic-tv-themes': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/classic-tv-themes.json'),
  'songnado-modern-tv-themes': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/modern-tv-themes.json'),
  'songnado-wedding': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/wedding.json'),
  'songnado-broadway': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/broadway.json'),
  'songnado-road-trip': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/road-trip.json'),
};

const cache = new Map<string, CuratedDeezerPlaylistData>();

export function getCuratedDeezerPlaylist(id: string): CuratedDeezerPlaylistData {
  const cached = cache.get(id);
  if (cached) return cached;

  const loader = playlistLoaders[id];
  if (!loader) {
    throw new Error(`Unknown curated-Deezer playlist: "${id}"`);
  }

  const data = loader() as CuratedDeezerPlaylistData;
  if (!data || typeof data !== 'object' || data.id !== id) {
    throw new Error(
      `Curated-Deezer playlist file id "${data?.id}" doesn't match registry key "${id}"`
    );
  }

  cache.set(id, data);
  return data;
}

export function listCuratedDeezerPlaylistIds(): string[] {
  return Object.keys(playlistLoaders);
}

export function getAllCuratedDeezerPlaylists(): CuratedDeezerPlaylistData[] {
  return listCuratedDeezerPlaylistIds().map(getCuratedDeezerPlaylist);
}
