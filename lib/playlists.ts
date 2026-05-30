import { getAllCuratedPlaylists } from './curated/loader';
import type { Playlist } from './types';

type DeezerSeed = Pick<Playlist, 'id' | 'name' | 'totalTracks'>;

const DEEZER_SEEDS: DeezerSeed[] = [
  { id: '13700823521', name: "1970's", totalTracks: 461 },
  { id: '13700820281', name: "1980's", totalTracks: 562 },
  { id: '13707544281', name: "1990's", totalTracks: 556 },
  { id: '13700823101', name: "2000's", totalTracks: 913 },
  { id: '13700823021', name: "2010's", totalTracks: 605 },
  { id: '13700822841', name: "2020's", totalTracks: 103 },
  { id: '13700822301', name: "Billboard #1's", totalTracks: 972 },
  { id: '13700843081', name: 'Soundtracks', totalTracks: 803 },
  { id: '13889425981', name: 'Broadway', totalTracks: 450 },
  { id: '13889467621', name: 'TV Themes', totalTracks: 249 },
  { id: '13904299281', name: 'Movie Songs', totalTracks: 316 },
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
