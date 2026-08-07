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
  /**
   * Deezer flags the track as having explicit lyrics. Present only on
   * flagged tracks; absent means clean.
   */
  explicit?: boolean;
}

/**
 * Whether explicit-flagged tracks are playable.
 *
 * Songnado is pitched as a family party game, and a 30-second preview is
 * usually the hook — which for a lot of flagged songs is exactly the line
 * you wouldn't want playing at a kid's birthday. Filtering by default also
 * keeps the App Store age rating honest at 4+; claiming that with WAP in
 * the catalog would not survive review.
 *
 * The tracks are NOT deleted from the JSON — flipping this to true restores
 * all 185 of them, which is why the audit data lives in the packs rather
 * than being applied destructively. A user-facing toggle is deliberately
 * NOT shipped in v1: a setting only protects people who find it before the
 * wrong song plays.
 */
export const ALLOW_EXPLICIT = false;

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
  // Movies reorganized (family test feedback) from era-split (Classic /
  // Modern) to type-split (Soundtracks / Songs from Movies) — same
  // trivia catalog, split by whether the trivia challenge is "name the
  // movie from the instrumental score" vs "name the song / artist /
  // movie for a vocal track".
  'songnado-movie-soundtracks': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/movie-soundtracks.json'),
  'songnado-movie-songs': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/movie-songs.json'),
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
  // Decade packs migrated from live-Deezer to curated so we can grow
  // them with canonical additions (2020s was thin at 79 tracks and
  // 70s had gaps in famous canon).
  'songnado-70s-mega-hits': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/70s-mega-hits.json'),
  'songnado-2020s-mega-hits': () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../assets/curated-deezer/2020s-mega-hits.json'),
};

const cache = new Map<string, CuratedDeezerPlaylistData>();

export function getCuratedDeezerPlaylist(id: string): CuratedDeezerPlaylistData {
  const cached = cache.get(id);
  if (cached) return cached;

  const loader = playlistLoaders[id];
  if (!loader) {
    throw new Error(`Unknown curated-Deezer playlist: "${id}"`);
  }

  const raw = loader() as CuratedDeezerPlaylistData;
  if (!raw || typeof raw !== 'object' || raw.id !== id) {
    throw new Error(
      `Curated-Deezer playlist file id "${raw?.id}" doesn't match registry key "${id}"`
    );
  }

  // Filter explicit tracks here rather than at play time so indices stay
  // dense and totalTracks (derived from tracks.length in lib/playlists.ts)
  // reports what's actually playable. Filtering during playback would
  // leave gaps that burn retries and overstate pack sizes in the picker.
  const data: CuratedDeezerPlaylistData = ALLOW_EXPLICIT
    ? raw
    : { ...raw, tracks: raw.tracks.filter((t) => !t.explicit) };

  cache.set(id, data);
  return data;
}

export function listCuratedDeezerPlaylistIds(): string[] {
  return Object.keys(playlistLoaders);
}

export function getAllCuratedDeezerPlaylists(): CuratedDeezerPlaylistData[] {
  return listCuratedDeezerPlaylistIds().map(getCuratedDeezerPlaylist);
}
