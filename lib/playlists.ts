import { getAllCuratedDeezerPlaylists } from './curated/deezer-loader';
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
  // 70's + 2020's moved to curated-Deezer JSON so we could grow them
  // with canonical additions. Still live-Deezer for 80's / 90's /
  // 2000's / 2010's since those already have plenty of tracks from
  // Deezer editorial curation.
  { id: '15401958123', name: "80's Mega Hits", totalTracks: 538, tier: 'free' },
  { id: '15386355463', name: "90's Mega Hits", totalTracks: 503, tier: 'free' },
  { id: '13700823101', name: "2000's Mega Hits", totalTracks: 914, tier: 'free' },
  { id: '13700823021', name: "2010's Mega Hits", totalTracks: 606, tier: 'free' },
  // Renamed from "Billboard #1's" for two reasons. It was never a Billboard
  // chart list — the underlying playlist is "All Hits 70s-20s", a general
  // hits mix — and "Billboard" is a Penske Media trademark, so naming a
  // commercial app's feature after it implies an affiliation we don't have.
  //
  // 2000 tracks, not the 972 this said until a full catalogue export checked
  // the API. Rotation only picks indices below this number, so ~1,000 tracks
  // in the pack were unreachable.
  { id: '13700822301', name: 'All-Time Hits', totalTracks: 2000, tier: 'locked' },
  // Movie Classics + Modern Movies migrated to curated-Deezer (June 23 2026) —
  // bundled JSON in assets/curated-deezer/ instead of live Deezer playlists.
  // Wedding + Broadway + Road Trip migrated to curated-Deezer (later 2026) —
  // Soundiiz's fuzzy matcher was dropping 10-20% of intended tracks on upload;
  // building the packs from Deezer-search results in-repo bypasses that.
  // Faster curator iteration (JSON edits instead of Deezer UI clicks), and
  // every track ships with its source label baked in.
  // See curatedDeezerSeedPlaylists below.
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
 * Curated-Spotify playlists — pre-baked JSON in `assets/curated/`, played
 * through Spotify Connect.
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

/**
 * Curated-Deezer playlists — pre-baked JSON in `assets/curated-deezer/`,
 * played through Deezer's 30-second preview API (fresh preview URL fetched
 * per round). Used for packs where every track has a known `source` label
 * (Movies / TV / Musical / Brand) and we need fast curator iteration. Tier
 * lives in the JSON file itself.
 */
const curatedDeezerSeedPlaylists: Playlist[] = getAllCuratedDeezerPlaylists().map((data) => ({
  id: data.id,
  name: data.name,
  imageUrl: data.imageUrl,
  totalTracks: data.tracks.length,
  tier: data.tier,
  provider: 'curated-deezer',
  isBuiltIn: true,
  playedIndices: [],
}));

export const SEED_PLAYLISTS: Playlist[] = [
  ...curatedSeedPlaylists,
  ...curatedDeezerSeedPlaylists,
  ...deezerSeedPlaylists,
];
