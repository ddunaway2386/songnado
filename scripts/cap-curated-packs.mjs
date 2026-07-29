#!/usr/bin/env node
/**
 * Apply per-source or per-artist caps to all curated-Deezer packs.
 *
 * Movies, TV Themes, Broadway group by source (movie/show/musical
 * name). Wedding + Road Trip have empty source fields — those group
 * by artist instead.
 *
 * Live Deezer packs (80's, 90's, decades, Billboard) aren't touched
 * here — those are external playlists we don't own. Runtime recency
 * filter in playlistStore handles their variety instead.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CURATED_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');

const PACKS = [
  { slug: 'movie-soundtracks', groupBy: 'source', cap: 8 },
  { slug: 'movie-songs',       groupBy: 'source', cap: 8 },
  { slug: 'classic-tv-themes', groupBy: 'source', cap: 8 },
  { slug: 'modern-tv-themes',  groupBy: 'source', cap: 8 },
  { slug: 'broadway',          groupBy: 'source', cap: 8 },
  { slug: 'wedding',           groupBy: 'artist', cap: 5 },
  { slug: 'road-trip',         groupBy: 'artist', cap: 5 },
  { slug: '70s-mega-hits',     groupBy: 'artist', cap: 6 },
  { slug: '2020s-mega-hits',   groupBy: 'artist', cap: 6 },
];

function keyOf(track, groupBy) {
  const raw = groupBy === 'source' ? track.source : track.artist;
  return (raw || '(unknown)').trim();
}

function processPack({ slug, groupBy, cap }) {
  const path = join(CURATED_DIR, `${slug}.json`);
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  const before = pack.tracks.length;

  const kept = [];
  const counts = new Map();
  const trimmed = new Map();

  for (const track of pack.tracks) {
    const key = keyOf(track, groupBy);
    const n = counts.get(key) || 0;
    if (n < cap) {
      kept.push(track);
      counts.set(key, n + 1);
    } else {
      trimmed.set(key, (trimmed.get(key) || 0) + 1);
    }
  }

  pack.tracks = kept;
  writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');

  console.log(`\n=== ${pack.name} (cap ${cap} per ${groupBy}) ===`);
  console.log(`  Before: ${before}`);
  console.log(`  After:  ${kept.length}`);
  console.log(`  ${groupBy === 'source' ? 'Sources' : 'Artists'} represented: ${counts.size}`);
  if (trimmed.size > 0) {
    const top = [...trimmed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(`  Top trims:`);
    for (const [key, n] of top) {
      console.log(`    -${n.toString().padStart(3)}  ${key}`);
    }
  } else {
    console.log(`  (nothing trimmed)`);
  }
  return { name: pack.name, before, after: kept.length };
}

const results = PACKS.map(processPack);

console.log('\n=========================================');
console.log('SUMMARY');
console.log('=========================================');
for (const r of results) {
  const delta = r.after - r.before;
  console.log(`  ${r.name.padEnd(22)} ${r.before} -> ${r.after}  (${delta === 0 ? 'no change' : delta})`);
}
