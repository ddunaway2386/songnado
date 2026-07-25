#!/usr/bin/env node
/**
 * Convert a Title,Artist CSV into a curated-Deezer JSON pack.
 * Skips the Soundiiz workflow entirely — searches Deezer directly
 * and writes the JSON asset the app already knows how to load.
 *
 * Usage: node csv-to-curated-deezer.mjs
 *
 * Configured to process all three pending packs (wedding, broadway,
 * road-trip) in one run. Emits summary + registration instructions.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CURATED_DIR = join(PROJECT_ROOT, 'assets', 'curated-deezer');

const PACKS = [
  {
    slug: 'wedding',
    id: 'songnado-wedding',
    name: 'Wedding',
    csv: 'soundiiz-import-theme-wedding.csv',
    tier: 'free',
  },
  {
    slug: 'broadway',
    id: 'songnado-broadway',
    name: 'Broadway',
    csv: 'soundiiz-import-theme-broadway.csv',
    tier: 'locked',
  },
  {
    slug: 'road-trip',
    id: 'songnado-road-trip',
    name: 'Road Trip',
    csv: 'soundiiz-import-theme-road-trip.csv',
    tier: 'free',
  },
];

const REJECT_RE = /karaoke|tribute|made\s*famous|in the style|glee cast|cover of\b/i;

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[’‘'`]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(path) {
  const src = readFileSync(join(__dirname, path), 'utf8');
  const rows = [];
  for (const line of src.split(/\r?\n/).slice(1)) {
    const m = line.match(/^\"([^\"]+)\",\"([^\"]+)\"/);
    if (m) rows.push({ title: m[1], artist: m[2] });
  }
  return rows;
}

async function searchDeezer(title, artist) {
  const artistKey = norm(artist).split(' ')[0]; // first word usually enough
  // Strict first
  const strictUrl = 'https://api.deezer.com/search?q=' + encodeURIComponent(`track:"${title}" artist:"${artist}"`) + '&limit=10';
  let hits = await fetch(strictUrl).then((r) => r.json()).then((d) => d.data || []).catch(() => []);
  let best = hits.find(
    (h) =>
      (h.artist?.name || '').toLowerCase().includes(artistKey) &&
      !REJECT_RE.test(h.title) &&
      !REJECT_RE.test(h.artist?.name || '') &&
      h.preview
  );
  if (best) return best;

  // Loose
  const looseUrl = 'https://api.deezer.com/search?q=' + encodeURIComponent(`${title} ${artist}`) + '&limit=10';
  hits = await fetch(looseUrl).then((r) => r.json()).then((d) => d.data || []).catch(() => []);
  best = hits.find(
    (h) =>
      (h.artist?.name || '').toLowerCase().includes(artistKey) &&
      !REJECT_RE.test(h.title) &&
      !REJECT_RE.test(h.artist?.name || '') &&
      h.preview
  );
  return best || null;
}

async function processPack(pack) {
  console.log(`\n=== ${pack.name} ===`);
  const rows = parseCsv(pack.csv);
  console.log(`  Input rows: ${rows.length}`);

  const tracks = [];
  const seenIds = new Set();
  const notFound = [];
  const wrongArtist = [];

  for (let i = 0; i < rows.length; i++) {
    const { title, artist } = rows[i];
    if (i > 0 && i % 25 === 0) console.log(`  progress: ${i}/${rows.length}...`);
    const hit = await searchDeezer(title, artist);
    if (!hit) {
      notFound.push({ title, artist });
    } else if (seenIds.has(String(hit.id))) {
      // Dedupe silently
    } else {
      seenIds.add(String(hit.id));
      tracks.push({
        deezerId: String(hit.id),
        title: hit.title,
        artist: hit.artist?.name || '',
        source: '',
      });
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  const packData = {
    id: pack.id,
    name: pack.name,
    imageUrl: '',
    tier: pack.tier,
    version: 1,
    tracks,
  };
  const outPath = join(CURATED_DIR, `${pack.slug}.json`);
  writeFileSync(outPath, JSON.stringify(packData, null, 2) + '\n');

  console.log(`  Output: ${tracks.length} tracks -> ${outPath}`);
  console.log(`  Not found on Deezer: ${notFound.length}`);
  if (notFound.length > 0 && notFound.length < 20) {
    for (const n of notFound) console.log(`    - ${n.title} — ${n.artist}`);
  }
  return { pack, tracks: tracks.length, notFound: notFound.length };
}

const results = [];
for (const pack of PACKS) {
  results.push(await processPack(pack));
}

console.log('\n\n=========================================');
console.log('SUMMARY');
console.log('=========================================');
for (const r of results) {
  console.log(`  ${r.pack.name.padEnd(12)} tier=${r.pack.tier.padEnd(7)} ${r.tracks} tracks (${r.notFound} not found)`);
}
console.log('\nNext steps:');
console.log('  1. Add each pack to lib/curated/deezer-loader.ts playlistLoaders');
console.log('  2. Remove old Broadway entry (id 13889425981) from lib/playlists.ts DEEZER_SEEDS');
console.log('  3. Commit + push + eas update');
