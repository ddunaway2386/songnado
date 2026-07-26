#!/usr/bin/env node
/**
 * Cap Broadway to N tracks per show. Prevents Hamilton (47), Mamma Mia
 * (30), Wicked (17) etc. from dominating the pack — more shows get
 * their moment.
 *
 * Requires source labels populated first (run source-label-broadway.mjs).
 *
 * Strategy: preserve the first N tracks of each show as they appear in
 * the current JSON order. That order roughly corresponds to how tracks
 * arrived (initial CSV curation first, then raw-pack pull, then
 * canonical additions) — so the earliest/most-canonical picks survive.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const JSON_PATH = join(PROJECT_ROOT, 'assets', 'curated-deezer', 'broadway.json');

const CAP = 8;

const pack = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
console.log(`Loaded ${pack.tracks.length} tracks from Broadway pack`);

const kept = [];
const trimmedByShow = new Map();
const showCounts = new Map();

for (const track of pack.tracks) {
  const show = track.source || '(unknown)';
  const currentCount = showCounts.get(show) || 0;
  if (currentCount < CAP) {
    kept.push(track);
    showCounts.set(show, currentCount + 1);
  } else {
    trimmedByShow.set(show, (trimmedByShow.get(show) || 0) + 1);
  }
}

pack.tracks = kept;
writeFileSync(JSON_PATH, JSON.stringify(pack, null, 2) + '\n');

console.log('');
console.log('=========================================');
console.log(`  Cap: ${CAP} per show`);
console.log(`  Before: ${pack.tracks.length + [...trimmedByShow.values()].reduce((a, b) => a + b, 0)}`);
console.log(`  After:  ${pack.tracks.length}`);
console.log(`  Shows represented: ${showCounts.size}`);
console.log('=========================================');

if (trimmedByShow.size > 0) {
  console.log('\nShows trimmed (dropped tracks):');
  const sorted = [...trimmedByShow.entries()].sort((a, b) => b[1] - a[1]);
  for (const [show, dropped] of sorted) {
    console.log(`  -${dropped.toString().padStart(3)}  ${show}`);
  }
}
