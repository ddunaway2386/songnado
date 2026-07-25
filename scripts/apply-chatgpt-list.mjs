#!/usr/bin/env node
/**
 * Apply a ChatGPT-produced additions CSV to a curated-Deezer JSON pack.
 *
 * Usage:  node apply-chatgpt-list.mjs <pack-slug> <csv-path>
 * Example: node apply-chatgpt-list.mjs classic-tv-themes scripts/chatgpt-output-classic-tv.csv
 *
 * CSV format (no header): "Title","Artist","Source"
 *
 * Searches Deezer strictly (artist match required), then loose, filters
 * karaoke/tribute/cover noise. Dedupes against existing Deezer IDs +
 * normalized titles. Appends survivors to the pack JSON.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

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

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function searchDeezer(title, artist) {
  const artistKey = norm(artist).split(' ')[0];
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

const [, , slug, csvPath] = process.argv;
if (!slug || !csvPath) {
  console.error('Usage: node apply-chatgpt-list.mjs <pack-slug> <csv-path>');
  process.exit(1);
}

const jsonPath = join(PROJECT_ROOT, 'assets', 'curated-deezer', `${slug}.json`);
const csv = readFileSync(join(PROJECT_ROOT, csvPath), 'utf8');

const rows = csv.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
  const cols = parseCsvLine(line);
  return { title: cols[0] || '', artist: cols[1] || '', source: cols[2] || '' };
});
const pack = JSON.parse(readFileSync(jsonPath, 'utf8'));

const existingIds = new Set(pack.tracks.map((t) => String(t.deezerId)));
const existingTitles = new Set(pack.tracks.map((t) => norm(t.title)));

console.log(`Applying ${rows.length} candidates to ${pack.name} (currently ${pack.tracks.length} tracks)...`);

const added = [], dupes = [], notFound = [];
for (const row of rows) {
  if (existingTitles.has(norm(row.title))) {
    dupes.push(row);
    continue;
  }
  const hit = await searchDeezer(row.title, row.artist);
  if (!hit) {
    notFound.push(row);
    console.log(`  ✗ ${row.title} — ${row.artist}`);
    continue;
  }
  if (existingIds.has(String(hit.id))) {
    dupes.push(row);
    continue;
  }
  pack.tracks.push({
    deezerId: String(hit.id),
    title: hit.title,
    artist: hit.artist?.name || '',
    source: row.source || '',
  });
  existingIds.add(String(hit.id));
  existingTitles.add(norm(hit.title));
  added.push({ title: hit.title, artist: hit.artist?.name });
  console.log(`  ✓ ${hit.title} — ${hit.artist?.name}`);
  await new Promise((r) => setTimeout(r, 60));
}

writeFileSync(jsonPath, JSON.stringify(pack, null, 2) + '\n');

console.log('');
console.log('=========================================');
console.log(`  Added:     ${added.length}`);
console.log(`  Dupes:     ${dupes.length}`);
console.log(`  Not found: ${notFound.length}`);
console.log(`  New total: ${pack.tracks.length} tracks`);
if (notFound.length > 0) {
  console.log('\nNot found on Deezer (with strict artist match):');
  for (const n of notFound) console.log(`  - ${n.title} — ${n.artist} (${n.source})`);
}
