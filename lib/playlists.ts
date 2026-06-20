import { getAllCuratedPlaylists } from './curated/loader';
import type { Playlist, PlaylistTier } from './types';

type DeezerSeed = Pick<Playlist, 'id' | 'name' | 'totalTracks'> & {
  tier: PlaylistTier;
};

/**
 * Seed playlist tier assignment for v1 launch:
 *
 *   FREE (4) — Mainstream decades + Movie Songs. Cover the broadest
 *     possible first-impression audience: someone who downloaded the
 *     app should immediately recognize most of these.
 *
 *   LOCKED (7) — Niche / specialty / older-skew / flagship packs.
 *     Visible in the picker (real product depth), unlockable via play
 *     count, share, individual IAP, or Pro subscription.
 *
 * Re-tiering is a future-edit-here decision — no code change needed
 * elsewhere. Keep the count of free packs ≥3 so the free tier feels
 * like a real product, not a demo.
 */
const DEEZER_SEEDS: DeezerSeed[] = [
  { id: '13700823521', name: "1970's", totalTracks: 461, tier: 'locked' },
  { id: '15401958123', name: "80's Mega Hits", totalTracks: 538, tier: 'locked' },
  { id: '15386355463', name: "90's Mega Hits", totalTracks: 503, tier: 'free' },
  { id: '13700823101', name: "2000's", totalTracks: 913, tier: 'free' },
  { id: '13700823021', name: "2010's", totalTracks: 605, tier: 'free' },
  { id: '13700822841', name: "2020's", totalTracks: 103, tier: 'locked' },
  { id: '13700822301', name: "Billboard #1's", totalTracks: 972, tier: 'locked' },
  { id: '15427798341', name: 'Movie Classics', totalTracks: 341, tier: 'free' },
  { id: '15427817901', name: 'Modern Movies', totalTracks: 375, tier: 'locked' },
  { id: '13889425981', name: 'Broadway', totalTracks: 450, tier: 'locked' },
  { id: '13889467621', name: 'TV Themes', totalTracks: 249, tier: 'locked' },
];

const deezerSeedPlaylists: Playlist[] = DEEZER_SEEDS.map((s) => ({
  ...s,
  imageUrl: '',
  provider: 'deezer',
  isBuiltIn: true,
  playedIndices: [],
}));

/**
 * Curated playlists are built-in like Deezer seeds, but their data comes from
 * the pre-baked JSON in `assets/curated/` (see `CURATED_PLAYLISTS_DESIGN.md`).
 * Resolved at module load — the `require()` calls inside `getAllCuratedPlaylists`
 * are bundle-time resources so this is sync + cheap.
 */
const curatedSeedPlaylists: Playlist[] = getAllCuratedPlaylists().map((data) => ({
  id: data.id,
  name: data.name,
  imageUrl: data.imageUrl,
  totalTracks: data.tracks.length,
  provider: 'curated',
  isBuiltIn: true,
  playedIndices: [],
}));

export const SEED_PLAYLISTS: Playlist[] = [
  ...curatedSeedPlaylists,
  ...deezerSeedPlaylists,
];
