#!/usr/bin/env node
/**
 * Find tracks in a Deezer playlist that DON'T have a source entry in
 * assets/sources/all.json. Output as a sources-unmatched-style CSV so
 * the same propose-sources.mjs / apply-sources.mjs pipeline can pick them
 * up for a second-pass annotation.
 *
 * Usage:
 *   node scripts/find-sourceless-tracks.mjs <deezer-playlist-id> <pack-slug>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const JSON_PATH = join(PROJECT_ROOT, 'assets', 'sources', 'all.json');

const playlistId = process.argv[2];
const packSlug = process.argv[3];
if (!playlistId || !packSlug) {
  console.error('Usage: node scripts/find-sourceless-tracks.mjs <deezer-playlist-id> <pack-slug>');
  process.exit(1);
}

async function fetchPlaylistTracks(playlistId) {
  const all = [];
  let index = 0;
  const limit = 100;
  while (true) {
    const url = `https://api.deezer.com/playlist/${playlistId}/tracks?index=${index}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const data = await res.json();
    if (data.error) break;
    const batch = data.data || [];
    all.push(...batch);
    if (!data.next || batch.length < limit) break;
    index += limit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return all;
}

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

const sources = existsSync(JSON_PATH)
  ? JSON.parse(readFileSync(JSON_PATH, 'utf8'))
  : {};

console.log(`Fetching playlist ${playlistId}...`);
const tracks = await fetchPlaylistTracks(playlistId);
console.log(`Got ${tracks.length} tracks`);

const sourceless = tracks.filter((t) => !sources[String(t.id)]);
console.log(`With source data:    ${tracks.length - sourceless.length}`);
console.log(`WITHOUT source data: ${sourceless.length}\n`);

const headers = ['DeezerId', 'Title', 'Artist', 'Album', 'Source'];
let csv = headers.join(',') + '\n';
for (const t of sourceless) {
  csv += headers
    .map((h) => {
      switch (h) {
        case 'DeezerId': return csvField(t.id);
        case 'Title': return csvField(t.title);
        case 'Artist': return csvField(t.artist?.name || '');
        case 'Album': return csvField(t.album?.title || '');
        default: return csvField('');
      }
    })
    .join(',') + '\n';
}
const outPath = join(__dirname, `sources-unmatched-${packSlug}-pass2.csv`);
writeFileSync(outPath, csv);
console.log(`✓ Wrote ${outPath}`);

console.log('\n=== SAMPLE SOURCELESS TRACKS ===');
for (const t of sourceless.slice(0, 15)) {
  console.log(`  ${t.title.slice(0, 35).padEnd(35)} | ${(t.artist?.name || '').slice(0, 25).padEnd(25)} | ${(t.album?.title || '').slice(0, 35)}`);
}
if (sourceless.length > 15) console.log(`  ... and ${sourceless.length - 15} more`);
