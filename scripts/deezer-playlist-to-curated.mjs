#!/usr/bin/env node
/**
 * Migrate a live Deezer playlist to a curated-Deezer JSON file.
 * Same output shape the app already loads from
 * assets/curated-deezer/*.json.
 *
 * Reason: live-Deezer packs are handy for zero-curation decade packs
 * where Deezer editorial does the work (80s / 90s), but when we want
 * per-artist caps + our own additions on top of a base, we need
 * ownership of the track list. This script gives us the pack in a
 * form we can extend and cap.
 *
 * Usage:
 *   node scripts/deezer-playlist-to-curated.mjs <playlistId> <slug> <displayName> <tier>
 *
 * Examples:
 *   node scripts/deezer-playlist-to-curated.mjs 13700822841 2020s-mega-hits "2020's Mega Hits" free
 *   node scripts/deezer-playlist-to-curated.mjs 13700823521 70s-mega-hits "70's Mega Hits" free
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURATED_DIR = join(__dirname, '..', 'assets', 'curated-deezer');

const [, , playlistId, slug, displayName, tier] = process.argv;
if (!playlistId || !slug || !displayName || !tier) {
  console.error('Usage: node deezer-playlist-to-curated.mjs <playlistId> <slug> "<displayName>" <tier>');
  process.exit(1);
}
if (tier !== 'free' && tier !== 'locked') {
  console.error(`Tier must be 'free' or 'locked' (got '${tier}')`);
  process.exit(1);
}

const REJECT_RE = /karaoke|tribute|made\s*famous|in the style|glee cast|cover of\b/i;

async function fetchAllTracks(id) {
  const all = [];
  let index = 0;
  while (true) {
    const res = await fetch(
      `https://api.deezer.com/playlist/${id}/tracks?index=${index}&limit=100`
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!data.data || data.data.length === 0) break;
    all.push(...data.data);
    if (data.next) index += 100;
    else break;
  }
  return all;
}

const raw = await fetchAllTracks(playlistId);
console.log(`Fetched ${raw.length} raw tracks from Deezer playlist ${playlistId}`);

const seen = new Set();
const tracks = [];
let dropped = 0;
for (const t of raw) {
  const idStr = String(t.id);
  if (seen.has(idStr)) { dropped++; continue; }
  const s = (t.title || '') + ' ' + (t.artist?.name || '');
  if (REJECT_RE.test(s)) { dropped++; continue; }
  if (!t.preview) { dropped++; continue; }
  seen.add(idStr);
  tracks.push({
    deezerId: idStr,
    title: t.title,
    artist: t.artist?.name || '',
    source: '',
  });
}

const pack = {
  id: `songnado-${slug}`,
  name: displayName,
  imageUrl: '',
  tier,
  version: 1,
  tracks,
};

const outPath = join(CURATED_DIR, `${slug}.json`);
writeFileSync(outPath, JSON.stringify(pack, null, 2) + '\n');

console.log(`Wrote ${outPath} — ${tracks.length} tracks (dropped ${dropped} dupes/karaoke/no-preview)`);
console.log(`\nNext steps:`);
console.log(`  1. Register in lib/curated/deezer-loader.ts:`);
console.log(`     '${pack.id}': () => require('../../assets/curated-deezer/${slug}.json'),`);
console.log(`  2. Remove the corresponding entry from DEEZER_SEEDS in lib/playlists.ts`);
console.log(`  3. Optional: run add-*-canonical.mjs to grow the pack`);
console.log(`  4. Run cap-curated-packs.mjs after adding to enforce caps`);
